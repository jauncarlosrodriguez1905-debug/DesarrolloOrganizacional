import { redirect } from 'next/navigation'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import { evidenceCounts, evidenceLabel } from '@/lib/evidence'
import PeriodPills from '@/components/PeriodPills'
import { StarInput, Stars } from '@/components/Stars'
import { loadPeriods, pickPeriod } from '@/lib/periods'
import { SCORE_LABEL } from '@/lib/scoring'

const CYCLE = 'final' // La autoevaluación se hace una sola vez al año.

type Objective = { id: string; category: string; title: string; description: string | null; weight: number }
type Ev = { objective_id: string; kind: 'self' | 'manager'; score: number; comment: string | null }

async function saveSelfEval(formData: FormData) {
  'use server'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const periodId = String(formData.get('period_id') ?? '')
  const here = `/autoevaluacion?p=${periodId}`

  const rows: { objective_id: string; kind: 'self'; cycle: string; score: number; comment: string | null }[] = []
  for (const key of formData.keys()) {
    if (!key.startsWith('score_')) continue
    const id = key.slice(6)
    const score = Number(formData.get(key))
    if (!(score >= 1 && score <= 5)) continue
    rows.push({
      objective_id: id,
      kind: 'self',
      cycle: CYCLE,
      score,
      comment: String(formData.get(`comment_${id}`) ?? '').trim() || null,
    })
  }
  if (rows.length === 0) redirect(here + '&error=' + encodeURIComponent('Califica al menos un objetivo antes de guardar.'))

  // RLS y los triggers validan que los objetivos sean tuyos, estén aprobados y la fase de evaluaciones esté abierta.
  const { error } = await supabase.from('evaluations').upsert(rows, { onConflict: 'objective_id,kind,cycle' })
  if (error) redirect(here + '&error=' + encodeURIComponent(error.message))
  revalidatePath('/autoevaluacion')
  redirect(here + '&ok=' + encodeURIComponent('Autoevaluación guardada.'))
}

export default async function AutoevaluacionPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; error?: string; ok?: string }>
}) {
  const { p, error, ok } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const periods = await loadPeriods(supabase)
  const period = pickPeriod(periods, p, 'evaluations')
  const canEvaluate = !!period?.allow_evaluations

  const { data: objs } = period
    ? await supabase
        .from('objectives')
        .select('id, category, title, description, weight')
        .eq('owner_id', user.id).eq('scope', 'individual').eq('status', 'approved').eq('period_id', period.id)
        .order('created_at')
    : { data: [] }
  const objectives = (objs ?? []) as Objective[]
  const evCount = await evidenceCounts(supabase, objectives.map((o) => o.id))

  const { data: evs } = objectives.length
    ? await supabase
        .from('evaluations')
        .select('objective_id, kind, score, comment')
        .eq('cycle', CYCLE)
        .in('objective_id', objectives.map((o) => o.id))
    : { data: [] }
  const evals = (evs ?? []) as Ev[]
  const pick = (id: string, kind: Ev['kind']) => evals.find((e) => e.objective_id === id && e.kind === kind)

  const { data: fb } = period
    ? await supabase
        .from('feedback').select('body')
        .eq('employee_id', user.id).eq('period_id', period.id).eq('cycle', CYCLE).maybeSingle()
    : { data: null }

  return (
    <AppShell
      title="Autoevaluación anual"
      subtitle="Se hace una sola vez al año, en el cierre. Califica cada objetivo aprobado y comenta cómo lo lograste."
      meta={period ? <span className="chip">{period.name}</span> : null}
    >
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="success" role="status">{ok}</div>}

      {!period ? (
        <div className="notice">Aún no hay un periodo activo.</div>
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <PeriodPills basePath="/autoevaluacion" periods={periods} active={period.id} />
          </div>
          {!canEvaluate && (
            <div className="notice">Las evaluaciones de {period.name} no están abiertas en este momento.</div>
          )}

          {objectives.length === 0 ? (
            <section className="panel">
              <div className="empty">
                <h3>Aún no hay objetivos aprobados</h3>
                <p>Cuando tu jefe apruebe tus objetivos de {period.name}, podrás autoevaluarte aquí.</p>
              </div>
            </section>
          ) : (
            <form action={saveSelfEval}>
              <input type="hidden" name="period_id" value={period.id} />
              <fieldset disabled={!canEvaluate} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Cierre anual</h2>
                      <p className="score-legend">
                        {[1, 2, 3, 4, 5].map((n) => SCORE_LABEL[n]).join('  ·  ')}
                      </p>
                    </div>
                  </div>

                  {objectives.map((o) => {
                    const mine = pick(o.id, 'self')
                    const boss = pick(o.id, 'manager')
                    return (
                      <div className="eval-item" key={o.id}>
                        <div className="eval-head">
                          <div>
                            <span className="tag">{o.category}</span>
                            <div className="cell-title" style={{ marginTop: 8 }}>{o.title}</div>
                            {o.description && <div className="cell-desc">{o.description}</div>}
                            <div style={{ marginTop: 6 }}>
                              <Link href={`/objetivos/${o.id}/evidencias`} className="link">{evidenceLabel(evCount.get(o.id))}</Link>
                            </div>
                          </div>
                          <span className="num">{o.weight}%</span>
                        </div>
                        <div className="eval-body">
                          <div>
                            <div className="eval-label">Tu calificación</div>
                            <StarInput name={`score_${o.id}`} defaultValue={mine?.score} />
                          </div>
                          <label className="field" style={{ margin: 0 }}>
                            <span>Comentario</span>
                            <textarea name={`comment_${o.id}`} defaultValue={mine?.comment ?? ''} placeholder="Qué lograste y cómo lo sabes" />
                          </label>
                        </div>
                        {boss && (
                          <div className="manager-box">
                            <strong>Tu jefe:</strong> <Stars value={boss.score} />
                            {boss.comment && <span> — {boss.comment}</span>}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {fb?.body && (
                    <div className="eval-item">
                      <div className="eval-label">Retroalimentación de tu jefe</div>
                      <p style={{ marginTop: 6 }}>{fb.body}</p>
                    </div>
                  )}

                  {canEvaluate && (
                    <div className="panel-foot">
                      <p className="muted">Puedes cambiar tu autoevaluación mientras la fase de evaluaciones siga abierta.</p>
                      <button type="submit" className="btn btn--inline">Guardar autoevaluación</button>
                    </div>
                  )}
                </section>
              </fieldset>
            </form>
          )}
        </>
      )}
    </AppShell>
  )
}
