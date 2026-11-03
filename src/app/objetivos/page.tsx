import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import { evidenceCounts, evidenceLabel } from '@/lib/evidence'
import PeriodPills from '@/components/PeriodPills'
import { loadPeriods, pickPeriod } from '@/lib/periods'
import { STATUS_LABEL, isEditable, type ObjectiveStatus } from '@/lib/status'

type Objective = {
  id: string
  category: string
  title: string
  description: string | null
  weight: number
  status: ObjectiveStatus
  review_comment: string | null
}

const go = (periodId: string, kind: 'error' | 'ok', msg: string): never =>
  redirect(`/objetivos?p=${periodId}&${kind}=${encodeURIComponent(msg)}`)

async function addObjective(formData: FormData) {
  'use server'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const periodId = String(formData.get('period_id') ?? '')
  if (!periodId) redirect('/objetivos?error=' + encodeURIComponent('No hay un periodo disponible.'))

  // RLS y los triggers de Postgres validan permisos, la fase abierta y que la suma de pesos no pase de 100.
  const { error } = await supabase.from('objectives').insert({
    period_id: periodId,
    scope: 'individual',
    owner_id: user.id,
    category: String(formData.get('category')),
    title: String(formData.get('title')),
    description: String(formData.get('description') ?? ''),
    weight: Number(formData.get('weight')),
  })
  if (error) go(periodId, 'error', error.message)
  revalidatePath('/objetivos')
}

async function deleteObjective(formData: FormData) {
  'use server'
  const supabase = await createClient()
  const periodId = String(formData.get('period_id') ?? '')
  const { error } = await supabase.from('objectives').delete().eq('id', String(formData.get('id')))
  if (error) go(periodId, 'error', error.message)
  revalidatePath('/objetivos')
}

async function submitForReview(formData: FormData) {
  'use server'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const periodId = String(formData.get('period_id') ?? '')

  const { error } = await supabase
    .from('objectives')
    .update({ status: 'submitted' })
    .eq('owner_id', user.id)
    .eq('period_id', periodId)
    .eq('scope', 'individual')
    .in('status', ['draft', 'returned'])
  if (error) go(periodId, 'error', error.message)
  revalidatePath('/objetivos')
  go(periodId, 'ok', 'Objetivos enviados a tu jefe para revisión.')
}

export default async function ObjetivosPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; error?: string; ok?: string }>
}) {
  const { p, error, ok } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const periods = await loadPeriods(supabase)
  const period = pickPeriod(periods, p, 'objectives')
  const canDefine = !!period?.allow_objectives

  const { data } = period
    ? await supabase
        .from('objectives')
        .select('id, category, title, description, weight, status, review_comment')
        .eq('scope', 'individual')
        .eq('owner_id', user.id)
        .eq('period_id', period.id)
        .order('created_at')
    : { data: [] }

  const rows = (data ?? []) as Objective[]
  const evCount = await evidenceCounts(supabase, rows.map((o) => o.id))
  const total = rows.reduce((acc, o) => acc + o.weight, 0)
  const remaining = 100 - total
  const pending = rows.filter((o) => isEditable(o.status))
  const inReview = rows.filter((o) => o.status === 'submitted').length
  const allApproved = rows.length > 0 && rows.every((o) => o.status === 'approved')
  const canSubmit = canDefine && pending.length > 0 && total === 100

  const headline = allApproved
    ? 'Tu jefe aprobó tus objetivos.'
    : remaining === 0
      ? 'Los pesos suman 100%.'
      : `Te faltan ${remaining}% por asignar.`

  return (
    <AppShell
      title="Objetivos"
      subtitle="Define los objetivos del año y cuánto pesa cada uno. Los pesos deben sumar 100% antes de enviarlos a tu jefe."
      meta={period ? <span className="chip">{period.name}</span> : null}
    >
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="success" role="status">{ok}</div>}

      {!period ? (
        <div className="notice">Aún no hay un periodo activo. Recursos Humanos lo publicará cuando inicie la definición de objetivos.</div>
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <PeriodPills basePath="/objetivos" periods={periods} active={period.id} />
          </div>
          {!canDefine && (
            <div className="notice">La definición de objetivos de {period.name} está cerrada. Aquí puedes consultar los tuyos.</div>
          )}

          <div className="grid-2">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Mis objetivos</h2>
                  <p>{rows.length === 0 ? 'Aún no has definido objetivos en este periodo.' : headline}</p>
                </div>
                <div className="meter" data-complete={total === 100}>
                  <div className="meter-label">
                    <strong>{total}%</strong> de 100%
                  </div>
                  <div className="meter-track">
                    <div className="meter-fill" style={{ width: `${Math.min(total, 100)}%` }} />
                  </div>
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="empty">
                  <h3>Aún no tienes objetivos</h3>
                  <p>Agrega el primero en el formulario. Puedes crear tantos como necesites mientras sumen 100%.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Categoría</th>
                        <th>Objetivo</th>
                        <th>Estado</th>
                        <th className="num">Peso</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((o) => (
                        <tr key={o.id}>
                          <td><span className="tag">{o.category}</span></td>
                          <td>
                            <div className="cell-title">{o.title}</div>
                            {o.description && <div className="cell-desc">{o.description}</div>}
                            {o.status === 'returned' && o.review_comment && (
                              <div className="review-note"><strong>Comentario de tu jefe:</strong> {o.review_comment}</div>
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
                          <td className="num">
                            {canDefine && isEditable(o.status) && (
                              <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                                <Link href={`/objetivos/${o.id}`} className="link">Editar</Link>
                                <form action={deleteObjective}>
                                  <input type="hidden" name="id" value={o.id} />
                                  <input type="hidden" name="period_id" value={period.id} />
                                  <button type="submit" className="link-danger">Eliminar</button>
                                </form>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {canDefine && (pending.length > 0 || inReview > 0) && (
                <div className="panel-foot">
                  <p className="muted">
                    {pending.length > 0
                      ? canSubmit
                        ? 'Todo listo. Al enviarlos, tu jefe los revisa y ya no podrás editarlos hasta que los devuelva.'
                        : 'Los pesos deben sumar 100% para poder enviarlos a revisión.'
                      : 'Tus objetivos están en revisión con tu jefe.'}
                  </p>
                  {pending.length > 0 && (
                    <form action={submitForReview}>
                      <input type="hidden" name="period_id" value={period.id} />
                      <button type="submit" className="btn btn--inline" disabled={!canSubmit}>
                        Enviar a revisión
                      </button>
                    </form>
                  )}
                </div>
              )}
            </section>

            <aside className="panel panel-form">
              <h2>Nuevo objetivo</h2>
              <form action={addObjective}>
                <input type="hidden" name="period_id" value={period.id} />
                <fieldset disabled={!canDefine} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  <label className="field">
                    <span>Categoría</span>
                    <input name="category" placeholder="Ej. Calidad" required />
                  </label>
                  <label className="field">
                    <span>Título del objetivo</span>
                    <input name="title" required />
                  </label>
                  <label className="field">
                    <span>Descripción</span>
                    <textarea name="description" />
                  </label>
                  <label className="field">
                    <span>Peso (%)</span>
                    <input name="weight" type="number" min={1} max={100} required />
                  </label>
                  <button type="submit" className="btn">Guardar objetivo</button>
                </fieldset>
              </form>
            </aside>
          </div>
        </>
      )}
    </AppShell>
  )
}
