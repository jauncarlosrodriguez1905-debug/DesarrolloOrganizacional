// Escala Likert de 5 puntos, con tope en 100%: factor = puntos / 5.
// 1 = 20%, 2 = 40%, 3 = 60%, 4 = 80%, 5 = 100%. Antes el 5 valía 120%.
export const SCORE_FACTOR: Record<number, number> = { 1: 0.2, 2: 0.4, 3: 0.6, 4: 0.8, 5: 1.0 }

export const SCORE_LABEL: Record<number, string> = {
  1: '1★ Totalmente en desacuerdo (20%)',
  2: '2★ En desacuerdo (40%)',
  3: '3★ Ni de acuerdo ni en desacuerdo (60%)',
  4: '4★ De acuerdo (80%)',
  5: '5★ Totalmente de acuerdo (100%)',
}

export function weighted(score: number | null | undefined, weight: number): number {
  return (SCORE_FACTOR[score ?? 0] ?? 0) * weight
}

export function classify(total: number): { label: string; tone: 'excellent' | 'good' | 'poor' } {
  if (total >= 100) return { label: 'Excelente / Sobresaliente', tone: 'excellent' }
  if (total >= 80) return { label: 'Cumple con las Expectativas', tone: 'good' }
  return { label: 'Requiere Plan de Mejora', tone: 'poor' }
}
