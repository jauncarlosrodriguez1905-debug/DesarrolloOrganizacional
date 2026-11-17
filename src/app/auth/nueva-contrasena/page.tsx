import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'

const fail = (m: string): never => redirect('/auth/nueva-contrasena?error=' + encodeURIComponent(m))

async function setNewPassword(formData: FormData) {
  'use server'
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')
  if (password.length < 8) fail('La contraseña debe tener al menos 8 caracteres.')
  if (password !== confirm) fail('Las contraseñas no coinciden.')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?error=confirm')

  const { error } = await supabase.auth.updateUser({ password })
  if (error) fail('No se pudo actualizar la contraseña. Pide el enlace de nuevo desde el login.')

  // Se cierra la sesión de recuperación para que entre con la contraseña nueva.
  await supabase.auth.signOut()
  redirect('/login?ok=password')
}

export default async function NuevaContrasenaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?error=confirm')

  return (
    <div className="auth">
      <section className="auth-brand">
        <div className="brand">
          <Image src="/jbi-logo.png" alt="JBI" width={96} height={96} className="brand-logo" priority />
          Desempeño
        </div>
        <div>
          <h1>Gestión del desempeño</h1>
          <p>Pon tu contraseña nueva para volver a entrar.</p>
        </div>
      </section>

      <main className="auth-form">
        <form action={setNewPassword}>
          <h2>Contraseña nueva</h2>
          <p className="lead">Para {user.email}.</p>
          {error && <div className="alert" role="alert">{error}</div>}
          <label className="field">
            <span>Contraseña nueva</span>
            <input name="password" type="password" autoComplete="new-password" minLength={8} required />
            <div className="field-hint">Mínimo 8 caracteres.</div>
          </label>
          <label className="field">
            <span>Confirmar contraseña</span>
            <input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          <button type="submit" className="btn">Guardar contraseña</button>
          <p className="lead" style={{ marginTop: 18 }}>
            <Link href="/login" className="link">← Volver a iniciar sesión</Link>
          </p>
        </form>
      </main>
    </div>
  )
}
