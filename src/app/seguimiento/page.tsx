import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/data'
import AppShell from '@/components/AppShell'
import PeriodPills from '@/components/PeriodPills'
import { loadPeriods, pickPeriod } from '@/lib/periods'
import { cyclesFor } from '@/lib/cycles'
import { LOW_THRESHOLD } from '@/lib/plans'

type Person = { id: string; full_name: string; area_id: string | null; manager_id: string | null }
type Prog = { owner_id: string; objectives: number; approved: number; submitted: number; returned: number }
type Row = { owner_id: string; cycle: string; kind: 'self' | 'manager'; evaluated: number; objectives: number; published: boolean | null; result: number }
type Tone = 'ok' | 'info' | 'warn' | 'muted'
type State = { label: string; tone: Tone; done: boolean }

const TONE: Record<Tone, string> = {
  ok: 'badge--approved',
  info: 'badge--submitted',
  warn: 'badge--returned',
  muted: 'badge--draft',
}

function objState(p?: Prog): State {
  if (!p || p.objectives === 0) return { label: 'Sin objetivos', tone: 'warn', done: false }
  if (p.approved === p.objectives) return { label: 'Aprobados', tone: 'ok', done: true }
  if (p.submitted > 0) return { label: 'En revisión', tone: 'info', done: false }
  if (p.returned > 0) return { label: 'Devueltos', tone: 'warn', done: false }
  return { label: 'Borrador', tone: 'muted', done: false }
}

function evalState(r: Row | undefined, kind: 'self' | 'manager'): State {
  if (!r) return { label: 'Pendiente', tone: 'muted', done: false }
  if (r.evaluated < r.objectives) return { label: 'Parcial', tone: 'warn', done: false }
  if (kind === 'manager') {
    return r.published
      ? { label: 'Publicada', tone: 'ok', done: true }
      : { label: 'Sin publicar', tone: 'info', done: false }
  }
  return { label: 'Completa', tone: 'ok', done: true }
}

function Chip({ s }: { s: State | null }) {
  if (!s) return <span className="muted">—</span>
  return <span className={`badge ${TONE[s.tone]}`}>{s.label}</span>
}

function Frac({ n, d }: { n: number; d: number }) {
  if (d === 0) return <span className="muted">—</span>
  return (
    <div className="frac">
      <span>{n}/{d}</span>
      <div className="mini"><i style={{ width: `${Math.round((n / d) * 100)}%` }} /></div>
    </div>
  )
}

