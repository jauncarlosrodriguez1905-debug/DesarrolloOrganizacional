import { revalidatePath } from 'next/cache'
import AppShell from '@/components/AppShell'
import AdminTabs from '@/components/AdminTabs'
import { requireHr, back, done } from '@/lib/auth'

const PATH = '/admin/configuracion'

async function saveSettings(formData: FormData) {
  'use server'
  const { supabase } = await requireHr()
  const url = String(formData.get('matrix_url') ?? '').trim()

  if (!url) {
    const { error } = await supabase.from('app_settings').delete().eq('key', 'matrix_url')
    if (error) back(PATH, error.message)
  } else {
    if (!/^https?:\/\//i.test(url)) back(PATH, 'El enlace debe empezar con https://')
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'matrix_url', value: url, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) back(PATH, error.message)
  }
  revalidatePath('/', 'layout')
  done(PATH, 'Configuración guardada.')
}

export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  const { supabase } = await requireHr()
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'matrix_url').maybeSingle()

  return (
    <AppShell title="Administración" subtitle="Ajustes generales del sistema.">
      <AdminTabs active={PATH} />
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="success" role="status">{ok}</div>}

      <section className="panel" style={{ maxWidth: 640 }}>
        <div className="panel-head">
          <div>
            <h2>Matriz de objetivos</h2>
            <p>Enlace a la guía externa. Aparece en el menú de todas las personas y se abre en una pestaña nueva.</p>
          </div>
        </div>
        <form action={saveSettings} style={{ padding: 26 }}>
          <label className="field">
            <span>Enlace (SharePoint, OneDrive, Excel en línea, etc.)</span>
            <input name="matrix_url" type="url" defaultValue={data?.value ?? ''} placeholder="https://" />
            <div className="field-hint">Déjalo vacío para quitar el enlace del menú.</div>
          </label>
          <button type="submit" className="btn btn--inline">Guardar</button>
        </form>
      </section>
    </AppShell>
  )
}
