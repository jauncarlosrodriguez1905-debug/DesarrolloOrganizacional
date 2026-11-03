import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import CyclePills from '@/components/CyclePills'
import PrintButton from '@/components/PrintButton'
import { Stars } from '@/components/Stars'
import { cyclesFor, pickCycle, cycleLabel } from '@/lib/cycles'
import { SCORE_FACTOR, classify } from '@/lib/scoring'
import { formatDate, GOAL_LABEL, type GoalStatus } from '@/lib/goals'

type Period = { id: string; name: string; starts_on: string; ends_on: string; status: string; allow_evaluations?: boolean }
type Objective = { id: string; category: string; title: string; description: string | null; weight: number }
type Ev = { objective_id: string; kind: 'self' | 'manager'; score: number; comment: string | null; cycle: string }
type CycleRow = { cycle: string; kind: 'self' | 'manager'; result: number; evaluated: number; objectives: number }

const TONE_BADGE = { excellent: 'badge--approved', good: 'badge--open', poor: 'badge--returned' } as const
const factor = (score: number) => SCORE_FACTOR[score] ?? 0
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n)}%`)
const pts = (n: number | null) => (n === null ? '—' : n.toFixed(1))

export default async function ReportePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ p?: string; c?: string }>
}) {
  const { id } = await params
  const { p, c } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Los permisos los decide RLS: cada quien solo puede leer a las personas que le corresponden.
  const { data: person } = await supabase
    .from('profiles').select('id, full_name, employee_code, area_id, manager_id').eq('id', id).maybeSingle()
  if (!person) notFound()

  const { data: periodsData } = await supabase
    .from('periods').select('id, name, starts_on, ends_on, status, allow_evaluations')
    .neq('status', 'draft')
    .order('starts_on', { ascending: false }).limit(8)
  const periods = (periodsData ?? []) as Period[]
  const period = periods.find((x) => x.id === p) ?? periods.find((x) => x.allow_evaluations) ?? periods.find((x) => x.status === 'open') ?? periods[0]
  if (!period) notFound()

  const cycles = cyclesFor(period.starts_on, period.ends_on)
  const cycle = pickCycle(cycles, c)
  const cLabel = cycleLabel(cycles, cycle)
  // El cierre anual del jefe es el promedio de los cuartos: se leen las evaluaciones de todos los cuartos.
  const isAnnual = cycle === 'final'
  const qValues = cycles.filter((c) => c.value !== 'final').map((c) => c.value)
  const evCycles = isAnnual ? ['final', ...qValues] : [cycle]

  const [{ data: area }, { data: boss }] = await Promise.all([
    person.area_id
      ? supabase.from('areas').select('name').eq('id', person.area_id).maybeSingle()
      : Promise.resolve({ data: null }),
    person.manager_id
      ? supabase.from('profiles').select('full_name').eq('id', person.manager_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const { data: objs } = await supabase
    .from('objectives').select('id, category, title, description, weight')
    .eq('owner_id', id).eq('scope', 'individual').eq('status', 'approved').eq('period_id', period.id)
    .order('created_at')
  const objectives = (objs ?? []) as Objective[]

  const { data: evsData } = objectives.length
    ? await supabase.from('evaluations').select('objective_id, kind, score, comment, cycle')
        .in('cycle', evCycles).in('objective_id', objectives.map((o) => o.id))
    : { data: [] }
  const evs = (evsData ?? []) as Ev[]

  const { data: fbData } = await supabase
    .from('feedback').select('cycle, body')
    .eq('employee_id', id).eq('period_id', period.id).in('cycle', isAnnual ? qValues : [cycle]).order('cycle')
  const feedbacks = (fbData ?? []) as { cycle: string; body: string }[]

  const { data: recsData } = await supabase
    .from('recognitions').select('cycle, body')
    .eq('employee_id', id).eq('period_id', period.id).in('cycle', isAnnual ? qValues : [cycle]).order('cycle')
  const recognitions = (recsData ?? []) as { cycle: string; body: string }[]

  const { data: plansData } = await supabase
    .from('action_plans').select('cycle, actions, due_date, status')
    .eq('employee_id', id).eq('period_id', period.id).in('cycle', isAnnual ? qValues : [cycle]).order('cycle')
  const plans = (plansData ?? []) as { cycle: string; actions: string; due_date: string | null; status: GoalStatus }[]

  const { data: cr } = await supabase
    .from('cycle_results').select('cycle, kind, result, evaluated, objectives')
    .eq('owner_id', id).eq('period_id', period.id)
  const cycleRows = (cr ?? []) as CycleRow[]
  const evolutionBase = cycles.map((cy) => {
    const get = (kind: 'self' | 'manager') => {
      const r = cycleRows.find((x) => x.cycle === cy.value && x.kind === kind)
      return r && r.evaluated >= r.objectives ? Number(r.result) : null
    }
    return { value: cy.value, label: cy.label, self: get('self'), manager: get('manager') }
  })
  // Cierre anual del jefe = promedio de los cuartos (solo cuando están todos completos).
  const qMgr = evolutionBase.filter((e) => /^T\d$/.test(e.value)).map((e) => e.manager)
  const annualAvg = qMgr.length > 0 && qMgr.every((v) => v !== null) ? (qMgr as number[]).reduce((x, y) => x + y, 0) / qMgr.length : null
  const evolution = evolutionBase.map((e) => (e.value === 'final' ? { ...e, manager: annualAvg } : e))

  const avgOf = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length
  const lines = objectives.map((o) => {
    const s = evs.find((e) => e.objective_id === o.id && e.kind === 'self' && e.cycle === cycle)
    let mScore: number | null = null
    let mF: number | null = null
    let mComment: string | null = null
    if (isAnnual) {
      // El cierre anual del jefe es el promedio de los cuartos (solo si todos están calificados).
      const qs = qValues
        .map((q) => evs.find((e) => e.objective_id === o.id && e.kind === 'manager' && e.cycle === q))
        .filter((e): e is Ev => !!e)
      if (qValues.length > 0 && qs.length === qValues.length) {
        mScore = avgOf(qs.map((e) => e.score))
        mF = avgOf(qs.map((e) => factor(e.score)))
      }
    } else {
      const m = evs.find((e) => e.objective_id === o.id && e.kind === 'manager' && e.cycle === cycle)
      if (m) { mScore = m.score; mF = factor(m.score); mComment = m.comment }
    }
    return { o, s, mScore, mF, mComment, mPts: mF !== null ? o.weight * mF : null }
  })
  const selfTotal =
    lines.length > 0 && lines.every((l) => l.s)
      ? lines.reduce((acc, l) => acc + l.o.weight * factor(l.s!.score), 0)
      : null
  const mgrTotal =
    lines.length > 0 && lines.every((l) => l.mF !== null)
      ? lines.reduce((acc, l) => acc + l.o.weight * l.mF!, 0)
      : null
  const gap = selfTotal !== null && mgrTotal !== null ? Math.round(selfTotal - mgrTotal) : null
  const verdict = mgrTotal !== null ? classify(mgrTotal) : null
  const weightSum = objectives.reduce((a, o) => a + o.weight, 0)
  const today = formatDate(new Date().toISOString().slice(0, 10))
  const filename = `Reporte de desempeño - ${person.full_name} - ${cLabel}`

  return (
    <AppShell
      title="Reporte"
      subtitle={`Reporte de ${person.full_name}.`}
      meta={<span className="chip">{period.name}</span>}
    >
      <div className="no-print">
        <div className="filters">
          <div className="filter-group">
            <span className="filter-label">Periodo</span>
            <nav className="pills" aria-label="Trimestre">
              {periods.map((pe) => (
                <Link key={pe.id} href={`/reporte/${id}?p=${pe.id}`} className="pill" aria-current={pe.id === period.id ? 'true' : undefined}>
                  {pe.name}
                </Link>
              ))}
            </nav>
          </div>
          <div className="filter-group">
            <span className="filter-label">Ciclo</span>
            <CyclePills basePath={`/reporte/${id}`} extra={`p=${period.id}`} cycles={cycles} active={cycle} />
          </div>
        </div>
        <div className="report-toolbar">
          <Link href={`/reporte?p=${period.id}&c=${cycle}`} className="link">← Todos los reportes</Link>
          <div className="row-actions" style={{ alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 13 }}>En el diálogo, elige “Guardar como PDF”.</span>
            <PrintButton filename={filename} />
          </div>
        </div>
      </div>

      <article className="report">
        <table className="print-frame">
          <thead><tr><td><div className="print-pad" /></td></tr></thead>
          <tbody><tr><td>
        <header className="report-head">
          <div className="report-brand">
            <Image src="/jbi-logo.png" alt="JBI" width={96} height={96} className="brand-logo" />
            <div>
              <div className="report-kicker">Reporte de desempeño</div>
              <h1 className="report-title">{person.full_name}</h1>
            </div>
          </div>
          <div className="report-period">
            <div><strong>{period.name}</strong></div>
            <div>{cLabel}</div>
          </div>
        </header>

        <dl className="report-meta">
          <div><dt>Código de empleado</dt><dd>{person.employee_code ?? '—'}</dd></div>
          <div><dt>Área</dt><dd>{area?.name ?? '—'}</dd></div>
          <div><dt>Jefe directo</dt><dd>{boss?.full_name ?? '—'}</dd></div>
          <div><dt>Periodo</dt><dd>{formatDate(period.starts_on)} a {formatDate(period.ends_on)}</dd></div>
        </dl>

        <section className="report-summary report-block">
          <div><div className="rs-label">Autoevaluación</div><div className="rs-value">{pct(selfTotal)}</div></div>
          <div><div className="rs-label">{isAnnual ? 'Promedio de los cuartos' : 'Evaluación del jefe'}</div><div className="rs-value">{pct(mgrTotal)}</div></div>
          <div><div className="rs-label">Brecha</div><div className="rs-value">{gap === null ? '—' : `${gap > 0 ? '+' : ''}${gap}`}</div></div>
          <div>
            <div className="rs-label">Clasificación</div>
            <div style={{ marginTop: 8 }}>
              {verdict ? <span className={`badge ${TONE_BADGE[verdict.tone]}`}>{verdict.label}</span> : <span className="muted">Pendiente</span>}
            </div>
          </div>
        </section>

        {objectives.length === 0 ? (
          <p className="muted" style={{ margin: '28px 0' }}>No hay objetivos aprobados en este periodo.</p>
        ) : (
          <>
            <h2 className="report-h2">Objetivos</h2>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Objetivo</th>
                  <th className="num">Peso</th>
                  <th>Autoevaluación</th>
                  <th>{isAnnual ? 'Jefe (promedio)' : 'Jefe'}</th>
                  <th className="num">Puntos</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ o, s, mScore, mF, mComment, mPts }) => (
                  <tr key={o.id}>
                    <td>
                      <div className="cell-title">{o.title}</div>
                      <div className="cell-desc">{o.category}</div>
                      {s?.comment && <div className="cell-desc"><strong>Colaborador:</strong> {s.comment}</div>}
                      {mComment && <div className="cell-desc"><strong>Jefe:</strong> {mComment}</div>}
                    </td>
                    <td className="num">{o.weight}%</td>
                    <td>{s ? <><Stars value={s.score} /><div className="cell-desc">{Math.round(factor(s.score) * 100)}%</div></> : <span className="muted">—</span>}</td>
                    <td>{mScore !== null && mF !== null ? <><Stars value={Math.round(mScore)} /><div className="cell-desc">{isAnnual ? `Promedio ${mScore.toFixed(1)} · ` : ''}{Math.round(mF * 100)}%</div></> : <span className="muted">—</span>}</td>
                    <td className="num">{pts(mPts)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{weightSum}%</td>
                  <td>{pct(selfTotal)}</td>
                  <td>{pct(mgrTotal)}</td>
                  <td className="num">{pts(mgrTotal)}</td>
                </tr>
              </tfoot>
            </table>
            {(selfTotal === null || mgrTotal === null) && (
              <p className="report-note">
                El resultado se calcula cuando todos los objetivos están calificados. Los porcentajes pendientes aparecen como “—”.
              </p>
            )}

            <h2 className="report-h2">Evolución del año</h2>
            <table className="report-table report-table--compact report-block">
              <thead><tr><th>Ciclo</th><th className="num">Autoevaluación</th><th className="num">Jefe</th></tr></thead>
              <tbody>
                {evolution.map((e) => (
                  <tr key={e.label}><td>{e.label}</td><td className="num">{pct(e.self)}</td><td className="num">{pct(e.manager)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {recognitions.length > 0 && (
          <section className="report-block">
            <h2 className="report-h2">Reconocimiento positivo</h2>
            {recognitions.map((r) => (
              <div key={r.cycle}>
                {isAnnual && <div className="report-note" style={{ margin: '12px 0 6px' }}>{cycleLabel(cycles, r.cycle)}</div>}
                <p className="report-feedback">{r.body}</p>
              </div>
            ))}
          </section>
        )}

        {feedbacks.length > 0 && (
          <section className="report-block">
            <h2 className="report-h2">Retroalimentación del jefe</h2>
            {feedbacks.map((f) => (
              <div key={f.cycle}>
                {isAnnual && <div className="report-note" style={{ margin: '12px 0 6px' }}>{cycleLabel(cycles, f.cycle)}</div>}
                <p className="report-feedback">{f.body}</p>
              </div>
            ))}
          </section>
        )}

        {plans.length > 0 && (
          <section className="report-block">
            <h2 className="report-h2">{isAnnual ? 'Planes de acción del año' : 'Plan de acción'}</h2>
            {plans.map((pl) => (
              <div key={pl.cycle}>
                {isAnnual && <div className="report-note" style={{ margin: '12px 0 6px' }}>{cycleLabel(cycles, pl.cycle)}</div>}
                <p className="report-feedback">{pl.actions}</p>
                <p className="report-note">
                  {pl.due_date ? `Fecha compromiso: ${formatDate(pl.due_date)} · ` : ''}Estado: {GOAL_LABEL[pl.status]}
                </p>
              </div>
            ))}
          </section>
        )}

        <section className="report-sign report-block">
          <div><div className="sign-line" />Colaborador</div>
          <div><div className="sign-line" />Jefe directo</div>
          <div><div className="sign-line" />Recursos Humanos</div>
        </section>

        <footer className="report-foot">
          <span>Documento confidencial · Generado el {today}</span>
          <span>JBI · Gestión del desempeño</span>
        </footer>
      </td></tr></tbody>
          <tfoot><tr><td><div className="print-pad" /></td></tr></tfoot>
        </table>
      </article>
    </AppShell>
  )
}
