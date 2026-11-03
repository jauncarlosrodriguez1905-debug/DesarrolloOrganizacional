import { redirect } from 'next/navigation'
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
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
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
          {error && (
            <div className="alert" role="alert">
              Correo o contraseña incorrectos. Revisa los datos e intenta de nuevo.
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
        </form>
      </main>
    </div>
  )
}
