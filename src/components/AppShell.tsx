import { redirect } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import Nav from './Nav'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  do_coordinator: 'Desarrollo Organizacional',
  manager: 'Jefe',
  employee: 'Colaborador',
}

async function signOut() {
  'use server'
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export default async function AppShell({
  title,
  subtitle,
  meta,
  children,
}: {
  title: string
  subtitle?: string
  meta?: React.ReactNode
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .maybeSingle()

  const { count: reportsCount } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('manager_id', user.id)
  const isManager = profile?.role === 'manager' || (reportsCount ?? 0) > 0

  const { data: matrix } = await supabase.from('app_settings').select('value').eq('key', 'matrix_url').maybeSingle()

  const name = profile?.full_name ?? user.email ?? 'Usuario'
  const initials =
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s: string) => s[0].toUpperCase())
      .join('') || 'U'

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Image src="/jbi-logo.png" alt="JBI" width={96} height={96} className="brand-logo" priority />
          Desempeño
        </div>
        <Nav matrixUrl={matrix?.value ?? null} isManager={isManager} isHr={profile?.role === 'admin' || profile?.role === 'do_coordinator'} />
        <div className="sidebar-user">
          <div className="avatar" aria-hidden="true">{initials}</div>
          <div className="user-meta">
            <div className="user-name">{name}</div>
            <div className="user-role">{ROLE_LABEL[profile?.role ?? 'employee']}</div>
            <form action={signOut}>
              <button type="submit" className="signout">Cerrar sesión</button>
            </form>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="page-head">
          <div>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {meta}
        </header>
        {children}
      </main>
    </div>
  )
}
