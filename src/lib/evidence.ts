import type { SupabaseClient } from '@supabase/supabase-js'

export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024

export const EVIDENCE_EXTENSIONS: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
}

/** Cuántos archivos tiene cada objetivo (para mostrar "Evidencias (3)"). */
export async function evidenceCounts(supabase: SupabaseClient, objectiveIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (objectiveIds.length === 0) return counts
  const { data } = await supabase.from('objective_evidence').select('objective_id').in('objective_id', objectiveIds)
  ;((data ?? []) as { objective_id: string }[]).forEach((e) =>
    counts.set(e.objective_id, (counts.get(e.objective_id) ?? 0) + 1)
  )
  return counts
}

export const evidenceLabel = (n: number | undefined) => (n && n > 0 ? `Evidencias (${n})` : 'Evidencias')
