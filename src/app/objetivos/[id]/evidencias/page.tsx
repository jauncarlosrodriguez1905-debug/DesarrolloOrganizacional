import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import EvidenceUploader from '@/components/EvidenceUploader'
import { formatDate } from '@/lib/goals'
import { STATUS_LABEL, type ObjectiveStatus } from '@/lib/status'

type Evidence = {
  id: string; file_path: string; file_name: string
  size_bytes: number; note: string | null; created_at: string
}

const fmtSize = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

async function removeEvidence(formData: FormData) {
  'use server'
  const id = String(formData.get('id'))
  const objectiveId = String(formData.get('objective_id'))
  const here = `/objetivos/${objectiveId}/evidencias`
  const supabase = await createClient()

  const { data: row } = await supabase.from('objective_evidence').select('file_path').eq('id', id).maybeSingle()
  if (!row) redirect(here)

  // Primero el registro (RLS decide si puedes borrarlo) y luego el archivo.
  const { error } = await supabase.from('objective_evidence').delete().eq('id', id)
  if (error) redirect(here + '?error=' + encodeURIComponent(error.message))
  await supabase.storage.from('evidence').remove([row.file_path])
  revalidatePath(here)
  redirect(here + '?ok=' + encodeURIComponent('Archivo eliminado.'))
}

export default async function EvidenciasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { id } = await params
  const { error, ok } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // RLS: solo el dueño, su jefe directo y RH pueden leer el objetivo.
  const { data: obj } = await supabase
    .from('objectives')
    .select('id, owner_id, period_id, category, title, description, weight, status')
    .eq('id', id).maybeSingle()
  if (!obj) notFound()
  const o = obj as {
    id: string; owner_id: string; period_id: string; category: string; title: string
    description: string | null; weight: number; status: ObjectiveStatus
  }

  const [{ data: period }, { data: me }, { data: owner }] = await Promise.all([
    supabase.from('periods').select('name, status').eq('id', o.period_id).maybeSingle(),
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabase.from('profiles').select('full_name').eq('id', o.owner_id).maybeSingle(),
  ])
  const isHr = me?.role === 'admin' || me?.role === 'do_coordinator'
  const isOwner = o.owner_id === user.id
  const periodOpen = period?.status !== 'closed'
  const canUpload = isOwner && o.status === 'approved' && periodOpen
  const canDelete = (isOwner && periodOpen) || isHr

  const { data: evData } = await supabase
    .from('objective_evidence')
    .select('id, file_path, file_name, size_bytes, note, created_at')
    .eq('objective_id', id)
    .order('created_at', { ascending: false })
  const files = (evData ?? []) as Evidence[]

  // Enlaces temporales (1 hora): los archivos no son públicos.
  const signedList = files.length
    ? (await supabase.storage.from('evidence').createSignedUrls(files.map((f) => f.file_path), 3600)).data ?? []
    : []
  const urlOf = new Map(signedList.map((s) => [s.path ?? '', s.signedUrl]))

  const backHref = isOwner ? '/objetivos' : `/equipo/${o.owner_id}`

  return (
    <AppShell
      title="Evidencias"
      subtitle={isOwner ? 'Archivos que respaldan este objetivo.' : `Evidencias de ${owner?.full_name ?? 'la persona'}.`}
      meta={period ? <span className="chip">{period.name}</span> : null}
    >
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="success" role="status">{ok}</div>}
      {isOwner && o.status !== 'approved' && (
        <div className="notice">Podrás adjuntar evidencia cuando tu jefe apruebe este objetivo.</div>
      )}
      {isOwner && o.status === 'approved' && !periodOpen && (
        <div className="notice">El periodo está cerrado: ya no se pueden agregar ni quitar archivos.</div>
      )}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{o.title}</h2>
              <p>{o.category} · Peso {o.weight}% · {STATUS_LABEL[o.status]}</p>
            </div>
          </div>

          {files.length === 0 ? (
            <div className="empty">
              <h3>Sin evidencias</h3>
              <p>{canUpload ? 'Adjunta reportes, fotos o documentos que muestren el avance.' : 'Todavía no se han adjuntado archivos.'}</p>
            </div>
          ) : (
            files.map((f) => (
              <div className="evidence-item" key={f.id}>
                <div className="evidence-main">
                  <div className="cell-title">{f.file_name}</div>
                  {f.note && <div className="cell-desc">{f.note}</div>}
                  <div className="goal-meta">
                    <span>{fmtSize(f.size_bytes)}</span>
                    <span>{formatDate(f.created_at.slice(0, 10))}</span>
                  </div>
                </div>
                <div className="row-actions" style={{ alignItems: 'center' }}>
                  {urlOf.get(f.file_path) && (
                    <a href={urlOf.get(f.file_path)} target="_blank" rel="noopener noreferrer" className="link">Abrir</a>
                  )}
                  {canDelete && (
                    <form action={removeEvidence}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="objective_id" value={id} />
                      <button type="submit" className="link-danger">Eliminar</button>
                    </form>
                  )}
                </div>
              </div>
            ))
          )}
        </section>

        {canUpload && (
          <aside className="panel panel-form">
            <h2>Adjuntar evidencia</h2>
            <EvidenceUploader objectiveId={id} ownerId={user.id} />
          </aside>
        )}
      </div>

      <p style={{ marginTop: 20 }}><Link href={backHref} className="link">← Volver</Link></p>
    </AppShell>
  )
}
