-- =====================================================================
-- Sistema de Evaluación de Desempeño - Esquema Supabase (Postgres 15+)
-- Ejecutar completo en: Supabase > SQL Editor
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tipos ----------
create type app_role        as enum ('admin', 'do_coordinator', 'manager', 'employee');
create type objective_scope as enum ('company', 'area', 'individual');
create type eval_kind       as enum ('manager', 'self');
create type period_status   as enum ('draft', 'open', 'closed');

-- ---------- Tablas ----------
create table areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  employee_code text unique,
  full_name     text not null,
  area_id       uuid references areas(id),
  manager_id    uuid references profiles(id),
  role          app_role not null default 'employee',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table periods (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,                 -- ej. 'Q2 2026'
  starts_on date not null,
  ends_on   date not null,
  status    period_status not null default 'draft',
  check (ends_on >= starts_on)
);

create table objectives (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references periods(id) on delete cascade,
  scope       objective_scope not null,
  owner_id    uuid references profiles(id) on delete cascade,  -- scope = individual
  area_id     uuid references areas(id)    on delete cascade,  -- scope = area
  parent_id   uuid references objectives(id) on delete set null, -- desglose: área -> individual
  category    text not null,
  title       text not null,
  description text,
  weight      int  not null check (weight between 1 and 100),
  created_by  uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  check (
    (scope = 'individual' and owner_id is not null) or
    (scope = 'area'       and area_id  is not null) or
    (scope = 'company')
  )
);
create index on objectives (period_id, owner_id);
create index on objectives (period_id, area_id);

create table evaluations (
  id           uuid primary key default gen_random_uuid(),
  objective_id uuid not null references objectives(id) on delete cascade,
  kind         eval_kind not null,
  evaluator_id uuid references profiles(id) default auth.uid(),
  score        int not null check (score between 1 and 5),
  comment      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (objective_id, kind)
);

-- ---------- Funciones auxiliares (security definer para evitar recursión de RLS) ----------
create or replace function public.is_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','do_coordinator') from profiles where id = auth.uid()), false)
$$;

create or replace function public.my_area() returns uuid
language sql stable security definer set search_path = public as $$
  select area_id from profiles where id = auth.uid()
$$;

-- Jefe directo (un nivel). Para jerarquías más profundas se puede cambiar a una consulta recursiva.
create or replace function public.is_manager_of(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = target and manager_id = auth.uid())
$$;

create or replace function public.period_status_of(obj uuid) returns period_status
language sql stable security definer set search_path = public as $$
  select p.status from objectives o join periods p on p.id = o.period_id where o.id = obj
$$;

create or replace function public.owner_of(obj uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select owner_id from objectives where id = obj
$$;

-- ¿Puede el usuario actual capturar este tipo de evaluación?
create or replace function public.can_write_eval(obj uuid, k eval_kind) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_hr()
      or (public.period_status_of(obj) = 'open' and (
            (k = 'self'    and public.owner_of(obj) = auth.uid()) or
            (k = 'manager' and public.is_manager_of(public.owner_of(obj)))
         ))
$$;

-- ¿Puede el usuario actual ver esta evaluación?
-- El colaborador ve su autoevaluación siempre y la del jefe solo con el periodo cerrado.
create or replace function public.can_read_eval(obj uuid, k eval_kind) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_hr()
      or public.is_manager_of(public.owner_of(obj))
      or (public.owner_of(obj) = auth.uid()
          and (k = 'self' or public.period_status_of(obj) = 'closed'))
$$;

-- ---------- Regla: la suma de pesos no puede pasar de 100 ----------
create or replace function public.check_weight_sum() returns trigger
language plpgsql security definer set search_path = public as $$
declare total int;
begin
  if new.scope = 'individual' then
    select coalesce(sum(weight), 0) into total from objectives
     where scope = 'individual' and owner_id = new.owner_id
       and period_id = new.period_id and id is distinct from new.id;
  elsif new.scope = 'area' then
    select coalesce(sum(weight), 0) into total from objectives
     where scope = 'area' and area_id = new.area_id
       and period_id = new.period_id and id is distinct from new.id;
  else
    return new;
  end if;
  if total + new.weight > 100 then
    raise exception 'La suma de pesos superaría 100 (actual: %)', total;
  end if;
  return new;
end $$;

create trigger trg_check_weight
  before insert or update of weight, owner_id, area_id, period_id on objectives
  for each row execute function public.check_weight_sum();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create trigger trg_eval_updated before update on evaluations
  for each row execute function public.touch_updated_at();

-- ---------- Perfil automático al crear usuario en Auth ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, employee_code)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          new.raw_user_meta_data->>'employee_code');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Escala de calificación (igual que el HTML original) ----------
create or replace function public.score_factor(s int) returns numeric
language sql immutable as $$
  select case s when 1 then 0 when 2 then 0.5 when 3 then 0.8 when 4 then 1.0 when 5 then 1.2 else 0 end
