import { revalidatePath } from 'next/cache'
import AppShell from '@/components/AppShell'
import AdminTabs from '@/components/AdminTabs'
import { requireHr, back, done } from '@/lib/auth'

const PATH = '/admin/configuracion'
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

async function saveSettings(formData: FormData) {
  'use server'
  const { supabase } = await requireHr()

  const matrix = String(formData.get('matrix_url') ?? '').trim()
  if (matrix && !/^https?:\/\//i.test(matrix)) back(PATH, 'El enlace debe empezar con https://')

  const domains = String(formData.get('signup_domains') ?? '')
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  const invalid = domains.filter((d) => !DOMAIN.test(d))
  if (invalid.length > 0) back(PATH, `Dominio no válido: ${invalid.join(', ')}. Escríbelo así: empresa.com`)

  const save = async (key: string, value: string) => {
    if (!value) return supabase.from('app_settings').delete().eq('key', key)
    return supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  }
  const r1 = await save('matrix_url', matrix)
  if (r1.error) back(PATH, r1.error.message)
  const r2 = await save('signup_domains', domains.join(','))
  if (r2.error) back(PATH, r2.error.message)

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
  const { data } = await supabase.from('app_settings').select('key, value').in('key', ['matrix_url', 'signup_domains'])
  const settings = new Map(((data ?? []) as { key: string; value: string }[]).map((x) => [x.key, x.value]))
  const domains = settings.get('signup_domains') ?? ''

  return (
    <AppShell title="Administración" subtitle="Ajustes generales del sistema.">
      <AdminTabs active={PATH} />
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="success" role="status">{ok}</div>}

      <form action={saveSettings} style={{ display: 'grid', gap: 24, maxWidth: 640 }}>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Registro de personal</h2>
              <p>
                {domains
                  ? `Abierto para correos de: ${domains.split(',').join(', ')}.`
                  : 'Cerrado. Nadie puede registrarse por su cuenta.'}
              </p>
            </div>
          </div>
          <div style={{ padding: 26 }}>
            <label className="field">
              <span>Dominios de correo permitidos</span>
              <input name="signup_domains" defaultValue={domains} placeholder="empresa.com" />
              <div className="field-hint">
                Separa varios con coma. Solo se acepta el dominio exacto (no subdominios). Déjalo vacío para cerrar el registro.
                No uses dominios públicos como gmail.com: cualquier persona podría registrarse.
              </div>
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Matriz de objetivos</h2>
              <p>Enlace a la guía externa. Aparece en el menú de todas las personas y se abre en una pestaña nueva.</p>
            </div>
          </div>
          <div style={{ padding: 26 }}>
            <label className="field">
              <span>Enlace (SharePoint, OneDrive, Excel en línea, etc.)</span>
              <input name="matrix_url" type="url" defaultValue={settings.get('matrix_url') ?? ''} placeholder="https://" />
              <div className="field-hint">Déjalo vacío para quitar el enlace del menú.</div>
            </label>
          </div>
        </section>

        <div><button type="submit" className="btn btn--inline">Guardar</button></div>
      </form>
    </AppShell>
  )
}
