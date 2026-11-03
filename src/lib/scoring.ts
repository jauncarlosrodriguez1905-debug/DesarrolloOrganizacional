// Misma escala que el HTML original.
export const SCORE_FACTOR: Record<number, number> = { 1: 0, 2: 0.5, 3: 0.8, 4: 1.0, 5: 1.2 }

export const SCORE_LABEL: Record<number, string> = {
  1: '1★ No Cumplió (0%)',
  2: '2★ En Desarrollo (50%)',
  3: '3★ Cumplió Objetivo (80%)',
  4: '4★ Superó Objetivo (100%)',
  5: '5★ Excelencia (120%)',
}

export function weighted(score: number | null | undefined, weight: number): number {
  return (SCORE_FACTOR[score ?? 0] ?? 0) * weight
}

export function classify(total: number): { label: string; tone: 'excellent' | 'good' | 'poor' } {
  if (total >= 100) return { label: 'Excelente / Sobresaliente', tone: 'excellent' }
  if (total >= 80) return { label: 'Cumple con las Expectativas', tone: 'good' }
  return { label: 'Requiere Plan de Mejora', tone: 'poor' }
}
