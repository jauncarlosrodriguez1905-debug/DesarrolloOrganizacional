import type { SupabaseClient } from '@supabase/supabase-js'

export type PeriodFull = {
  id: string
  name: string
  starts_on: string
  ends_on: string
  status: 'draft' | 'open' | 'closed'
  allow_objectives: boolean
  allow_evaluations: boolean
}

const COLS = 'id, name, starts_on, ends_on, status, allow_objectives, allow_evaluations'

/** Periodos visibles para la gente (sin borradores), del más reciente al más antiguo. */
export async function loadPeriods(supabase: SupabaseClient): Promise<PeriodFull[]> {
  const { data } = await supabase
    .from('periods').select(COLS).neq('status', 'draft')
    .order('starts_on', { ascending: false }).limit(8)
  return (data ?? []) as PeriodFull[]
}

/** El pedido en la URL; si no, el que tiene abierta la fase indicada; si no, el activo más reciente. */
export function pickPeriod(
  periods: PeriodFull[],
  requested: string | undefined,
  prefer: 'objectives' | 'evaluations'
): PeriodFull | undefined {
  const byId = periods.find((p) => p.id === requested)
  if (byId) return byId
  const byPhase = periods.find((p) => (prefer === 'objectives' ? p.allow_objectives : p.allow_evaluations))
  return byPhase ?? periods.find((p) => p.status === 'open') ?? periods[0]
}
