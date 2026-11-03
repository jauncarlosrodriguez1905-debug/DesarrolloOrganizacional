-- =====================================================================
-- Permite que cada persona vea el nombre de SU jefe directo (para el reporte).
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 005)
-- =====================================================================

-- security definer evita la recursión de RLS al consultar profiles dentro de su propia política
create or replace function public.my_manager_id() returns uuid
language sql stable security definer set search_path = public as $$
  select manager_id from profiles where id = auth.uid()
$$;

create policy profiles_read_my_manager on profiles for select to authenticated
  using (id = public.my_manager_id());
