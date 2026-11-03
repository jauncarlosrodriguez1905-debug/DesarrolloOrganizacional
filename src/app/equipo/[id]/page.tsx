import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import { evidenceCounts, evidenceLabel } from '@/lib/evidence'
import { loadPeriods, pickPeriod } from '@/lib/periods'
import { STATUS_LABEL, type ObjectiveStatus } from '@/lib/status'
import { GOAL_LABEL, GOAL_BADGE, formatDate, type GoalStatus } from '@/lib/goals'

type Objective = {
  id: string
  category: string
  title: string
  description: string | null
  weight: number
  status: ObjectiveStatus
  review_comment: string | null
}

async function reviewObjective(formData: FormData) {
  'use server'
  const id = String(formData.get('id'))
  const personId = String(formData.get('person_id'))
  const here = `/equipo/${personId}`
  const decision = String(formData.get('decision'))
  const comment = String(formData.get('comment') ?? '').trim()
  if (decision !== 'approved' && decision !== 'returned') redirect(here)
  if (decision === 'returned' && !comment) {
    redirect(here + '?error=' + encodeURIComponent('Escribe un comentario para devolver el objetivo.'))
  }

  // La base de datos verifica que seas su jefe y que el objetivo esté en revisión.
  const supabase = await createClient()
  const { error } = await supabase
    .from('objectives')
    .update({ status: decision, review_comment: comment || null })
    .eq('id', id)
  if (error) redirect(here + '?error=' + encodeURIComponent(error.message))
  revalidatePath(here)
  redirect(here + '?ok=' + encodeURIComponent(decision === 'approved' ? 'Objetivo aprobado.' : 'Objetivo devuelto con tu comentario.'))
}

async function approveAll(formData: FormData) {
  'use server'
  const personId = String(formData.get('person_id'))
  const periodId = String(formData.get('period_id'))
  const here = `/equipo/${personId}`
  const supabase = await createClient()
  const { error } = await supabase
    .from('objectives')
    .update({ status: 'approved' })
    .eq('owner_id', personId)
    .eq('period_id', periodId)
    .eq('scope', 'individual')
    .eq('status', 'submitted')
  if (error) redirect(here + '?error=' + encodeURIComponent(error.message))
  revalidatePath(here)
  redirect(here + '?ok=' + encodeURIComponent('Objetivos aprobados.'))
}

export default async function ReviewPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { id } = await params
  const { error, ok } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: person } = await supabase
    .from('profiles').select('id, full_name, manager_id').eq('id', id).maybeSingle()
  if (!person || person.manager_id !== user.id) notFound()

  const period = pickPeriod(await loadPeriods(supabase), undefined, 'objectives')

  const { data } = period
    ? await supabase
        .from('objectives')
        .select('id, category, title, description, weight, status, review_comment')
        .eq('owner_id', id).eq('scope', 'individual').eq('period_id', period.id)
        .order('created_at')
    : { data: [] }
  const rows = (data ?? []) as Objective[]
  const evCount = await evidenceCounts(supabase, rows.map((o) => o.id))
  const total = rows.reduce((a, o) => a + o.weight, 0)
  const submitted = rows.filter((o) => o.status === 'submitted')

  // RLS solo devuelve las metas que la persona decidió compartir con su jefe.
  const { data: sharedGoals } = await supabase
    .from('personal_goals')
    .select('id, title, description, target_date, status')
    .eq('owner_id', id)
    .order('created_at')
  const goals = (sharedGoals ?? []) as { id: string; title: string; description: string | null; target_date: string | null; status: GoalStatus }[]

  return (
    <AppShell
      title="Mi equipo"
      subtitle={`Objetivos de ${person.full_name}.`}
      meta={period ? <span className="chip">{period.name}</span> : null}
    >
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="success" role="status">{ok}</div>}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{person.full_name}</h2>
            <p>
              {rows.length === 0
                ? 'Todavía no ha definido objetivos.'
                : `${rows.length} ${rows.length === 1 ? 'objetivo' : 'objetivos'} · pesos suman ${total}%.`}
            </p>
          </div>
          {submitted.length > 0 && period && (
            <form action={approveAll}>
              <input type="hidden" name="person_id" value={id} />
              <input type="hidden" name="period_id" value={period.id} />
              <button type="submit" className="btn btn--inline btn--sm">Aprobar todos los enviados</button>
            </form>
          )}
        </div>

        {rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Categoría</th><th>Objetivo</th><th>Estado</th><th className="num">Peso</th></tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td><span className="tag">{o.category}</span></td>
                    <td>
                      <div className="cell-title">{o.title}</div>
                      {o.description && <div className="cell-desc">{o.description}</div>}
                      {o.status === 'returned' && o.review_comment && (
                        <div className="review-note"><strong>Tu comentario:</strong> {o.review_comment}</div>
                      )}
                      {o.status === 'submitted' && (
                        <form action={reviewObjective} className="review-form">
                          <input type="hidden" name="id" value={o.id} />
                          <input type="hidden" name="person_id" value={id} />
                          <input className="input" name="comment" placeholder="Comentario (obligatorio para devolver)" />
                          <button type="submit" name="decision" value="approved" className="btn btn--inline btn--sm">Aprobar</button>
                          <button type="submit" name="decision" value="returned" className="btn btn--inline btn--ghost btn--sm">Devolver</button>
                        </form>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge--${o.status}`}>{STATUS_LABEL[o.status]}</span>
                      {o.status === 'approved' && (
                        <div style={{ marginTop: 8 }}>
                          <Link href={`/objetivos/${o.id}/evidencias`} className="link">{evidenceLabel(evCount.get(o.id))}</Link>
                        </div>
                      )}
                    </td>
                    <td className="num">{o.weight}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {goals.length > 0 && (
        <section className="panel" style={{ marginTop: 28 }}>
          <div className="panel-head">
            <div>
              <h2>Objetivos personales</h2>
              <p>{person.full_name} los compartió contigo. No pesan en su calificación.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <tbody>
                {goals.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <div className="cell-title">{g.title}</div>
                      {g.description && <div className="cell-desc">{g.description}</div>}
                    </td>
                    <td className="muted">{g.target_date ? `Meta: ${formatDate(g.target_date)}` : ''}</td>
                    <td className="num"><span className={`badge ${GOAL_BADGE[g.status]}`}>{GOAL_LABEL[g.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="row-actions" style={{ marginTop: 20, gap: 24 }}>
        <Link href="/equipo" className="link">← Volver a mi equipo</Link>
        <Link href={`/equipo/${id}/evaluacion`} className="link">Evaluar desempeño →</Link>
      </div>
    </AppShell>
  )
}
