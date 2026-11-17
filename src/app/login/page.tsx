import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'

async function login(formData: FormData) {
  'use server'
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email')),
    password: String(formData.get('password')),
  })
  if (error) redirect('/login?error=1')
  redirect('/dashboard')
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  const supabase = await createClient()
  const { data: signupOpen } = await supabase.rpc('signup_is_open')
  return (
    <div className="auth">
      <section className="auth-brand">
        <div className="brand">
          <Image src="/jbi-logo.png" alt="JBI" width={96} height={96} className="brand-logo" priority />
          Desempeño
        </div>
        <div>
          <h1>Gestión del desempeño</h1>
          <p>Objetivos, autoevaluación y evaluación del jefe en un solo lugar. Cada persona ve únicamente lo que le corresponde.</p>
        </div>
      </section>

      <main className="auth-form">
        <form action={login}>
          <h2>Iniciar sesión</h2>
          <p className="lead">Usa el correo y la contraseña que te asignó Recursos Humanos.</p>
          {ok === 'password' && (
            <div className="success" role="status">
              Tu contraseña fue actualizada. Entra con tu contraseña nueva.
            </div>
          )}
          {error && (
            <div className="alert" role="alert">
              {error === 'confirm'
                ? 'El enlace de confirmación no es válido o ya expiró. Intenta registrarte de nuevo.'
                : 'Correo o contraseña incorrectos. Revisa los datos e intenta de nuevo.'}
            </div>
          )}
          <label className="field">
            <span>Correo</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit" className="btn">Entrar</button>
          <p className="lead" style={{ marginTop: 18 }}>
            ¿Olvidaste tu contraseña? <Link href="/login/recuperar" className="link">Recuperarla</Link>
          </p>
          {signupOpen && (
            <p className="lead" style={{ marginTop: 18 }}>
              ¿Primera vez? <Link href="/registro" className="link">Crea tu cuenta</Link>
            </p>
          )}
        </form>
      </main>
    </div>
  )
}
