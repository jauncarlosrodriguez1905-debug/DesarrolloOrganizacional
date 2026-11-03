-- =====================================================================
-- Configuración editable por RH (por ahora: enlace a la matriz de objetivos)
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 006)
-- =====================================================================

create table app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

-- Todo usuario autenticado puede leer; solo RH puede escribir
create policy settings_read on app_settings for select to authenticated using (true);
create policy settings_write on app_settings for all to authenticated
  using (public.is_hr()) with check (public.is_hr());
