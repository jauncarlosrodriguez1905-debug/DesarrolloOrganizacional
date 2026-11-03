export type TrendPoint = { key: string; label: string; manager: number | null; self: number | null }

/** Barras agrupadas (autoevaluación vs jefe) por ciclo, dibujadas en SVG en el servidor. */
export default function TrendChart({ points, active }: { points: TrendPoint[]; active: string }) {
  const W = 640, H = 250, L = 40, R = 12, T = 18, B = 32
  const plotW = W - L - R
  const plotH = H - T - B
  const MAX = 120
  const y = (v: number) => T + plotH - (Math.min(v, MAX) / MAX) * plotH
  const slot = plotW / points.length
  const barW = Math.min(28, slot * 0.28)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Resultado promedio por ciclo: autoevaluación y jefe">
      {[0, 40, 80, 100, 120].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 100 ? 'chart-goal' : 'chart-grid'} />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" className="chart-axis">{t}</text>
        </g>
      ))}
      {points.map((p, i) => {
        const cx = L + slot * i + slot / 2
        return (
          <g key={p.key}>
            {p.key === active && <rect x={L + slot * i + 4} y={T} width={slot - 8} height={plotH} className="chart-active" rx={6} />}
            {p.self !== null && (
              <>
                <rect x={cx - barW - 2} y={y(p.self)} width={barW} height={y(0) - y(p.self)} className="bar-self" rx={3} />
                <text x={cx - barW / 2 - 2} y={y(p.self) - 5} className="chart-val">{Math.round(p.self)}</text>
              </>
            )}
            {p.manager !== null && (
              <>
                <rect x={cx + 2} y={y(p.manager)} width={barW} height={y(0) - y(p.manager)} className="bar-manager" rx={3} />
                <text x={cx + barW / 2 + 2} y={y(p.manager) - 5} className="chart-val">{Math.round(p.manager)}</text>
              </>
            )}
            <text x={cx} y={H - 10} textAnchor="middle" className="chart-axis">{p.label}</text>
          </g>
        )
      })}
    </svg>
  )
}
