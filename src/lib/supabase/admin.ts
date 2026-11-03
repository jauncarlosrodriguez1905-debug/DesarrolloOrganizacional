import { createClient } from '@supabase/supabase-js'
import { back } from '@/lib/auth'

/**
 * Cliente con la llave service_role: se salta RLS y puede crear usuarios.
 * Usar SOLO en acciones de servidor, después de requireHr(). Nunca importarlo en componentes de cliente.
 */
export function adminOrBack(path: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) back(path, 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el archivo .env.local.')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
