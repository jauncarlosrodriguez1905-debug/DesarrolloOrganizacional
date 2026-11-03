import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import CyclePills from '@/components/CyclePills'
import { StarInput, Stars } from '@/components/Stars'
import { cyclesFor, pickCycle, cycleLabel } from '@/lib/cycles'
import { SCORE_LABEL, SCORE_FACTOR } from '@/lib/scoring'
import { LOW_THRESHOLD } from '@/lib/plans'
import { GOAL_STATUS, type GoalStatus } from '@/lib/goals'
import PeriodPills from '@/components/PeriodPills'
import { loadPeriods, pickPeriod } from '@/lib/periods'

type Objective = { id: string; category: string; title: string; description: string | null; weight: number }
type Ev = { objective_id: string; kind: 'self' | 'manager'; score: number; comment: string | null; released_at: string | null }

async function saveActionPlan(formData: FormData) {
  'use server'
  const personId = String(formData.get('person_id'))
  const periodId = String(formData.get('period_id'))
  const cycle = String(formData.get('cycle') ?? '')
  const here = `/equipo/${personId}/evaluacion?p=${periodId}&c=${encodeURIComponent(cycle)}`
  const fail = (m: string): never => redirect(here + '&error=' + encodeURIComponent(m))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  if (!/^T[1-3]$/.test(cycle)) fail('El plan de acción se registra por cuarto.')
  const actions = String(formData.get('actions') ?? '').trim()
  if (!actions) fail('Escribe las acciones del plan.')
  const status = String(formData.get('status') ?? 'pending')
  if (!GOAL_STATUS.some((s) => s.value === status)) fail('Estado no válido.')

  // La base de datos valida que seas su jefe directo y que la fase de evaluaciones esté abierta.
  const { error } = await supabase.from('action_plans').upsert(
    {
      employee_id: personId,
      period_id: periodId,
      cycle,
      actions,
      due_date: String(formData.get('due_date') ?? '') || null,
      status,
    },
    { onConflict: 'employee_id,period_id,cycle' }
  )
  if (error) fail(error.message)
  revalidatePath(`/equipo/${personId}/evaluacion`)
  redirect(here + '&ok=' + encodeURIComponent('Plan de acción guardado.'))
}

async function saveManagerEval(formData: FormData) {
  'use server'
  const personId = String(formData.get('person_id'))
  const periodId = String(formData.get('period_id'))
  const cycle = String(formData.get('cycle') ?? 'final')
  const mode = String(formData.get('mode'))
  const here = `/equipo/${personId}/evaluacion?p=${periodId}&c=${encodeURIComponent(cycle)}`
  const fail = (m: string): never => redirect(here + '&error=' + encodeURIComponent(m))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const rows: { objective_id: string; kind: 'manager'; cycle: string; score: number; comment: string | null }[] = []
  for (const key of formData.keys()) {
    if (!key.startsWith('score_')) continue
    const id = key.slice(6)
    const score = Number(formData.get(key))
    if (!(score >= 1 && score <= 5)) continue
    rows.push({
      objective_id: id,
      kind: 'manager',
      cycle,
      score,
      comment: String(formData.get(`comment_${id}`) ?? '').trim() || null,
    })
  }
  if (rows.length > 0) {
    // Los permisos (ser su jefe, objetivo aprobado, periodo abierto) los valida la base de datos.
    const { error } = await supabase.from('evaluations').upsert(rows, { onConflict: 'objective_id,kind,cycle' })
    if (error) fail(error.message)
  }

  const body = String(formData.get('feedback') ?? '').trim()
  if (body) {
    const { error } = await supabase
      .from('feedback')
      .upsert({ employee_id: personId, period_id: periodId, cycle, body }, { onConflict: 'employee_id,period_id,cycle' })
    if (error) fail(error.message)
  }

  if (mode === 'publish') {
    const { data: objs } = await supabase
      .from('objectives').select('id, weight')
      .eq('owner_id', personId).eq('period_id', periodId).eq('scope', 'individual').eq('status', 'approved')
    const objList = (objs ?? []) as { id: string; weight: number }[]
    const ids = objList.map((o) => o.id)
    if (ids.length === 0) fail('No hay objetivos aprobados para evaluar.')

    const { data: done } = await supabase
      .from('evaluations').select('objective_id, score').eq('kind', 'manager').eq('cycle', cycle).in('objective_id', ids)
    const doneList = (done ?? []) as { objective_id: string; score: number }[]
    if (doneList.length < ids.length) fail('Califica todos los objetivos antes de publicar.')

    // Cuarto con porcentaje bajo: el plan de acción es obligatorio antes de publicar.
    if (/^T[1-3]$/.test(cycle)) {
      const total = objList.reduce(
        (a, o) => a + o.weight * (SCORE_FACTOR[doneList.find((d) => d.objective_id === o.id)?.score ?? 0] ?? 0), 0)
      if (total < LOW_THRESHOLD) {
        const { data: plan } = await supabase
          .from('action_plans').select('id')
          .eq('employee_id', personId).eq('period_id', periodId).eq('cycle', cycle).maybeSingle()
        if (!plan) fail(`El resultado de este cuarto es ${Math.round(total)}%, menos de ${LOW_THRESHOLD}%. Registra el plan de acción antes de publicar.`)
      }
    }

    const now = new Date().toISOString()
    const { error: e1 } = await supabase
      .from('evaluations').update({ released_at: now })
      .eq('kind', 'manager').eq('cycle', cycle).in('objective_id', ids).is('released_at', null)
    if (e1) fail(e1.message)
    const { error: e2 } = await supabase
      .from('feedback').update({ released_at: now })
      .eq('employee_id', personId).eq('period_id', periodId).eq('cycle', cycle).is('released_at', null)
    if (e2) fail(e2.message)
    const { error: e3 } = await supabase
      .from('action_plans').update({ released_at: now })
      .eq('employee_id', personId).eq('period_id', periodId).eq('cycle', cycle).is('released_at', null)
    if (e3) fail(e3.message)
  }

  revalidatePath(`/equipo/${personId}/evaluacion`)
  redirect(here + '&ok=' + encodeURIComponent(mode === 'publish' ? 'Evaluación publicada: ya la puede ver el colaborador.' : 'Borrador guardado.'))
}

