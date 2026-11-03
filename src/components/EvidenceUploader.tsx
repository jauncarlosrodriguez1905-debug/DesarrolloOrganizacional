'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { registerEvidence } from '@/lib/evidence-actions'
import { EVIDENCE_EXTENSIONS, EVIDENCE_MAX_BYTES } from '@/lib/evidence'

export default function EvidenceUploader({ objectiveId, ownerId }: { objectiveId: string; ownerId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setError(null)
    setDone(null)

    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0]
    const note = (form.elements.namedItem('note') as HTMLInputElement).value
    if (!file) return setError('Elige un archivo.')

    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    if (!EVIDENCE_EXTENSIONS[ext]) {
      return setError('Tipo de archivo no permitido. Usa PDF, imagen, Word, Excel, PowerPoint, CSV o texto.')
    }
    if (file.size > EVIDENCE_MAX_BYTES) return setError('El archivo pesa más de 10 MB.')
    if (file.size === 0) return setError('El archivo está vacío.')

    setBusy(true)
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
    const path = `${ownerId}/${objectiveId}/${crypto.randomUUID()}-${safe}`

    const supabase = createClient()
    const { error: upErr } = await supabase.storage
      .from('evidence')
      .upload(path, file, { contentType: file.type || EVIDENCE_EXTENSIONS[ext], upsert: false })
    if (upErr) {
      setBusy(false)
      return setError(`No se pudo subir el archivo: ${upErr.message}`)
    }

    const res = await registerEvidence({
      objectiveId,
      path,
      name: file.name,
      mime: file.type || EVIDENCE_EXTENSIONS[ext],
      size: file.size,
      note,
    })
    setBusy(false)
    if (!res.ok) return setError(res.error)

    form.reset()
    setDone('Archivo adjuntado.')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit}>
      {error && <div className="alert" role="alert">{error}</div>}
      {done && <div className="success" role="status">{done}</div>}
      <label className="field">
        <span>Archivo</span>
        <input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.docx,.doc,.pptx,.txt" />
        <div className="field-hint">PDF, imágenes, Word, Excel, PowerPoint, CSV o texto. Máximo 10 MB.</div>
      </label>
      <label className="field">
        <span>Descripción (opcional)</span>
        <input name="note" maxLength={300} placeholder="Ej. Reporte de calidad de marzo" />
      </label>
      <button type="submit" className="btn" disabled={busy}>{busy ? 'Subiendo…' : 'Adjuntar'}</button>
    </form>
  )
}
