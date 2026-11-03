import { revalidatePath } from 'next/cache'
import AppShell from '@/components/AppShell'
import AdminTabs from '@/components/AdminTabs'
import { requireHr, back, done } from '@/lib/auth'
import { formatDate } from '@/lib/goals'

const PATH = '/admin/periodos'

type Period = {
  id: string; name: string; starts_on: string; ends_on: string
  status: 'draft' | 'open' | 'closed'
  allow_objectives: boolean; allow_evaluations: boolean
}
const STATUS_LABEL = { draft: 'Borrador', open: 'Activo', closed: 'Cerrado' } as const
const STATUS_BADGE = { draft: 'badge--draft', open: 'badge--open', closed: 'badge--closed' } as const

async function createYear(formData: FormData) {
  'use server'
  const { supabase } = await requireHr()
  const year = Number(formData.get('year'))
  if (!Number.isInteger(year) || year < 2020 || year > 2100) back(PATH, 'Escribe un año válido, por ejemplo 2027.')
  const name = `Año ${year}`
  const { data: existing } = await supabase.from('periods').select('id').eq('name', name).limit(1)
  if (existing && existing.length > 0) back(PATH, `Ya existe el periodo "${name}".`)
  // 3 cuartos: enero a septiembre. Octubre a diciembre es el cierre anual y la planeación del año siguiente.
  const { error } = await supabase.from('periods').insert({
    name, starts_on: `${year}-01-01`, ends_on: `${year}-09-30`, status: 'draft',
  })
  if (error) back(PATH, error.message)
  revalidatePath(PATH)
  done(PATH, `Periodo creado: ${name} (3 cuartos, enero a septiembre). Publícalo para que el personal lo vea.`)
}

async function createPeriod(formData: FormData) {
  'use server'
  const { supabase } = await requireHr()
  const name = String(formData.get('name') ?? '').trim()
  const starts = String(formData.get('starts_on') ?? '')
  const ends = String(formData.get('ends_on') ?? '')
  if (!name || !starts || !ends) back(PATH, 'Completa el nombre y las dos fechas.')
  if (ends < starts) back(PATH, 'La fecha de fin no puede ser anterior a la de inicio.')
  const { error } = await supabase.from('periods').insert({ name, starts_on: starts, ends_on: ends, status: 'draft' })
  if (error) back(PATH, error.message)
  revalidatePath(PATH)
  done(PATH, `Periodo creado: ${name}.`)
}

async function setStatus(formData: FormData) {
  'use server'
  const { supabase } = await requireHr()
  const id = String(formData.get('id'))
  const status = String(formData.get('status'))
  if (!['open', 'closed'].includes(status)) back(PATH, 'Estado no válido.')
  // Cerrar el año también cierra sus dos fases y deja visibles los resultados.
  const patch = status === 'closed' ? { status, allow_objectives: false, allow_evaluations: false } : { status }
  const { error } = await supabase.from('periods').update(patch).eq('id', id)
  if (error) back(PATH, error.message)
  revalidatePath(PATH)
  done(PATH, status === 'open' ? 'Periodo publicado.' : 'Periodo cerrado.')
}

async function setFlag(formData: FormData) {
  'use server'
  const { supabase } = await requireHr()
  const flag = String(formData.get('flag'))
  if (flag !== 'allow_objectives' && flag !== 'allow_evaluations') back(PATH, 'Fase no válida.')
  const value = formData.get('value') === 'true'
  const { error } = await supabase.from('periods').update({ [flag]: value }).eq('id', String(formData.get('id')))
  if (error) back(PATH, error.message)
  revalidatePath(PATH)
  done(PATH, `${flag === 'allow_objectives' ? 'Definición de objetivos' : 'Evaluaciones'}: ${value ? 'abierta' : 'cerrada'}.`)
}

function PhaseCell({ p, flag }: { p: Period; flag: 'allow_objectives' | 'allow_evaluations' }) {
  const on = p[flag]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span className={`badge ${on ? 'badge--approved' : 'badge--draft'}`}>{on ? 'Abierta' : 'Cerrada'}</span>
      {p.status !== 'closed' && (
        <form action={setFlag}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="flag" value={flag} />
          <input type="hidden" name="value" value={String(!on)} />
          <button type="submit" className="link-btn">{on ? 'Cerrar' : 'Abrir'}</button>
        </form>
      )}
    </div>
  )
}

export default async function PeriodosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  const { supabase } = await requireHr()
  const { data } = await supabase
    .from('periods')
    .select('id, name, starts_on, ends_on, status, allow_objectives, allow_evaluations')
    .order('starts_on', { ascending: false })
  const rows = (data ?? []) as Period[]

  return (
    <AppShell
      title="Administración"
      subtitle="Cada año tiene 3 cuartos (enero a septiembre). De octubre a diciembre se hacen el cierre anual y la definición de los objetivos del año siguiente: abre y cierra cada fase desde aquí."
    >
      <AdminTabs active={PATH} />
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="success" role="status">{ok}</div>}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Periodos</h2>
              <p>Pueden estar activos varios a la vez: por ejemplo, el año que cierra y el que se está planeando.</p>
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="empty">
              <h3>Aún no hay periodos</h3>
              <p>Crea el primero con el formulario de la derecha.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Periodo</th><th>Estado</th><th>Definir objetivos</th><th>Evaluaciones</th></tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="cell-title">{p.name}</div>
                        <div className="cell-desc">{formatDate(p.starts_on)} a {formatDate(p.ends_on)}</div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span className={`badge ${STATUS_BADGE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                          <form action={setStatus}>
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="status" value={p.status === 'open' ? 'closed' : 'open'} />
                            <button type="submit" className="link-btn">
                              {p.status === 'draft' ? 'Publicar' : p.status === 'open' ? 'Cerrar año' : 'Reabrir'}
                            </button>
                          </form>
                        </div>
                      </td>
                      <td><PhaseCell p={p} flag="allow_objectives" /></td>
                      <td><PhaseCell p={p} flag="allow_evaluations" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div style={{ display: 'grid', gap: 24 }}>
          <aside className="panel panel-form" style={{ position: 'static' }}>
            <h2>Nuevo año</h2>
            <p className="muted" style={{ marginBottom: 16, fontSize: 14 }}>
              Crea los 3 cuartos de enero a septiembre.
            </p>
            <form action={createYear}>
              <label className="field">
                <span>Año</span>
                <input name="year" type="number" min={2020} max={2100} defaultValue={2027} required />
              </label>
              <button type="submit" className="btn">Crear año</button>
            </form>
          </aside>

          <aside className="panel panel-form" style={{ position: 'static' }}>
            <h2>Periodo personalizado</h2>
            <form action={createPeriod}>
              <label className="field">
                <span>Nombre</span>
                <input name="name" required />
              </label>
              <label className="field">
                <span>Inicio</span>
                <input name="starts_on" type="date" required />
              </label>
              <label className="field">
                <span>Fin</span>
                <input name="ends_on" type="date" required />
              </label>
              <button type="submit" className="btn btn--ghost">Crear periodo</button>
            </form>
          </aside>
        </div>
      </div>
    </AppShell>
  )
}
