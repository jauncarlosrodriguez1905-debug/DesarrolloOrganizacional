import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'

const fail = (m: string): never => redirect('/login/recuperar?error=' + encodeURIComponent(m))

async function requestReset(formData: FormData) {
  'use server'
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!email) fail('Escribe tu correo.')

  const supabase = await createClient()
  const h = await headers()
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? h.get('origin') ?? 'http://localhost:3000'

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/auth/nueva-contrasena`,
  })
  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('rate limit')) fail('Se enviaron demasiados correos en poco tiempo. Espera unos minutos e inténtalo de nuevo.')
    fail('No se pudo enviar el correo. Intenta de nuevo.')
  }
  // Por seguridad el mensaje es el mismo exista o no la cuenta con ese correo.
  redirect('/login/recuperar?sent=' + encodeURIComponent(email))
}

export default async function RecuperarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>
}) {
  const { error, sent } = await searchParams
  return (
    <div className="auth">
      <section className="auth-brand">
        <div className="brand">
          <Image src="/jbi-logo.png" alt="JBI" width={96} height={96} className="brand-logo" priority />
          Desempeño
        </div>
        <div>
          <h1>Gestión del desempeño</h1>
          <p>Te enviamos un enlace a tu correo para que pongas una contraseña nueva.</p>
        </div>
      </section>

      <main className="auth-form">
        {sent ? (
          <div style={{ width: '100%', maxWidth: 360 }}>
            <h2>Revisa tu correo</h2>
            <p className="lead">
              Te enviamos un enlace de recuperación a <strong>{sent}</strong>. Ábrelo para poner tu
              contraseña nueva. Si no lo ves, revisa la carpeta de correo no deseado.
            </p>
            <Link href="/login" className="link">← Volver a iniciar sesión</Link>
          </div>
        ) : (
          <form action={requestReset}>
            <h2>Recuperar contraseña</h2>
            <p className="lead">Escribe el correo con el que entras a la app.</p>
            {error && <div className="alert" role="alert">{error}</div>}
            <label className="field">
              <span>Correo</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <button type="submit" className="btn">Enviar enlace</button>
            <p className="lead" style={{ marginTop: 18 }}>
              <Link href="/login" className="link">← Volver a iniciar sesión</Link>
            </p>
          </form>
        )}
      </main>
    </div>
  )
}
