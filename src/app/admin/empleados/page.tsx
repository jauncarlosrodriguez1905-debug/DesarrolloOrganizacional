import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import AdminTabs from '@/components/AdminTabs'
import { requireHr, back, done, ROLE_LABEL, type Role } from '@/lib/auth'
import { adminOrBack } from '@/lib/supabase/admin'

const PATH = '/admin/empleados'

type Person = {
  id: string
  full_name: string
  employee_code: string | null
  role: Role
  active: boolean
  area_id: string | null
  manager_id: string | null
}

async function createEmployee(formData: FormData) {
  'use server'
  const { role: callerRole } = await requireHr()

  const fullName = String(formData.get('full_name') ?? '').trim()
  const code = String(formData.get('employee_code') ?? '').trim()
  let email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const role = String(formData.get('role') ?? 'employee') as Role
  const areaId = String(formData.get('area_id') ?? '') || null
  const managerId = String(formData.get('manager_id') ?? '') || null

  if (!fullName) back(PATH, 'Escribe el nombre completo.')
  if (!(role in ROLE_LABEL)) back(PATH, 'Rol no válido.')
  if ((role === 'admin' || role === 'do_coordinator') && callerRole !== 'admin')
    back(PATH, 'Solo un administrador puede asignar ese rol.')
  if (password.length < 8) back(PATH, 'La contraseña temporal debe tener al menos 8 caracteres.')
  if (!email) {
    if (!code) back(PATH, 'Escribe un correo o un código de empleado.')
    email = `${code.toLowerCase()}@planta.local`
  }

  const admin = adminOrBack(PATH)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, employee_code: code || null },
  })
  const newUser = data?.user
  if (error || !newUser) back(PATH, error?.message ?? 'No se pudo crear el usuario.')

  const { error: profileError } = await admin
    .from('profiles')
    .update({ full_name: fullName, employee_code: code || null, area_id: areaId, manager_id: managerId, role })
    .eq('id', newUser.id)

  if (profileError) {
    await admin.auth.admin.deleteUser(newUser.id) // evita dejar un usuario a medias
    back(PATH, profileError.message.includes('employee_code') ? 'Ese código de empleado ya existe.' : profileError.message)
  }

  revalidatePath(PATH)
  done(PATH, `Empleado creado: ${fullName}.`)
}

export default async function EmpleadosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  const { supabase, role: callerRole } = await requireHr()

  const [{ data: profiles }, { data: areas }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, employee_code, role, active, area_id, manager_id').order('full_name'),
    supabase.from('areas').select('id, name').order('name'),
  ])
  const people = (profiles ?? []) as Person[]
  const areaList = (areas ?? []) as { id: string; name: string }[]
  const areaName = new Map(areaList.map((a) => [a.id, a.name]))
  const personName = new Map(people.map((p) => [p.id, p.full_name]))
  const roles = (Object.keys(ROLE_LABEL) as Role[]).filter(
    (r) => callerRole === 'admin' || (r !== 'admin' && r !== 'do_coordinator')
  )

  return (
    <AppShell title="Administración" subtitle="Da de alta al personal y define su área, su jefe y su rol.">
      <AdminTabs active={PATH} />
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="success" role="status">{ok}</div>}
      {people.filter((x) => x.active && x.role === 'employee' && (!x.area_id || !x.manager_id)).length > 0 && (
        <div className="notice">
          {people.filter((x) => x.active && x.role === 'employee' && (!x.area_id || !x.manager_id)).length} personas aún no tienen área o jefe asignado
          (por ejemplo, quienes se registraron solas). Usa <strong>Editar</strong> para asignárselos.
        </div>
      )}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Personal</h2>
              <p>{people.length} {people.length === 1 ? 'persona registrada' : 'personas registradas'}.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Área</th>
                  <th>Jefe</th>
                  <th>Rol</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="cell-title">{p.full_name}</div>
                      <div className="cell-desc">
                        {p.employee_code ? `Código ${p.employee_code}` : 'Sin código'}
                        {!p.active && ' · Inactivo'}
                      </div>
                    </td>
                    <td>{p.area_id ? areaName.get(p.area_id) : <span className="muted">Sin área</span>}</td>
                    <td>{p.manager_id ? personName.get(p.manager_id) : <span className="muted">Sin jefe</span>}</td>
                    <td><span className="tag">{ROLE_LABEL[p.role]}</span></td>
                    <td className="num">
                      <Link href={`${PATH}/${p.id}`} className="link">Editar</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="panel panel-form">
          <h2>Nuevo empleado</h2>
          {!process.env.SUPABASE_SERVICE_ROLE_KEY && (
            <div className="notice">
              Falta la llave SUPABASE_SERVICE_ROLE_KEY en .env.local. Sin ella no se pueden crear usuarios.
            </div>
          )}
          <form action={createEmployee}>
            <label className="field">
              <span>Nombre completo</span>
              <input name="full_name" required />
            </label>
            <label className="field">
              <span>Código de empleado</span>
              <input name="employee_code" />
            </label>
            <label className="field">
              <span>Correo</span>
              <input name="email" type="email" />
              <div className="field-hint">Si no tiene correo, déjalo vacío: se crea uno interno con su código.</div>
            </label>
            <label className="field">
              <span>Contraseña temporal</span>
              <input name="password" type="text" minLength={8} required />
              <div className="field-hint">Mínimo 8 caracteres. Compártela directamente con la persona.</div>
            </label>
            <label className="field">
              <span>Área</span>
              <select name="area_id" defaultValue="">
                <option value="">Sin área</option>
                {areaList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Jefe directo</span>
              <select name="manager_id" defaultValue="">
                <option value="">Sin jefe</option>
                {people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Rol</span>
              <select name="role" defaultValue="employee">
                {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <button type="submit" className="btn">Crear empleado</button>
          </form>
        </aside>
      </div>
    </AppShell>
  )
}
