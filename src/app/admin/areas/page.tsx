import { revalidatePath } from 'next/cache'
import AppShell from '@/components/AppShell'
import AdminTabs from '@/components/AdminTabs'
import { requireHr, back, done } from '@/lib/auth'

const PATH = '/admin/areas'

async function createArea(formData: FormData) {
  'use server'
  const { supabase } = await requireHr()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) back(PATH, 'Escribe el nombre del área.')
  const { error } = await supabase.from('areas').insert({ name })
  if (error) back(PATH, error.code === '23505' ? 'Ya existe un área con ese nombre.' : error.message)
  revalidatePath(PATH)
  done(PATH, `Área creada: ${name}.`)
}

async function deleteArea(formData: FormData) {
  'use server'
  const { supabase } = await requireHr()
  const id = String(formData.get('id'))
  const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('area_id', id)
  if (count && count > 0) back(PATH, 'No se puede eliminar un área que tiene personas asignadas.')
  const { error } = await supabase.from('areas').delete().eq('id', id)
  if (error) back(PATH, error.message)
  revalidatePath(PATH)
  done(PATH, 'Área eliminada.')
}

export default async function AreasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  const { supabase } = await requireHr()

  const [{ data: areas }, { data: people }] = await Promise.all([
    supabase.from('areas').select('id, name').order('name'),
    supabase.from('profiles').select('area_id'),
  ])
  const counts = new Map<string, number>()
  ;((people ?? []) as { area_id: string | null }[]).forEach((p) => {
    if (p.area_id) counts.set(p.area_id, (counts.get(p.area_id) ?? 0) + 1)
  })
  const rows = (areas ?? []) as { id: string; name: string }[]

  return (
    <AppShell title="Administración" subtitle="Áreas o departamentos de la planta.">
      <AdminTabs active={PATH} />
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="success" role="status">{ok}</div>}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Áreas</h2>
              <p>{rows.length} {rows.length === 1 ? 'área' : 'áreas'}.</p>
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="empty">
              <h3>Aún no hay áreas</h3>
              <p>Crea la primera para poder asignar personal y objetivos por área.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Área</th><th className="num">Personas</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td className="cell-title">{a.name}</td>
                      <td className="num">{counts.get(a.id) ?? 0}</td>
                      <td className="num">
                        <form action={deleteArea}>
                          <input type="hidden" name="id" value={a.id} />
                          <button type="submit" className="link-danger">Eliminar</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="panel panel-form">
          <h2>Nueva área</h2>
          <form action={createArea}>
            <label className="field">
              <span>Nombre del área</span>
              <input name="name" required />
            </label>
            <button type="submit" className="btn">Crear área</button>
          </form>
        </aside>
      </div>
    </AppShell>
  )
}
