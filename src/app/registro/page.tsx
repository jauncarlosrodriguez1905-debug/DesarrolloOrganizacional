import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import { adminOrBack } from '@/lib/supabase/admin'

const fail = (m: string): never => redirect('/registro?error=' + encodeURIComponent(m))

async function register(formData: FormData) {
  'use server'
  const fullName = String(formData.get('full_name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')
  const code = String(formData.get('employee_code') ?? '').trim()

  if (!fullName) fail('Escribe tu nombre completo.')
  if (password.length < 8) fail('La contraseña debe tener al menos 8 caracteres.')
  if (password !== confirm) fail('Las contraseñas no coinciden.')

  const supabase = await createClient()

  // Verificación amable; el candado real está en la base de datos.
  const { data: allowed } = await supabase.rpc('is_signup_email_allowed', { p_email: email })
  if (!allowed) fail('Usa tu correo de la empresa para registrarte.')

  // Alta interna sin correo de confirmación: la cuenta se crea ya confirmada
  // (createUser no envía correo) y la persona entra directo. El único correo
  // de la app queda para recuperar la contraseña.
  const admin = adminOrBack('/registro')
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, employee_code: code || null },
  })

  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('already') || msg.includes('exists')) fail('Ese correo ya tiene una cuenta. Inicia sesión.')
    if (msg.includes('database error')) fail('No se pudo crear la cuenta. Verifica que uses tu correo de la empresa.')
    if (msg.includes('password')) fail('La contraseña es muy débil. Usa una más larga y variada.')
    fail('No se pudo crear la cuenta. Intenta de nuevo.')
  }

  const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
  if (loginError) redirect('/login')
  redirect('/dashboard')
}

export default async function RegistroPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const supabase = await createClient()
  const { data: open } = await supabase.rpc('signup_is_open')

  return (
    <div className="auth">
      <section className="auth-brand">
        <div className="brand">
          <Image src="/jbi-logo.png" alt="JBI" width={96} height={96} className="brand-logo" priority />
          Desempeño
        </div>
        <div>
          <h1>Crea tu cuenta</h1>
          <p>Regístrate con tu correo de la empresa. No necesitas confirmar por correo: entras directo. Recursos Humanos te asignará tu área y tu jefe directo.</p>
        </div>
      </section>

      <main className="auth-form">
        {!open ? (
          <div style={{ width: '100%', maxWidth: 360 }}>
            <h2>Registro no disponible</h2>
            <p className="lead">Por ahora el registro está cerrado. Pide a Recursos Humanos que te dé de alta.</p>
            <Link href="/login" className="link">← Volver a iniciar sesión</Link>
          </div>
        ) : (
          <form action={register}>
            <h2>Registro</h2>
            <p className="lead">Con tu correo de la empresa. Sin confirmación por correo.</p>
            {error && <div className="alert" role="alert">{error}</div>}
            <label className="field">
              <span>Nombre completo</span>
              <input name="full_name" autoComplete="name" required />
            </label>
            <label className="field">
              <span>Correo de la empresa</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="field">
              <span>Código de empleado (opcional)</span>
              <input name="employee_code" />
              <div className="field-hint">Recursos Humanos lo confirmará.</div>
            </label>
            <label className="field">
              <span>Contraseña</span>
              <input name="password" type="password" autoComplete="new-password" minLength={8} required />
              <div className="field-hint">Mínimo 8 caracteres.</div>
            </label>
            <label className="field">
              <span>Confirmar contraseña</span>
              <input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
            </label>
            <button type="submit" className="btn">Crear cuenta</button>
            <p className="lead" style={{ marginTop: 18 }}>
              ¿Ya tienes cuenta? <Link href="/login" className="link">Inicia sesión</Link>
            </p>
          </form>
        )}
      </main>
    </div>
  )
}
