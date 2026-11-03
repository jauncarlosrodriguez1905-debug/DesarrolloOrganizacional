import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import AdminTabs from '@/components/AdminTabs'
import { requireHr, back, done, ROLE_LABEL, type Role } from '@/lib/auth'
import { adminOrBack } from '@/lib/supabase/admin'

const LIST = '/admin/empleados'

type Person = {
  id: string
  full_name: string
  employee_code: string | null
  role: Role
  active: boolean
  area_id: string | null
  manager_id: string | null
}

async function updateEmployee(formData: FormData) {
  'use server'
  const { user, role: callerRole } = await requireHr()

  const id = String(formData.get('id'))
  const here = `${LIST}/${id}`
  const fullName = String(formData.get('full_name') ?? '').trim()
  const code = String(formData.get('employee_code') ?? '').trim()
  const role = String(formData.get('role') ?? 'employee') as Role
  const areaId = String(formData.get('area_id') ?? '') || null
  const managerId = String(formData.get('manager_id') ?? '') || null
  const active = formData.get('active') === 'on'
  const newPassword = String(formData.get('password') ?? '')

  if (!fullName) back(here, 'El nombre no puede quedar vacío.')
  if (!(role in ROLE_LABEL)) back(here, 'Rol no válido.')
  if (managerId === id) back(here, 'Una persona no puede ser su propio jefe.')
  if (newPassword && newPassword.length < 8) back(here, 'La nueva contraseña debe tener al menos 8 caracteres.')

  const admin = adminOrBack(here)
  const { data: target } = await admin.from('profiles').select('role').eq('id', id).maybeSingle()
  if (!target) back(LIST, 'No se encontró a la persona.')

  const elevated = (r: string) => r === 'admin' || r === 'do_coordinator'
  if (callerRole !== 'admin' && (target.role === 'admin' || elevated(role) !== elevated(target.role) || (elevated(role) && role !== target.role)))
    back(here, 'Solo un administrador puede modificar o asignar roles de administración.')
  if (id === user.id && (!active || role !== callerRole))
    back(here, 'No puedes desactivarte ni cambiar tu propio rol.')

  const { error } = await admin
    .from('profiles')
    .update({ full_name: fullName, employee_code: code || null, area_id: areaId, manager_id: managerId, role, active })
    .eq('id', id)
  if (error) back(here, error.message.includes('employee_code') ? 'Ese código de empleado ya existe.' : error.message)

  // Desactivar también bloquea el acceso; reactivar lo restablece.
  const { error: authError } = await admin.auth.admin.updateUserById(id, {
    ban_duration: active ? 'none' : '876000h',
    ...(newPassword ? { password: newPassword } : {}),
  })
  if (authError) back(here, authError.message)

  revalidatePath(LIST)
  done(LIST, 'Cambios guardados.')
}

export default async function EditEmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const { supabase, role: callerRole } = await requireHr()

  const [{ data: person }, { data: everyone }, { data: areas }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, employee_code, role, active, area_id, manager_id').eq('id', id).maybeSingle(),
    supabase.from('profiles').select('id, full_name, active').order('full_name'),
    supabase.from('areas').select('id, name').order('name'),
  ])
  if (!person) notFound()
  const p = person as Person
  const candidates = ((everyone ?? []) as { id: string; full_name: string; active: boolean }[]).filter(
    (x) => x.id !== p.id && x.active
  )
  const roles = (Object.keys(ROLE_LABEL) as Role[]).filter(
    (r) => callerRole === 'admin' || (r !== 'admin' && r !== 'do_coordinator')
  )

  return (
    <AppShell title="Administración" subtitle="Edita los datos de la persona.">
      <AdminTabs active={LIST} />
      {error && <div className="alert" role="alert">{error}</div>}

      <section className="panel" style={{ maxWidth: 640 }}>
        <div className="panel-head">
          <div>
            <h2>{p.full_name}</h2>
            <p>{ROLE_LABEL[p.role]}</p>
          </div>
        </div>
        <form action={updateEmployee} style={{ padding: 26 }}>
          <input type="hidden" name="id" value={p.id} />
          <div className="form-grid">
            <label className="field">
              <span>Nombre completo</span>
              <input name="full_name" defaultValue={p.full_name} required />
            </label>
            <label className="field">
              <span>Código de empleado</span>
              <input name="employee_code" defaultValue={p.employee_code ?? ''} />
            </label>
            <label className="field">
              <span>Área</span>
              <select name="area_id" defaultValue={p.area_id ?? ''}>
                <option value="">Sin área</option>
                {((areas ?? []) as { id: string; name: string }[]).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Jefe directo</span>
              <select name="manager_id" defaultValue={p.manager_id ?? ''}>
                <option value="">Sin jefe</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Rol</span>
              <select name="role" defaultValue={p.role}>
                {roles.concat(roles.includes(p.role) ? [] : [p.role]).map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Nueva contraseña</span>
              <input name="password" type="text" minLength={8} placeholder="Dejar vacío para no cambiarla" />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" name="active" defaultChecked={p.active} />
            <span>Cuenta activa (si se desmarca, la persona ya no puede iniciar sesión)</span>
          </label>
          <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="submit" className="btn btn--inline">Guardar cambios</button>
            <Link href={LIST} className="btn btn--inline btn--ghost">Cancelar</Link>
          </div>
        </form>
      </section>
    </AppShell>
  )
}