export default async function EvaluatePersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ p?: string; c?: string; error?: string; ok?: string }>
}) {
  const { id } = await params
  const { p, c, error, ok } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: person } = await supabase
    .from('profiles').select('id, full_name, manager_id').eq('id', id).maybeSingle()
  if (!person || person.manager_id !== user.id) notFound()

  const periods = await loadPeriods(supabase)
  const period = pickPeriod(periods, p, 'evaluations')

  const cycles = period ? cyclesFor(period.starts_on, period.ends_on) : []
  const cycle = pickCycle(cycles, c)

  const { data: objs } = period
    ? await supabase
        .from('objectives').select('id, category, title, description, weight')
        .eq('owner_id', id).eq('scope', 'individual').eq('status', 'approved').eq('period_id', period.id)
        .order('created_at')
    : { data: [] }
  const objectives = (objs ?? []) as Objective[]

  const { data: evs } = objectives.length
    ? await supabase
        .from('evaluations').select('objective_id, kind, score, comment, released_at')
        .eq('cycle', cycle).in('objective_id', objectives.map((o) => o.id))
    : { data: [] }
  const evals = (evs ?? []) as Ev[]
  const pick = (oid: string, kind: Ev['kind']) => evals.find((e) => e.objective_id === oid && e.kind === kind)
  const published = objectives.length > 0 && objectives.every((o) => pick(o.id, 'manager')?.released_at)

  const { data: fb } = period
    ? await supabase
        .from('feedback').select('body, released_at')
        .eq('employee_id', id).eq('period_id', period.id).eq('cycle', cycle).maybeSingle()
    : { data: null }

  const mgrTotal =
    objectives.length > 0 && objectives.every((o) => pick(o.id, 'manager'))
      ? objectives.reduce((a, o) => a + o.weight * (SCORE_FACTOR[pick(o.id, 'manager')!.score] ?? 0), 0)
      : null
  const isQuarter = /^T[1-3]$/.test(cycle)
  const needsPlan = isQuarter && mgrTotal !== null && mgrTotal < LOW_THRESHOLD
  const { data: planData } =
    period && isQuarter
      ? await supabase
          .from('action_plans').select('actions, due_date, status')
          .eq('employee_id', id).eq('period_id', period.id).eq('cycle', cycle).maybeSingle()
      : { data: null }
  const plan = planData as { actions: string; due_date: string | null; status: GoalStatus } | null

  return (
    <AppShell
      title="Mi equipo"
      subtitle={`Evaluación de ${person.full_name}.`}
      meta={period ? <span className="chip">{period.name}</span> : null}
    >
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="success" role="status">{ok}</div>}

      {!period ? (
        <div className="notice">No hay un periodo abierto.</div>
      ) : (
        <>
          <PeriodPills basePath={`/equipo/${id}/evaluacion`} periods={periods} active={period.id} />
          <CyclePills basePath={`/equipo/${id}/evaluacion`} extra={`p=${period.id}`} cycles={cycles} active={cycle} />
          {!period.allow_evaluations && (
            <div className="notice">Las evaluaciones de {period.name} no están abiertas en este momento.</div>
          )}

          {objectives.length === 0 ? (
            <section className="panel">
              <div className="empty">
                <h3>No hay objetivos aprobados</h3>
                <p>Aprueba primero los objetivos de {person.full_name} para poder evaluarlos.</p>
              </div>
            </section>
          ) : (
            <form action={saveManagerEval}>
              <input type="hidden" name="person_id" value={id} />
              <input type="hidden" name="period_id" value={period.id} />
              <input type="hidden" name="cycle" value={cycle} />
              <fieldset disabled={!period.allow_evaluations} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>{cycleLabel(cycles, cycle)}</h2>
                    <p className="score-legend">{[1, 2, 3, 4, 5].map((n) => SCORE_LABEL[n]).join('  ·  ')}</p>
                  </div>
                  <span className={`badge ${published ? 'badge--approved' : 'badge--draft'}`}>
                    {published ? 'Publicada' : 'Sin publicar'}
                  </span>
                </div>

                {objectives.map((o) => {
                  const self = pick(o.id, 'self')
                  const mine = pick(o.id, 'manager')
                  return (
                    <div className="eval-item" key={o.id}>
                      <div className="eval-head">
                        <div>
                          <span className="tag">{o.category}</span>
                          <div className="cell-title" style={{ marginTop: 8 }}>{o.title}</div>
                          {o.description && <div className="cell-desc">{o.description}</div>}
                        </div>
                        <span className="num">{o.weight}%</span>
                      </div>

                      {cycle === 'final' && <div className="manager-box" style={{ marginTop: 14 }}>
                        <strong>Autoevaluación:</strong>{' '}
                        {self ? (
                          <>
                            <Stars value={self.score} />
                            {self.comment && <span> — {self.comment}</span>}
                          </>
                        ) : (
                          <span className="muted">Todavía no se autoevalúa en este ciclo.</span>
                        )}
                      </div>}

                      <div className="eval-body">
                        <div>
                          <div className="eval-label">Tu calificación</div>
                          <StarInput name={`score_${o.id}`} defaultValue={mine?.score} />
                        </div>
                        <label className="field" style={{ margin: 0 }}>
                          <span>Comentario</span>
                          <textarea name={`comment_${o.id}`} defaultValue={mine?.comment ?? ''} />
                        </label>
                      </div>
                    </div>
                  )
                })}

                <div className="eval-item">
                  <label className="field" style={{ margin: 0 }}>
                    <span>Retroalimentación general</span>
                    <textarea
                      name="feedback"
                      defaultValue={fb?.body ?? ''}
                      placeholder="Qué hizo bien, qué debe mejorar y cómo puedes apoyarle"
                      style={{ minHeight: 110 }}
                    />
                  </label>
                </div>

                <div className="panel-foot">
                  <p className="muted">
                    El colaborador solo ve tu evaluación y tu retroalimentación cuando las publicas.
                  </p>
                  <div className="row-actions">
                    <button type="submit" name="mode" value="save" className="btn btn--inline btn--ghost">Guardar borrador</button>
                    <button type="submit" name="mode" value="publish" className="btn btn--inline">Guardar y publicar</button>
                  </div>
                </div>
              </section>
              </fieldset>
            </form>
          )}
          {isQuarter && (needsPlan || plan) && (
            <section className="panel" style={{ marginTop: 28 }}>
              <div className="panel-head">
                <div>
                  <h2>Plan de acción</h2>
                  <p>
                    {needsPlan
                      ? `El resultado de este cuarto es ${Math.round(mgrTotal ?? 0)}%, menos de ${LOW_THRESHOLD}%. Registra las acciones para mejorar: son obligatorias para publicar la evaluación.`
                      : 'Acciones acordadas para este cuarto.'}
                  </p>
                </div>
              </div>
              <form action={saveActionPlan} style={{ padding: 26 }}>
                <input type="hidden" name="person_id" value={id} />
                <input type="hidden" name="period_id" value={period.id} />
                <input type="hidden" name="cycle" value={cycle} />
                <fieldset disabled={!period.allow_evaluations} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  <label className="field">
                    <span>Acciones</span>
                    <textarea
                      name="actions"
                      required
                      defaultValue={plan?.actions ?? ''}
                      style={{ minHeight: 120 }}
                      placeholder="Qué se va a hacer, con qué apoyo y cómo se medirá la mejora"
                    />
                  </label>
                  <div className="form-grid">
                    <label className="field">
                      <span>Fecha compromiso</span>
                      <input name="due_date" type="date" defaultValue={plan?.due_date ?? ''} />
                    </label>
                    <label className="field">
                      <span>Estado</span>
                      <select name="status" defaultValue={plan?.status ?? 'pending'}>
                        {GOAL_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <button type="submit" className="btn btn--inline">Guardar plan de acción</button>
                </fieldset>
              </form>
            </section>
          )}
          <p style={{ marginTop: 20 }}><Link href={`/equipo/${id}`} className="link">← Volver a los objetivos</Link></p>
        </>
      )}
    </AppShell>
  )
}
