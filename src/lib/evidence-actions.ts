'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type EvidenceResult = { ok: true } | { ok: false; error: string }

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * El navegador sube el archivo directo a Storage (sin pasar por el servidor, para no toparse con el límite de tamaño).
 * Aquí se registra en la base de datos; RLS valida que el objetivo sea suyo, esté aprobado y el periodo siga abierto.
 */
export async function registerEvidence(input: {
  objectiveId: string
  path: string
  name: string
  mime: string
  size: number
  note: string
}): Promise<EvidenceResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Tu sesión expiró. Inicia sesión de nuevo.' }

  if (!UUID.test(input.objectiveId)) return { ok: false, error: 'Objetivo no válido.' }
  const prefix = `${user.id}/${input.objectiveId}/`
  if (!input.path.startsWith(prefix) || input.path.includes('..')) {
    return { ok: false, error: 'Ruta de archivo no válida.' }
  }

  const { error } = await supabase.from('objective_evidence').insert({
    objective_id: input.objectiveId,
    owner_id: user.id,
    file_path: input.path,
    file_name: String(input.name).slice(0, 200),
    mime_type: input.mime || null,
    size_bytes: Math.max(0, Math.floor(Number(input.size) || 0)),
    note: String(input.note ?? '').trim().slice(0, 300) || null,
  })

  if (error) {
    // No dejar archivos huérfanos en Storage
    await supabase.storage.from('evidence').remove([input.path])
    return { ok: false, error: error.message }
  }
  revalidatePath(`/objetivos/${input.objectiveId}/evidencias`)
  return { ok: true }
}
