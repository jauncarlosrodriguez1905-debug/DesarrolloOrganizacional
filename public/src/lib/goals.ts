export type GoalStatus = 'pending' | 'in_progress' | 'done'

export const GOAL_STATUS: { value: GoalStatus; label: string }[] = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'in_progress', label: 'En proceso' },
  { value: 'done', label: 'Hecho' },
]

export const GOAL_LABEL: Record<GoalStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  done: 'Hecho',
}

export const GOAL_BADGE: Record<GoalStatus, string> = {
  pending: 'badge--draft',
  in_progress: 'badge--submitted',
  done: 'badge--approved',
}

export function formatDate(d: string | null): string | null {
  if (!d) return null
  const [y, m, day] = d.split('-').map(Number)
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${day} ${months[m - 1]} ${y}`
}
