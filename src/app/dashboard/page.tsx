import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/data'
import AppShell from '@/components/AppShell'
import CyclePills from '@/components/CyclePills'
import TrendChart from '@/components/TrendChart'
import { Stars } from '@/components/Stars'
import { cyclesFor, pickCycle, cycleLabel, shortLabel } from '@/lib/cycles'
import { classify } from '@/lib/scoring'
import { GOAL_LABEL, GOAL_BADGE, formatDate, type GoalStatus } from '@/lib/goals'

type Period = { id: string; name: string; starts_on: string; ends_on: string; status: string; allow_evaluations?: boolean }
type Kind = 'self' | 'manager'
type Row = {
  owner_id: string; period_id: string; cycle: string; kind: Kind
  full_name: string; area_id: string | null; manager_id: string | null
  result: number; evaluated: number; objectives: number
}
type Prog = {
  owner_id: string; period_id: string; full_name: string
  area_id: string | null; manager_id: string | null
  objectives: number; approved: number; submitted: number
}

const notNull = (v: number | null): v is number => v !== null
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n)}%`)
const TONE_BADGE = { excellent: 'badge--approved', good: 'badge--open', poor: 'badge--returned' } as const

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; c?: string }>
}) {
  const { p, c } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const isHr = me?.role === 'admin' || me?.role === 'do_coordinator'

  const { data: periodsData } = await supabase
    .from('periods').select('id, name, starts_on, ends_on, status, allow_evaluations')
    .neq('status', 'draft')
    .order('starts_on', { ascending: false }).limit(8)
  const periods = (periodsData ?? []) as Period[]
  const period = periods.find((x) => x.id === p) ?? periods.find((x) => x.allow_evaluations) ?? periods.find((x) => x.status === 'open') ?? periods[0]

  if (!period) {
    return (
      <AppShell title="Dashboard" subtitle="Resultados por cuarto y cierre anual.">
        <div className="notice">Aún no hay periodos. Recursos Humanos debe crear el primero.</div>
      </AppShell>
    )
  }

  const cycles = cyclesFor(period.starts_on, period.ends_on)
  const cycle = pickCycle(cycles, c)

  const [rows, progress] = await Promise.all([
    fetchAll<Row>((a, b) =>
      supabase.from('cycle_results').select('*').eq('period_id', period.id)
        .order('owner_id').order('cycle').order('kind').range(a, b)
    ),
    fetchAll<Prog>((a, b) =>
      supabase.from('person_progress').select('*').eq('period_id', period.id).order('owner_id').range(a, b)
    ),
  ])
  const { data: areasData } = await supabase.from('areas').select('id, name')
  const areaName = new Map(((areasData ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]))

  // Un resultado cuenta solo si ya se calificaron TODOS los objetivos aprobados del ciclo.
  const byKey = new Map<string, Partial<Record<Kind, Row>>>()
  rows.forEach((r) => {
    const k = `${r.owner_id}|${r.cycle}`
    const e = byKey.get(k) ?? {}
    e[r.kind] = r
    byKey.set(k, e)
  })
  const rawResult = (owner: string, cy: string, kind: Kind): number | null => {
    const r = byKey.get(`${owner}|${cy}`)?.[kind]
    return r && r.evaluated >= r.objectives ? Number(r.result) : null
  }
  // El cierre anual del jefe NO es una evaluación aparte: es el promedio de los cuartos (solo si están completos).
  const resultOf = (owner: string, cy: string, kind: Kind): number | null => {
    if (cy === 'final' && kind === 'manager') {
      const qs = cycles.filter((c) => c.value !== 'final').map((c) => rawResult(owner, c.value, 'manager'))
      return qs.length > 0 && qs.every(notNull) ? (qs as number[]).reduce((a, b) => a + b, 0) / qs.length : null
    }
    return rawResult(owner, cy, kind)
  }

  const people = progress.filter((x) => x.approved > 0)
  const scope = isHr ? people : people.filter((x) => x.owner_id !== user.id)
  const showTeam = isHr || scope.length > 0

  const mgrVals = scope.map((x) => resultOf(x.owner_id, cycle, 'manager')).filter(notNull)
  const selfVals = scope.map((x) => resultOf(x.owner_id, cycle, 'self')).filter(notNull)

  const trend = cycles.map((cy) => ({
    key: cy.value,
    label: shortLabel(cy.value),
    manager: avg(scope.map((x) => resultOf(x.owner_id, cy.value, 'manager')).filter(notNull)),
    self: avg(scope.map((x) => resultOf(x.owner_id, cy.value, 'self')).filter(notNull)),
  }))

  const dist = { excellent: 0, good: 0, poor: 0 }
  mgrVals.forEach((v) => { dist[classify(v).tone] += 1 })

  // Promedio de los cuartos (solo los cuartos con evaluación completa del jefe)
  const quarterCycles = cycles.filter((c) => /^T\d$/.test(c.value))
  const personQuarterAvg = (owner: string) => {
    const v = quarterCycles.map((c) => resultOf(owner, c.value, 'manager')).filter(notNull)
    return { avg: avg(v), n: v.length }
  }
  const groupQuarterAvgs = scope
    .map((x) => personQuarterAvg(x.owner_id).avg)
    .filter(notNull)

  const table = scope
    .map((x) => ({ ...x, self: resultOf(x.owner_id, cycle, 'self'), mgr: resultOf(x.owner_id, cycle, 'manager'), qa: personQuarterAvg(x.owner_id) }))
    .sort((a, b) => (b.mgr ?? -1) - (a.mgr ?? -1) || a.full_name.localeCompare(b.full_name))

  const areaRows = Array.from(
    table.reduce((m, x) => {
      const key = x.area_id ?? 'none'
      const e = m.get(key) ?? { n: 0, mgr: [] as number[], self: [] as number[] }
      e.n += 1
      if (x.mgr !== null) e.mgr.push(x.mgr)
      if (x.self !== null) e.self.push(x.self)
      m.set(key, e)
      return m
    }, new Map<string, { n: number; mgr: number[]; self: number[] }>())
  )
    .map(([key, e]) => ({ name: key === 'none' ? 'Sin área' : areaName.get(key) ?? 'Sin área', ...e }))
    .sort((a, b) => (avg(b.mgr) ?? -1) - (avg(a.mgr) ?? -1))

  // Mi resultado: objetivos, plan y reconocimientos no dependen entre sí.
  // Las evaluaciones sí dependen de los objetivos (necesitan sus ids).
  const [{ data: myObjs }, { data: myPlanData }, { data: myRecData }] = await Promise.all([
    supabase
      .from('objectives').select('id, title, category, weight')
      .eq('owner_id', user.id).eq('scope', 'individual').eq('status', 'approved').eq('period_id', period.id)
      .order('created_at'),
    supabase
      .from('action_plans').select('actions, due_date, status')
      .eq('employee_id', user.id).eq('period_id', period.id).eq('cycle', cycle).maybeSingle(),
    supabase
      .from('recognitions').select('cycle, body')
      .eq('employee_id', user.id).eq('period_id', period.id)
      .in('cycle', cycle === 'final' ? cycles.filter((c) => c.value !== 'final').map((c) => c.value) : [cycle])
      .order('cycle'),
  ])
  const mine = (myObjs ?? []) as { id: string; title: string; category: string; weight: number }[]
  const { data: myEvs } = mine.length
    ? await supabase.from('evaluations').select('objective_id, kind, score, cycle')
        .in('cycle', cycle === 'final' ? ['final', ...cycles.filter((c) => c.value !== 'final').map((c) => c.value)] : [cycle])
        .in('objective_id', mine.map((o) => o.id))
    : { data: [] }
  const evs = (myEvs ?? []) as { objective_id: string; kind: Kind; score: number; cycle: string }[]
  const myScore = (oid: string, kind: Kind) => {
    if (cycle === 'final' && kind === 'manager') {
      // En el cierre anual, la calificación del jefe es el promedio de los cuartos.
      const qs = evs.filter((e) => e.objective_id === oid && e.kind === 'manager' && e.cycle !== 'final').map((e) => e.score)
      return qs.length ? Math.round(qs.reduce((a, b) => a + b, 0) / qs.length) : undefined
    }
    return evs.find((e) => e.objective_id === oid && e.kind === kind && e.cycle === cycle)?.score
  }
  const myPlan = myPlanData as { actions: string; due_date: string | null; status: GoalStatus } | null
  const myRecs = (myRecData ?? []) as { cycle: string; body: string }[]
  const mySelf = resultOf(user.id, cycle, 'self')
  const myMgr = resultOf(user.id, cycle, 'manager')

  const cLabel = cycleLabel(cycles, cycle)

  return (
    <AppShell
      title="Dashboard"
      subtitle="Resultados por cuarto y cierre anual."
      meta={<span className="chip">{period.name}</span>}
    >
      <div className="filters">
        <div className="filter-group">
          <span className="filter-label">Periodo</span>
          <nav className="pills" aria-label="Trimestre">
            {periods.map((pe) => (
              <Link key={pe.id} href={`/dashboard?p=${pe.id}`} className="pill" aria-current={pe.id === period.id ? 'true' : undefined}>
                {pe.name}
              </Link>
            ))}
          </nav>
        </div>
        <div className="filter-group">
          <span className="filter-label">Ciclo</span>
          <CyclePills basePath="/dashboard" extra={`p=${period.id}`} cycles={cycles} active={cycle} />
        </div>
      </div>

      {mine.length > 0 && (
        <section className="panel" style={{ marginBottom: 28 }}>
          <div className="panel-head">
            <div>
              <h2>Mi resultado</h2>
              <p>{cLabel}</p>
            </div>
            <div className="badges">
              <span className="chip" style={{ background: '#eef1ec', color: '#3b4a45' }}>Autoevaluación {pct(mySelf)}</span>
              <span className="chip">Jefe {pct(myMgr)}</span>
              {myMgr !== null && <span className={`badge ${TONE_BADGE[classify(myMgr).tone]}`}>{classify(myMgr).label}</span>}
              <Link href={`/reporte/${user.id}?p=${period.id}&c=${cycle}`} className="link">Ver reporte</Link>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Objetivo</th><th className="num">Peso</th><th>Mi calificación</th><th>Calificación del jefe</th></tr>
              </thead>
              <tbody>
                {mine.map((o) => {
                  const s = myScore(o.id, 'self')
                  const m = myScore(o.id, 'manager')
                  return (
                    <tr key={o.id}>
                      <td><div className="cell-title">{o.title}</div><div className="cell-desc">{o.category}</div></td>
                      <td className="num">{o.weight}%</td>
                      <td>{s ? <Stars value={s} /> : <span className="muted">Pendiente</span>}</td>
                      <td>{m ? <Stars value={m} /> : <span className="muted">Aún no publicada</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {myRecs.length > 0 && (
            <div className="eval-item">
              <div className="eval-label">Reconocimiento de tu jefe</div>
              {myRecs.map((r) => (
                <p key={r.cycle} style={{ marginTop: 6 }}>
                  {cycle === 'final' && <strong>{cycleLabel(cycles, r.cycle)}: </strong>}
                  {r.body}
                </p>
              ))}
            </div>
          )}
          {myPlan && (
            <div className="eval-item" style={{ borderBottom: 0 }}>
              <div className="eval-label">Plan de acción · {cLabel}</div>
              <p style={{ marginTop: 6 }}>{myPlan.actions}</p>
              <div className="goal-meta">
                {myPlan.due_date && <span>Fecha compromiso: {formatDate(myPlan.due_date)}</span>}
                <span className={`badge ${GOAL_BADGE[myPlan.status]}`}>{GOAL_LABEL[myPlan.status]}</span>
              </div>
            </div>
          )}
        </section>
      )}

      {showTeam && (
        <>
          <h2 className="section-title">{isHr ? 'Organización' : 'Mi equipo'} · {cLabel}</h2>

          <section className="panel kpis">
            <div className="kpi">
              <div className="kpi-label">Resultado del jefe</div>
              <div className="kpi-value">{pct(avg(mgrVals))}</div>
              <div className="kpi-note">promedio del grupo</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Autoevaluación</div>
              <div className="kpi-value">{pct(avg(selfVals))}</div>
              <div className="kpi-note">promedio del grupo</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Evaluados por el jefe</div>
              <div className="kpi-value">{mgrVals.length}<span className="kpi-of"> de {scope.length}</span></div>
              <div className="kpi-note">con todos los objetivos calificados</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Autoevaluados</div>
              <div className="kpi-value">{cycle === 'final' ? <>{selfVals.length}<span className="kpi-of"> de {scope.length}</span></> : <span className="kpi-of">Solo en el cierre anual</span>}</div>
              <div className="kpi-note">con todos los objetivos calificados</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Promedio de los cuartos</div>
              <div className="kpi-value">{pct(avg(groupQuarterAvgs))}</div>
              <div className="kpi-note">{groupQuarterAvgs.length} de {scope.length} personas con al menos un cuarto</div>
            </div>
          </section>

          <div className="grid-2 dash-grid">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Resultado por ciclo</h2>
                  <p>Promedio de {period.name}. Meta de referencia: 100.</p>
                </div>
                <div className="legend">
                  <span><i className="dot dot--self" /> Autoevaluación</span>
                  <span><i className="dot dot--mgr" /> Jefe</span>
                </div>
              </div>
              <div style={{ padding: '8px 18px 18px' }}>
                {trend.some((t) => t.manager !== null || t.self !== null) ? (
                  <TrendChart points={trend} active={cycle} />
                ) : (
                  <div className="empty"><p>Todavía no hay evaluaciones completas en este periodo.</p></div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Clasificación</h2>
                  <p>Según la evaluación del jefe.</p>
                </div>
              </div>
              <div style={{ padding: '20px 26px 24px' }}>
                {mgrVals.length === 0 ? (
                  <p className="muted">Sin evaluaciones completas en este ciclo.</p>
                ) : (
                  <>
                    <div className="dist-bar" role="img" aria-label="Distribución por clasificación">
                      {(['excellent', 'good', 'poor'] as const).map((k) =>
                        dist[k] > 0 ? <span key={k} className={`seg seg--${k}`} style={{ flex: dist[k] }} /> : null
                      )}
                    </div>
                    <ul className="dist-legend">
                      <li><i className="dot seg--excellent" /> Excelente / Sobresaliente <strong>{dist.excellent}</strong></li>
                      <li><i className="dot seg--good" /> Cumple con las expectativas <strong>{dist.good}</strong></li>
                      <li><i className="dot seg--poor" /> Requiere plan de mejora <strong>{dist.poor}</strong></li>
                    </ul>
                  </>
                )}
              </div>
            </section>
          </div>

          {isHr && areaRows.length > 0 && (
            <section className="panel" style={{ marginTop: 28 }}>
              <div className="panel-head">
                <div><h2>Por área</h2><p>{cLabel}</p></div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Área</th><th className="num">Personas</th><th className="num">Autoevaluación</th><th className="num">Jefe</th></tr>
                  </thead>
                  <tbody>
                    {areaRows.map((a) => (
                      <tr key={a.name}>
                        <td className="cell-title">{a.name}</td>
                        <td className="num">{a.n}</td>
                        <td className="num">{pct(avg(a.self))}</td>
                        <td className="num">{pct(avg(a.mgr))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="panel" style={{ marginTop: 28 }}>
            <div className="panel-head">
              <div><h2>Personas</h2><p>{table.length} con objetivos aprobados.</p></div>
            </div>
            {table.length === 0 ? (
              <div className="empty"><p>Aún no hay personas con objetivos aprobados en este periodo.</p></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th><th>Área</th>
                      <th className="num">Autoevaluación</th><th className="num">Jefe</th>
                      <th className="num">Brecha</th><th className="num">Prom. cuartos</th><th>Clasificación</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((x) => {
                      const gap = x.self !== null && x.mgr !== null ? Math.round(x.self - x.mgr) : null
                      return (
                        <tr key={x.owner_id}>
                          <td className="cell-title">{x.full_name}</td>
                          <td>{x.area_id ? areaName.get(x.area_id) : <span className="muted">Sin área</span>}</td>
                          <td className="num">{pct(x.self)}</td>
                          <td className="num">{pct(x.mgr)}</td>
                          <td className={`num ${gap !== null && Math.abs(gap) >= 15 ? 'gap--wide' : ''}`} title="Autoevaluación menos evaluación del jefe">
                            {gap === null ? '—' : `${gap > 0 ? '+' : ''}${gap}`}
                          </td>
                          <td className="num" title="Promedio de la evaluación del jefe en los cuartos completos">
                            {pct(x.qa.avg)}
                            {x.qa.n > 0 && <div className="cell-desc">{x.qa.n} de {quarterCycles.length} cuartos</div>}
                          </td>
                          <td>
                            {x.mgr !== null ? (
                              <span className={`badge ${TONE_BADGE[classify(x.mgr).tone]}`}>{classify(x.mgr).label}</span>
                            ) : (
                              <span className="muted">Pendiente</span>
                            )}
                          </td>
                          <td className="num">
                            <Link href={`/reporte/${x.owner_id}?p=${period.id}&c=${cycle}`} className="link">Reporte</Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {!showTeam && mine.length === 0 && (
        <div className="notice">
          Todavía no tienes objetivos aprobados en {period.name}. Cuando tu jefe los apruebe, aquí verás tus resultados.
        </div>
      )}
    </AppShell>
  )
}
