import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * Enlace del correo de confirmación. Acepta los dos formatos de Supabase:
 *  - token_hash + type  (plantilla de correo personalizada; funciona aunque se abra en otro dispositivo)
 *  - code               (plantilla predeterminada)
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const code = searchParams.get('code')

  const supabase = await createClient()
  let failed = false

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    failed = !!error
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    failed = !!error
  } else {
    failed = true
  }

  // A dónde ir tras validar el enlace: solo se acepta la página de
  // contraseña nueva; una recuperación sin destino también va ahí.
  const next = searchParams.get('next')
  const destination =
    next === '/auth/nueva-contrasena'
      ? next
      : type === 'recovery'
        ? '/auth/nueva-contrasena'
        : '/dashboard'

  return NextResponse.redirect(`${origin}${failed ? '/login?error=confirm' : destination}`)
}
