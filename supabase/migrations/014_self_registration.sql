-- =====================================================================
-- Registro de personal con correo de la empresa
--  * RH define los dominios permitidos en Administración > Configuración
--    (app_settings.signup_domains, separados por coma). Vacío = registro CERRADO.
--  * La base de datos rechaza cualquier registro NO confirmado cuyo dominio no esté permitido
--    (aunque alguien llame a la API directo, sin pasar por la pantalla).
--  * Las cuentas que crea RH (ya confirmadas) no pasan por este filtro.
-- REQUISITO: en Supabase > Authentication > Sign In / Providers > Email, "Confirm email" debe estar ACTIVADO.
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 013)
-- =====================================================================

-- 1) Dominios permitidos (exactos, sin subdominios)
create or replace function public.signup_domains() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    array(
      select lower(btrim(d))
      from unnest(string_to_array(coalesce((select value from app_settings where key = 'signup_domains'), ''), ',')) as d
      where btrim(d) <> ''
    ),
    array[]::text[]
  )
$$;

create or replace function public.is_signup_email_allowed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from unnest(public.signup_domains()) as d
    where lower(split_part(btrim(p_email), '@', 2)) = d
  )
$$;

create or replace function public.signup_is_open() returns boolean
language sql stable security definer set search_path = public as $$
  select cardinality(public.signup_domains()) > 0
$$;

-- La pantalla pública de registro solo necesita saber "abierto / cerrado" y "este correo sirve"
grant execute on function public.is_signup_email_allowed(text) to anon, authenticated;
grant execute on function public.signup_is_open() to anon, authenticated;

-- 2) Candado en la base de datos
create or replace function public.enforce_signup_domain() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Cuentas creadas por RH (la llave de servicio las deja confirmadas desde el inicio)
  if new.email_confirmed_at is not null then
    return new;
  end if;
  if public.is_signup_email_allowed(new.email) then
    return new;
  end if;
  raise exception 'Solo se puede registrar con un correo de la empresa.';
end $$;

drop trigger if exists trg_enforce_signup_domain on auth.users;
create trigger trg_enforce_signup_domain
  before insert on auth.users
  for each row execute function public.enforce_signup_domain();

-- 3) El perfil se crea solo; si el código de empleado ya existe, se guarda sin código (RH lo asigna)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text := coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), new.email);
  v_code text := nullif(btrim(new.raw_user_meta_data->>'employee_code'), '');
begin
  begin
    insert into profiles (id, full_name, employee_code)
    values (new.id, left(v_name, 120), left(v_code, 40));
  exception when unique_violation then
    insert into profiles (id, full_name, employee_code)
    values (new.id, left(v_name, 120), null);
  end;
  return new;
end $$;
