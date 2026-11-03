import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type Role = 'admin' | 'do_coordinator' | 'manager' | 'employee'

export const ROLE_LABEL: Record<Role, string> = {
  employee: 'Colaborador',
  manager: 'Jefe',
  do_coordinator: 'Desarrollo Organizacional',
  admin: 'Administrador',
}

/** Redirige de vuelta a una pantalla con un mensaje de error. */
export function back(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`)
}

/** Redirige de vuelta a una pantalla con un mensaje de éxito. */
export function done(path: string, message: string): never {
  redirect(`${path}?ok=${encodeURIComponent(message)}`)
}

/**
 * Debe llamarse al inicio de CADA página y CADA acción del panel de administración.
 * Las acciones de servidor son endpoints públicos: ocultar el botón no basta.
 */
export async function requireHr() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role = profile?.role as Role | undefined
  if (role !== 'admin' && role !== 'do_coordinator') redirect('/objetivos')
  return { supabase, user, role }
}
