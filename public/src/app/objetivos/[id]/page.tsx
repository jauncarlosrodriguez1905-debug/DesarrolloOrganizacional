import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import { isEditable, type ObjectiveStatus } from '@/lib/status'

async function updateObjective(formData: FormData) {
  'use server'
  const id = String(formData.get('id'))
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase
    .from('objectives')
    .update({
      category: String(formData.get('category')),
      title: String(formData.get('title')),
      description: String(formData.get('description') ?? ''),
      weight: Number(formData.get('weight')),
    })
    .eq('id', id)
    .eq('owner_id', user.id)
  if (error) redirect(`/objetivos/${id}?error=` + encodeURIComponent(error.message))
  revalidatePath('/objetivos')
  redirect('/objetivos?ok=' + encodeURIComponent('Objetivo actualizado.'))
}

export default async function EditObjectivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('objectives')
    .select('id, owner_id, category, title, description, weight, status, review_comment')
    .eq('id', id)
    .maybeSingle()
  if (!data) notFound()
  const o = data as {
    id: string; owner_id: string; category: string; title: string
    description: string | null; weight: number; status: ObjectiveStatus; review_comment: string | null
  }
  if (o.owner_id !== user.id || !isEditable(o.status)) redirect('/objetivos')

  return (
    <AppShell title="Objetivos" subtitle="Edita el objetivo y vuelve a enviarlo a revisión desde la lista.">
      {error && <div className="alert" role="alert">{error}</div>}
      <section className="panel" style={{ maxWidth: 640 }}>
        <div className="panel-head">
          <div>
            <h2>Editar objetivo</h2>
            {o.status === 'returned' && o.review_comment && (
              <div className="review-note"><strong>Comentario de tu jefe:</strong> {o.review_comment}</div>
            )}
          </div>
        </div>
        <form action={updateObjective} style={{ padding: 26 }}>
          <input type="hidden" name="id" value={o.id} />
          <label className="field">
            <span>Categoría</span>
            <input name="category" defaultValue={o.category} required />
          </label>
          <label className="field">
            <span>Título del objetivo</span>
            <input name="title" defaultValue={o.title} required />
          </label>
          <label className="field">
            <span>Descripción</span>
            <textarea name="description" defaultValue={o.description ?? ''} />
          </label>
          <label className="field" style={{ maxWidth: 160 }}>
            <span>Peso (%)</span>
            <input name="weight" type="number" min={1} max={100} defaultValue={o.weight} required />
          </label>
          <div className="row-actions">
            <button type="submit" className="btn btn--inline">Guardar cambios</button>
            <Link href="/objetivos" className="btn btn--inline btn--ghost">Cancelar</Link>
          </div>
        </form>
      </section>
    </AppShell>
  )
}
