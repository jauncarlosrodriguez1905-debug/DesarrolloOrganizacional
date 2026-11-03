import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/data'
import AppShell from '@/components/AppShell'
import CyclePills from '@/components/CyclePills'
import { cyclesFor, pickCycle } from '@/lib/cycles'

type Period = { id: string; name: string; starts_on: string; ends_on: string; status: string; allow_evaluations?: boolean }
type Prog = { owner_id: string; full_name: string; area_id: string | null; approved: number }

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; c?: string; q?: string }>
}) {
  const { p, c, q } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: periodsData } = await supabase
    .from('periods').select('id, name, starts_on, ends_on, status, allow_evaluations')
    .neq('status', 'draft')
    .order('starts_on', { ascending: false }).limit(8)
  const periods = (periodsData ?? []) as Period[]
  const period = periods.find((x) => x.id === p) ?? periods.find((x) => x.allow_evaluations) ?? periods.find((x) => x.status === 'open') ?? periods[0]

  if (!period) {
    return (
      <AppShell title="Reporte" subtitle="Comparativo entre autoevaluación y evaluación del jefe.">
        <div className="notice">Aún no hay periodos. Recursos Humanos debe crear el primero.</div>
      </AppShell>
    )
  }

  const cycles = cyclesFor(period.starts_on, period.ends_on)
  const cycle = pickCycle(cycles, c)

  const progress = await fetchAll<Prog>((a, b) =>
    supabase.from('person_progress').select('owner_id, full_name, area_id, approved')
      .eq('period_id', period.id).gt('approved', 0).order('full_name').range(a, b)
  )
  const { data: areasData } = await supabase.from('areas').select('id, name')
  const areaName = new Map(((areasData ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]))

  // Quien solo puede verse a sí mismo va directo a su reporte.
  if (progress.length === 1 && progress[0].owner_id === user.id && !q) {
    redirect(`/reporte/${user.id}?p=${period.id}&c=${cycle}`)
  }

  const term = (q ?? '').trim().toLowerCase()
  const people = progress.filter((x) => !term || x.full_name.toLowerCase().includes(term))

  return (
    <AppShell
      title="Reporte"
      subtitle="Comparativo entre autoevaluación y evaluación del jefe, listo para imprimir o guardar en PDF."
      meta={<span className="chip">{period.name}</span>}
    >
      <div className="filters">
        <div className="filter-group">
          <span className="filter-label">Periodo</span>
          <nav className="pills" aria-label="Trimestre">
            {periods.map((pe) => (
              <Link key={pe.id} href={`/reporte?p=${pe.id}`} className="pill" aria-current={pe.id === period.id ? 'true' : undefined}>
                {pe.name}
              </Link>
            ))}
          </nav>
        </div>
        <div className="filter-group">
          <span className="filter-label">Ciclo</span>
          <CyclePills basePath="/reporte" extra={`p=${period.id}`} cycles={cycles} active={cycle} />
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Personas</h2>
            <p>{people.length} con objetivos aprobados en {period.name}.</p>
          </div>
          <form action="/reporte" method="get" className="search">
            <input type="hidden" name="p" value={period.id} />
            <input type="hidden" name="c" value={cycle} />
            <input className="input" name="q" defaultValue={q ?? ''} placeholder="Buscar por nombre" />
          </form>
        </div>

        {people.length === 0 ? (
          <div className="empty">
            <h3>No hay reportes disponibles</h3>
            <p>Aparecen cuando una persona tiene objetivos aprobados en el trimestre.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nombre</th><th>Área</th><th /></tr></thead>
              <tbody>
                {people.map((x) => (
                  <tr key={x.owner_id}>
                    <td className="cell-title">{x.full_name}{x.owner_id === user.id && <span className="muted"> (tú)</span>}</td>
                    <td>{x.area_id ? areaName.get(x.area_id) : <span className="muted">Sin área</span>}</td>
                    <td className="num">
                      <Link href={`/reporte/${x.owner_id}?p=${period.id}&c=${cycle}`} className="link">Abrir reporte</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  )
}