export default async function SeguimientoPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; a?: string; q?: string }>
}) {
  const { p, a, q } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const isHr = me?.role === 'admin' || me?.role === 'do_coordinator'

  // Alcance: RH ve a toda la planta; un jefe, solo a su equipo. Los demás no tienen este panel.
  let people: Person[]
  if (isHr) {
    people = await fetchAll<Person>((from, to) =>
      supabase.from('profiles').select('id, full_name, area_id, manager_id')
        .eq('active', true).order('full_name').range(from, to)
    )
  } else {
    const { data } = await supabase.from('profiles').select('id, full_name, area_id, manager_id')
      .eq('manager_id', user.id).eq('active', true).order('full_name')
    people = (data ?? []) as Person[]
    if (people.length === 0) redirect('/dashboard')
  }

  const periods = await loadPeriods(supabase)
  const period = pickPeriod(periods, p, 'evaluations')

  if (!period) {
    return (
      <AppShell title="Seguimiento" subtitle="Estatus de cada fase por persona y por área.">
        <div className="notice">Aún no hay un periodo activo.</div>
      </AppShell>
    )
  }

  const cycles = cyclesFor(period.starts_on, period.ends_on)
  const quarters = cycles.filter((c) => c.value !== 'final')

  // Las 5 consultas solo dependen del periodo: todas en paralelo en vez
  // de una tras otra (antes eran 3 viajes seguidos después del primero).
  const [progress, rows, plans, recs, { data: areasData }] = await Promise.all([
    fetchAll<Prog>((from, to) =>
      supabase.from('person_progress').select('owner_id, objectives, approved, submitted, returned')
        .eq('period_id', period.id).order('owner_id').range(from, to)
    ),
    fetchAll<Row>((from, to) =>
      supabase.from('cycle_results').select('owner_id, cycle, kind, evaluated, objectives, published, result')
        .eq('period_id', period.id).order('owner_id').order('cycle').order('kind').range(from, to)
    ),
    fetchAll<{ employee_id: string; cycle: string }>((from, to) =>
      supabase.from('action_plans').select('employee_id, cycle')
        .eq('period_id', period.id).order('employee_id').order('cycle').range(from, to)
    ),
    fetchAll<{ employee_id: string; cycle: string }>((from, to) =>
      supabase.from('recognitions').select('employee_id, cycle')
        .eq('period_id', period.id).order('employee_id').order('cycle').range(from, to)
    ),
    supabase.from('areas').select('id, name').order('name'),
  ])
  const planSet = new Set(plans.map((x) => `${x.employee_id}|${x.cycle}`))
  const recSet = new Set(recs.map((x) => `${x.employee_id}|${x.cycle}`))
  const areas = (areasData ?? []) as { id: string; name: string }[]
  const areaName = new Map(areas.map((x) => [x.id, x.name]))
  const personName = new Map(people.map((x) => [x.id, x.full_name]))

  const progOf = new Map(progress.map((x) => [x.owner_id, x]))
  const rowOf = new Map(rows.map((r) => [`${r.owner_id}|${r.cycle}|${r.kind}`, r]))
  const get = (id: string, cycle: string, kind: 'self' | 'manager') => rowOf.get(`${id}|${cycle}|${kind}`)

  const term = (q ?? '').trim().toLowerCase()
  const nameOfArea = (x: Person) => (x.area_id ? areaName.get(x.area_id) ?? 'Sin área' : 'Sin área')
  const list = people
    .filter((x) => !term || x.full_name.toLowerCase().includes(term))
    .filter((x) => !isHr || !a || (a === 'none' ? !x.area_id : x.area_id === a))
    .sort((x, y) => nameOfArea(x).localeCompare(nameOfArea(y)) || x.full_name.localeCompare(y.full_name))

  // Cuartos con porcentaje bajo (< LOW_THRESHOLD) y si ya tienen plan de acción
  const lowCycles = (id: string) =>
    quarters.filter((c) => {
      const r = rowOf.get(`${id}|${c.value}|manager`)
      return !!r && r.evaluated >= r.objectives && Number(r.result) < LOW_THRESHOLD
    })
  // Cuartos ya calificados por el jefe: necesitan su reconocimiento positivo para poder publicarse
  const gradedQuarters = (id: string) =>
    quarters.filter((c) => {
      const r = rowOf.get(`${id}|${c.value}|manager`)
      return !!r && r.evaluated >= r.objectives
    })
  const recState = (id: string): State | null => {
    const graded = gradedQuarters(id)
    if (graded.length === 0) return null
    const missing = graded.filter((c) => !recSet.has(`${id}|${c.value}`)).length
    return missing > 0
      ? { label: `Falta (${missing})`, tone: 'warn', done: false }
      : { label: 'Completo', tone: 'ok', done: true }
  }
  const planState = (id: string): State | null => {
    const lows = lowCycles(id)
    if (lows.length === 0) return null
    const missing = lows.filter((c) => !planSet.has(`${id}|${c.value}`)).length
    return missing > 0
      ? { label: `Falta plan (${missing})`, tone: 'warn', done: false }
      : { label: 'Con plan', tone: 'ok', done: true }
  }

  const hasApproved = (x: Person) => (progOf.get(x.id)?.approved ?? 0) > 0
  const eligible = list.filter(hasApproved) // las fases de evaluación solo aplican a quien ya tiene objetivos aprobados

  // ----- Resumen por fase -----
  const objStates = list.map((x) => objState(progOf.get(x.id)))
  const count = (states: State[], label: string) => states.filter((s) => s.label === label).length
  type Card = { kicker: string; title: string; done: number; total: number; note: string }
  const cards: Card[] = [
    {
      kicker: 'Fase 1',
      title: 'Objetivos aprobados',
      done: objStates.filter((s) => s.done).length,
      total: list.length,
      note: `${count(objStates, 'En revisión')} en revisión · ${count(objStates, 'Devueltos')} devueltos · ${count(objStates, 'Sin objetivos')} sin objetivos`,
    },
  ]
  quarters.forEach((c) => {
    const st = eligible.map((x) => evalState(get(x.id, c.value, 'manager'), 'manager'))
    cards.push({
      kicker: `Fase 2 · ${c.label}`,
      title: 'Evaluación del jefe',
      done: st.filter((s) => s.done).length,
      total: eligible.length,
      note: `${count(st, 'Sin publicar')} sin publicar · ${count(st, 'Pendiente') + count(st, 'Parcial')} pendientes`,
    })
  })
  const gradedTotal = eligible.reduce((a, x) => a + gradedQuarters(x.id).length, 0)
  const gradedWithRec = eligible.reduce(
    (a, x) => a + gradedQuarters(x.id).filter((c) => recSet.has(`${x.id}|${c.value}`)).length, 0)
  cards.push({
    kicker: 'Fase 2 · Reconocimiento',
    title: 'Reconocimientos positivos',
    done: gradedWithRec,
    total: gradedTotal,
    note: gradedTotal === 0
      ? 'Aún no hay cuartos calificados'
      : `${gradedTotal - gradedWithRec} cuartos sin reconocimiento: no se pueden publicar`,
  })
  const lowTotal = eligible.reduce((a, x) => a + lowCycles(x.id).length, 0)
  const lowWithPlan = eligible.reduce(
    (a, x) => a + lowCycles(x.id).filter((c) => planSet.has(`${x.id}|${c.value}`)).length, 0)
  cards.push({
    kicker: 'Fase 2 · Acciones',
    title: 'Planes de acción',
    done: lowWithPlan,
    total: lowTotal,
    note: lowTotal === 0
      ? `Ningún cuarto por debajo de ${LOW_THRESHOLD}%`
      : `${lowTotal - lowWithPlan} cuartos con porcentaje bajo sin plan`,
  })
  const selfSt = eligible.map((x) => evalState(get(x.id, 'final', 'self'), 'self'))
  // El cierre anual del jefe no es otra evaluación: es el promedio de los cuartos.
  const annualState = (id: string): State | null => {
    if (quarters.length === 0) return null
    const st = quarters.map((c) => evalState(get(id, c.value, 'manager'), 'manager'))
    const published = st.filter((s) => s.done).length
    if (published === quarters.length) return { label: 'Completo', tone: 'ok', done: true }
    if (published > 0) return { label: `${published} de ${quarters.length} cuartos`, tone: 'info', done: false }
    return { label: 'Pendiente', tone: 'muted', done: false }
  }
  const mgrSt: State[] = eligible.map((x) => annualState(x.id) ?? { label: 'Pendiente', tone: 'muted', done: false })
  cards.push({
    kicker: 'Fase 3 · Cierre anual',
    title: 'Autoevaluación',
    done: selfSt.filter((s) => s.done).length,
    total: eligible.length,
    note: `${count(selfSt, 'Parcial')} parciales · ${count(selfSt, 'Pendiente')} pendientes`,
  })
  cards.push({
    kicker: 'Fase 3 · Cierre anual',
    title: 'Promedio de los cuartos',
    done: mgrSt.filter((s) => s.done).length,
    total: eligible.length,
    note: `${count(mgrSt, 'Pendiente')} sin ningún cuarto · ${eligible.length - mgrSt.filter((s) => s.done).length - count(mgrSt, 'Pendiente')} en proceso`,
  })

  // ----- Por área (solo RH, sin filtro de área) -----
  const byArea = new Map<string, Person[]>()
  list.forEach((x) => {
    const k = nameOfArea(x)
    byArea.set(k, [...(byArea.get(k) ?? []), x])
  })
  const areaRows = Array.from(byArea.entries()).map(([name, ppl]) => {
    const el = ppl.filter(hasApproved)
    return {
      name,
      n: ppl.length,
      obj: ppl.filter((x) => objState(progOf.get(x.id)).done).length,
      el: el.length,
      q: quarters.map((c) => el.filter((x) => evalState(get(x.id, c.value, 'manager'), 'manager').done).length),
      self: el.filter((x) => evalState(get(x.id, 'final', 'self'), 'self').done).length,
      mgr: el.filter((x) => annualState(x.id)?.done).length,
    }
  })

  return (
    <AppShell
      title="Seguimiento"
      subtitle="Estatus de cada fase por persona y por área: qué está completo y qué está detenido."
      meta={<span className="chip">{period.name}</span>}
    >
      <div style={{ marginBottom: 20 }}>
        <PeriodPills basePath="/seguimiento" periods={periods} active={period.id} />
      </div>

      <form action="/seguimiento" method="get" className="filter-bar">
        <input type="hidden" name="p" value={period.id} />
        {isHr && (
          <label className="field" style={{ margin: 0 }}>
            <span>Área</span>
            <select name="a" defaultValue={a ?? ''}>
              <option value="">Todas las áreas</option>
              {areas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              <option value="none">Sin área</option>
            </select>
          </label>
        )}
        <label className="field" style={{ margin: 0 }}>
          <span>Buscar persona</span>
          <input name="q" defaultValue={q ?? ''} placeholder="Nombre" />
        </label>
        <button type="submit" className="btn btn--inline btn--ghost">Aplicar</button>
      </form>

      <div className="phase-grid">
        {cards.map((c, i) => (
          <section className="phase-card" key={i}>
            <div className="phase-kicker">{c.kicker}</div>
            <div className="phase-title">{c.title}</div>
            <div className="phase-num">
              {c.total === 0 ? '—' : <>{c.done}<span className="kpi-of"> de {c.total}</span></>}
            </div>
            <div className="mini mini--wide"><i style={{ width: c.total ? `${Math.round((c.done / c.total) * 100)}%` : '0%' }} /></div>
            <div className="phase-note">{c.note}</div>
          </section>
        ))}
      </div>

      {isHr && !a && areaRows.length > 1 && (
        <section className="panel" style={{ marginTop: 28 }}>
          <div className="panel-head">
            <div><h2>Por área</h2><p>Personas que ya completaron cada fase.</p></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Área</th>
                  <th>Objetivos aprobados</th>
                  {quarters.map((c) => <th key={c.value}>Jefe · C{c.value.slice(1)}</th>)}
                  <th>Autoevaluación</th>
                  <th>Promedio anual</th>
                </tr>
              </thead>
              <tbody>
                {areaRows.map((r) => (
                  <tr key={r.name}>
                    <td className="cell-title">{r.name}</td>
                    <td><Frac n={r.obj} d={r.n} /></td>
                    {r.q.map((n, i) => <td key={i}><Frac n={n} d={r.el} /></td>)}
                    <td><Frac n={r.self} d={r.el} /></td>
                    <td><Frac n={r.mgr} d={r.el} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel" style={{ marginTop: 28 }}>
        <div className="panel-head">
          <div><h2>Personas</h2><p>{list.length} {list.length === 1 ? 'persona' : 'personas'}.</p></div>
        </div>
        {list.length === 0 ? (
          <div className="empty"><p>No hay personas con ese filtro.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Objetivos</th>
                  {quarters.map((c) => <th key={c.value}>Jefe · Q{c.value.slice(1)}</th>)}
                  <th>Autoevaluación</th>
                  <th>Promedio anual</th>
                  <th>Reconocimiento</th>
                  <th>Plan de acción</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((x) => {
                  const ok = hasApproved(x)
                  return (
                    <tr key={x.id}>
                      <td>
                        <div className="cell-title">{x.full_name}</div>
                        <div className="cell-desc">
                          {nameOfArea(x)}
                          {isHr && x.manager_id && personName.get(x.manager_id) ? ` · Jefe: ${personName.get(x.manager_id)}` : ''}
                        </div>
                      </td>
                      <td><Chip s={objState(progOf.get(x.id))} /></td>
                      {quarters.map((c) => (
                        <td key={c.value}><Chip s={ok ? evalState(get(x.id, c.value, 'manager'), 'manager') : null} /></td>
                      ))}
                      <td><Chip s={ok ? evalState(get(x.id, 'final', 'self'), 'self') : null} /></td>
                      <td><Chip s={ok ? annualState(x.id) : null} /></td>
                      <td><Chip s={ok ? recState(x.id) : null} /></td>
                      <td><Chip s={ok ? planState(x.id) : null} /></td>
                      <td className="num">
                        {ok && <Link href={`/reporte/${x.id}?p=${period.id}&c=final`} className="link">Reporte</Link>}
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