$$;

-- Vista de reporte; security_invoker hace que respete el RLS de quien consulta
create view objective_report with (security_invoker = true) as
select o.id as objective_id, o.period_id, o.owner_id, o.category, o.title, o.weight,
       m.score as manager_score, s.score as self_score,
       public.score_factor(m.score) * o.weight as manager_weighted,
       public.score_factor(s.score) * o.weight as self_weighted
from objectives o
left join evaluations m on m.objective_id = o.id and m.kind = 'manager'
left join evaluations s on s.objective_id = o.id and s.kind = 'self'
where o.scope = 'individual';

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table areas       enable row level security;
alter table profiles    enable row level security;
alter table periods     enable row level security;
alter table objectives  enable row level security;
alter table evaluations enable row level security;

-- areas / periods: lectura para todo usuario autenticado, escritura solo RH
create policy areas_read   on areas   for select to authenticated using (true);
create policy areas_write  on areas   for all    to authenticated using (public.is_hr()) with check (public.is_hr());
create policy periods_read  on periods for select to authenticated using (true);
create policy periods_write on periods for all    to authenticated using (public.is_hr()) with check (public.is_hr());

-- profiles: yo, mi equipo y RH. Solo RH modifica (incluye roles).
create policy profiles_read on profiles for select to authenticated
  using (id = auth.uid() or manager_id = auth.uid() or public.is_hr());
create policy profiles_write on profiles for all to authenticated
  using (public.is_hr()) with check (public.is_hr());

-- objectives
create policy objectives_read on objectives for select to authenticated using (
  public.is_hr()
  or scope = 'company'
  or (scope = 'area' and area_id = public.my_area())
  or (scope = 'individual' and (owner_id = auth.uid() or public.is_manager_of(owner_id)))
);
-- Objetivos de empresa/área: solo RH (coordinador de DO). Individuales: dueño o jefe, con periodo abierto.
create policy objectives_write on objectives for all to authenticated
  using (
    public.is_hr()
    or (scope = 'individual'
        and (owner_id = auth.uid() or public.is_manager_of(owner_id))
        and exists (select 1 from periods p where p.id = period_id and p.status = 'open'))
  )
  with check (
    public.is_hr()
    or (scope = 'individual'
        and (owner_id = auth.uid() or public.is_manager_of(owner_id))
        and exists (select 1 from periods p where p.id = period_id and p.status = 'open'))
  );

-- evaluations
create policy evals_read on evaluations for select to authenticated
  using (public.can_read_eval(objective_id, kind));
create policy evals_insert on evaluations for insert to authenticated
  with check (public.can_write_eval(objective_id, kind) and evaluator_id = auth.uid());
create policy evals_update on evaluations for update to authenticated
  using (public.can_write_eval(objective_id, kind))
  with check (public.can_write_eval(objective_id, kind));

-- =====================================================================
-- ARRANQUE (hacer a mano, una sola vez)
-- 1) Crear tu usuario en Authentication > Users.
-- 2) Convertirlo en admin:
--      update profiles set role = 'admin' where full_name = 'TU NOMBRE';
-- 3) Crear el primer periodo:
--      insert into periods (name, starts_on, ends_on, status)
--      values ('Q4 2026', '2026-10-01', '2026-12-31', 'open');
-- =====================================================================
