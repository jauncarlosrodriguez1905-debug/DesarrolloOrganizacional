import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import { loadPeriods, pickPeriod } from '@/lib/periods'
import { STATUS_LABEL, type ObjectiveStatus } from '@/lib/status'

export default async function EquipoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // El equipo y los periodos no dependen entre sí: en paralelo.
  const [{ data: reports }, periods] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, employee_code')
      .eq('manager_id', user.id)
      .eq('active', true)
      .order('full_name'),
    loadPeriods(supabase),
  ])
  const team = (reports ?? []) as { id: string; full_name: string; employee_code: string | null }[]

  const period = pickPeriod(periods, undefined, 'objectives')

  const { data: objs } =
    period && team.length > 0
      ? await supabase
          .from('objectives')
          .select('owner_id, status, weight')
          .eq('period_id', period.id)
          .eq('scope', 'individual')
          .in('owner_id', team.map((t) => t.id))
      : { data: [] }

  const stats = new Map<string, { total: number; counts: Record<ObjectiveStatus, number> }>()
  ;((objs ?? []) as { owner_id: string; status: ObjectiveStatus; weight: number }[]).forEach((o) => {
    const s = stats.get(o.owner_id) ?? { total: 0, counts: { draft: 0, submitted: 0, approved: 0, returned: 0 } }
    s.total += o.weight
    s.counts[o.status] += 1
    stats.set(o.owner_id, s)
  })

  const ordered = [...team].sort(
    (a, b) => (stats.get(b.id)?.counts.submitted ?? 0) - (stats.get(a.id)?.counts.submitted ?? 0)
  )
  const pendingPeople = ordered.filter((t) => (stats.get(t.id)?.counts.submitted ?? 0) > 0).length

  return (
    <AppShell
      title="Mi equipo"
      subtitle="Revisa y aprueba los objetivos de las personas que te reportan."
      meta={period ? <span className="chip">{period.name}</span> : null}
    >
      {!period && <div className="notice">No hay un periodo abierto.</div>}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Personas a tu cargo</h2>
            <p>
              {team.length === 0
                ? 'Todavía no tienes personal asignado. Recursos Humanos lo asigna desde Administración.'
                : pendingPeople > 0
                  ? `${pendingPeople} ${pendingPeople === 1 ? 'persona espera' : 'personas esperan'} tu revisión.`
                  : 'No tienes revisiones pendientes.'}
            </p>
          </div>
        </div>
        {team.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nombre</th><th>Objetivos</th><th className="num">Peso</th><th /></tr>
              </thead>
              <tbody>
                {ordered.map((t) => {
                  const s = stats.get(t.id)
                  return (
                    <tr key={t.id}>
                      <td>
                        <div className="cell-title">{t.full_name}</div>
                        <div className="cell-desc">{t.employee_code ? `Código ${t.employee_code}` : 'Sin código'}</div>
                      </td>
                      <td>
                        {!s ? (
                          <span className="muted">Sin objetivos</span>
                        ) : (
                          <div className="badges">
                            {(Object.keys(s.counts) as ObjectiveStatus[])
                              .filter((k) => s.counts[k] > 0)
                              .map((k) => (
                                <span key={k} className={`badge badge--${k}`}>{s.counts[k]} {STATUS_LABEL[k].toLowerCase()}</span>
                              ))}
                          </div>
                        )}
                      </td>
                      <td className="num">{s?.total ?? 0}%</td>
                      <td className="num">
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <Link href={`/equipo/${t.id}`} className="btn btn--inline btn--sm btn--ink">Objetivos</Link>
                          <Link href={`/equipo/${t.id}/evaluacion`} className="btn btn--inline btn--sm">Evaluar</Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  )
}
