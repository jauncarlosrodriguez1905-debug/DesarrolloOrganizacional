export type ObjectiveStatus = 'draft' | 'submitted' | 'approved' | 'returned'

export const STATUS_LABEL: Record<ObjectiveStatus, string> = {
  draft: 'Borrador',
  submitted: 'En revisión',
  approved: 'Aprobado',
  returned: 'Devuelto',
}

export const isEditable = (s: ObjectiveStatus) => s === 'draft' || s === 'returned'
