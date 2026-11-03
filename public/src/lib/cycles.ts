const SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

/** range = [mes inicial, mes final] en meses absolutos (año*12 + mes0), solo para los cuartos. */
export type Cycle = { value: string; label: string; range?: [number, number] }

/**
 * Solo existen 3 cuartos: T1 ene–mar, T2 abr–jun y T3 jul–sep.
 * Octubre a diciembre NO es un cuarto: es el cierre anual y la planeación del año siguiente.
 * Se ofrecen los cuartos que se traslapan con el periodo, más el cierre anual ('final').
 */
export function cyclesFor(startsOn: string, endsOn: string): Cycle[] {
  const [sy, sm] = startsOn.split('-').map(Number)
  const [ey, em] = endsOn.split('-').map(Number)
  const startAbs = sy * 12 + (sm - 1)
  const endAbs = ey * 12 + (em - 1)
  const out: Cycle[] = []
  for (let y = sy; y <= ey; y++) {
    for (let q = 0; q < 3; q++) {
      const a = y * 12 + q * 3
      const b = a + 2
      if (b < startAbs || a > endAbs) continue
      out.push({
        value: `T${q + 1}`,
        label: `Cuarto ${q + 1} · ${SHORT[q * 3]}–${SHORT[q * 3 + 2]}`,
        range: [Math.max(a, startAbs), Math.min(b, endAbs)],
      })
    }
  }
  out.push({ value: 'final', label: 'Cierre anual' })
  return out
}

/** Ciclo pedido en la URL si es válido; si no, el cuarto en curso; si no, el cierre anual. */
export function pickCycle(cycles: Cycle[], requested?: string): string {
  if (requested && cycles.some((c) => c.value === requested)) return requested
  const now = new Date()
  const abs = now.getFullYear() * 12 + now.getMonth()
  return cycles.find((c) => c.range && abs >= c.range[0] && abs <= c.range[1])?.value ?? 'final'
}

export const cycleLabel = (cycles: Cycle[], value: string) => cycles.find((c) => c.value === value)?.label ?? value

export const shortLabel = (value: string) =>
  value === 'final' ? 'Anual' : /^T\d+$/.test(value) ? `C${value.slice(1)}` : value
