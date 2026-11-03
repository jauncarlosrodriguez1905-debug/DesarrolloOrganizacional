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
type Ev = { objective_id: string; kind: 'self' | 'manager'; score: number; comment: string | null }
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
    ? await supabase.from('evaluations').select('objective_id, kind, score, comment')
        .eq('cycle', cycle).in('objective_id', objectives.map((o) => o.id))
    : { data: [] }
  const evs = (evsData ?? []) as Ev[]

  const { data: fb } = await supabase
    .from('feedback').select('body')
    .eq('employee_id', id).eq('period_id', period.id).eq('cycle', cycle).maybeSingle()

  const { data: planData } = await supabase
    .from('action_plans').select('actions, due_date, status')
    .eq('employee_id', id).eq('period_id', period.id).eq('cycle', cycle).maybeSingle()
  const plan = planData as { actions: string; due_date: string | null; status: GoalStatus } | null

  const { data: cr } = await supabase
    .from('cycle_results').select('cycle, kind, result, evaluated, objectives')
    .eq('owner_id', id).eq('period_id', period.id)
  const cycleRows = (cr ?? []) as CycleRow[]
  const evolution = cycles.map((cy) => {
    const get = (kind: 'self' | 'manager') => {
      const r = cycleRows.find((x) => x.cycle === cy.value && x.kind === kind)
      return r && r.evaluated >= r.objectives ? Number(r.result) : null
    }
    return { value: cy.value, label: cy.label, self: get('self'), manager: get('manager') }
  })

  const quarterVals = evolution
    .filter((e) => /^T\d$/.test(e.value))
    .map((e) => e.manager)
    .filter((v): v is number => v !== null)
  const quarterAvg = quarterVals.length ? quarterVals.reduce((a, b) => a + b, 0) / quarterVals.length : null
  const hasQuarters = evolution.some((e) => /^T\d$/.test(e.value))

  const lines = objectives.map((o) => {
    const s = evs.find((e) => e.objective_id === o.id && e.kind === 'self')
    const m = evs.find((e) => e.objective_id === o.id && e.kind === 'manager')
    return { o, s, m, mPts: m ? o.weight * factor(m.score) : null }
  })
  const total = (kind: 'self' | 'manager') =>
    lines.length > 0 && lines.every((l) => (kind === 'self' ? l.s : l.m))
      ? lines.reduce((a, l) => a + l.o.weight * factor((kind === 'self' ? l.s : l.m)!.score), 0)
      : null
  const selfTotal = total('self')
  const mgrTotal = total('manager')
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
          <div><div className="rs-label">Evaluación del jefe</div><div className="rs-value">{pct(mgrTotal)}</div></div>
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
                  <th>Jefe</th>
                  <th className="num">Puntos</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ o, s, m, mPts }) => (
                  <tr key={o.id}>
                    <td>
                      <div className="cell-title">{o.title}</div>
                      <div className="cell-desc">{o.category}</div>
                      {s?.comment && <div className="cell-desc"><strong>Colaborador:</strong> {s.comment}</div>}
                      {m?.comment && <div className="cell-desc"><strong>Jefe:</strong> {m.comment}</div>}
                    </td>
                    <td className="num">{o.weight}%</td>
                    <td>{s ? <><Stars value={s.score} /><div className="cell-desc">{Math.round(factor(s.score) * 100)}%</div></> : <span className="muted">—</span>}</td>
                    <td>{m ? <><Stars value={m.score} /><div className="cell-desc">{Math.round(factor(m.score) * 100)}%</div></> : <span className="muted">—</span>}</td>
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
                {hasQuarters && (
                  <tr>
                    <td><strong>Promedio de los cuartos</strong></td>
                    <td className="num">—</td>
                    <td className="num"><strong>{pct(quarterAvg)}</strong></td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {fb?.body && (
          <section className="report-block">
            <h2 className="report-h2">Retroalimentación del jefe</h2>
            <p className="report-feedback">{fb.body}</p>
          </section>
        )}

        {plan && (
          <section className="report-block">
            <h2 className="report-h2">Plan de acción</h2>
            <p className="report-feedback">{plan.actions}</p>
            <p className="report-note">
              {plan.due_date ? `Fecha compromiso: ${formatDate(plan.due_date)} · ` : ''}Estado: {GOAL_LABEL[plan.status]}
            </p>
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
