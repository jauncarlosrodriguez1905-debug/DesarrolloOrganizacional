-- =====================================================================
-- Evaluaciones mensuales y de cierre de trimestre + retroalimentación del jefe
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 002)
-- =====================================================================

-- 1) Cada evaluación pertenece a un ciclo: un mes ('2026-10') o el cierre ('final')
alter table evaluations
  add column cycle       text not null default 'final',
  add column released_at timestamptz;   -- cuándo el jefe la publicó para el colaborador

alter table evaluations drop constraint if exists evaluations_objective_id_kind_key;
alter table evaluations add constraint evaluations_unique_cycle unique (objective_id, kind, cycle);

-- 2) Quién puede ver una evaluación
--    El colaborador ve su autoevaluación siempre; la del jefe solo cuando la publica
--    (o cuando el periodo se cierra).
drop policy if exists evals_read on evaluations;
drop function if exists public.can_read_eval(uuid, eval_kind);

create or replace function public.can_read_eval(obj uuid, k eval_kind, released timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_hr()
      or public.is_manager_of(public.owner_of(obj))
      or (public.owner_of(obj) = auth.uid()
          and (k = 'self' or released is not null or public.period_status_of(obj) = 'closed'))
$$;

create policy evals_read on evaluations for select to authenticated
  using (public.can_read_eval(objective_id, kind, released_at));

-- 3) Quién puede escribir: solo objetivos APROBADOS, con el periodo abierto
create or replace function public.can_write_eval(obj uuid, k eval_kind) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_hr()
      or (
        public.period_status_of(obj) = 'open'
        and exists (select 1 from objectives o where o.id = obj and o.status = 'approved')
        and (
          (k = 'self'    and public.owner_of(obj) = auth.uid()) or
          (k = 'manager' and public.is_manager_of(public.owner_of(obj)))
        )
      )
$$;

-- 4) Reglas de integridad del ciclo
create or replace function public.enforce_evaluation_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p_start date;
  p_end   date;
  m_start date;
begin
  select pe.starts_on, pe.ends_on into p_start, p_end
    from objectives o join periods pe on pe.id = o.period_id
   where o.id = new.objective_id;

  if new.cycle <> 'final' then
    if new.cycle !~ '^\d{4}-(0[1-9]|1[0-2])$' then
      raise exception 'Ciclo de evaluación no válido.';
    end if;
    m_start := to_date(new.cycle || '-01', 'YYYY-MM-DD');
    if m_start < date_trunc('month', p_start)::date or m_start > p_end then
      raise exception 'Ese mes queda fuera del periodo.';
    end if;
  end if;

  -- La autoevaluación nunca se "publica": la ve su dueño y su jefe
  if new.kind = 'self' then
    new.released_at := null;
  end if;
  return new;
end $$;

create trigger trg_evaluation_rules
  before insert or update on evaluations
  for each row execute function public.enforce_evaluation_rules();

-- 5) Retroalimentación general del jefe (por persona y ciclo)
create table feedback (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references profiles(id) on delete cascade,
  period_id   uuid not null references periods(id)  on delete cascade,
  cycle       text not null default 'final',
  author_id   uuid references profiles(id) default auth.uid(),
  body        text not null,
  released_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (employee_id, period_id, cycle)
);

alter table feedback enable row level security;

create policy feedback_read on feedback for select to authenticated using (
  public.is_hr()
  or public.is_manager_of(employee_id)
  or (employee_id = auth.uid()
      and (released_at is not null
           or exists (select 1 from periods p where p.id = period_id and p.status = 'closed')))
);

create policy feedback_insert on feedback for insert to authenticated with check (
  public.is_hr()
  or (public.is_manager_of(employee_id)
      and exists (select 1 from periods p where p.id = period_id and p.status = 'open'))
);

create policy feedback_update on feedback for update to authenticated
  using (
    public.is_hr()
    or (public.is_manager_of(employee_id)
        and exists (select 1 from periods p where p.id = period_id and p.status = 'open'))
  )
  with check (
    public.is_hr() or public.is_manager_of(employee_id)
  );

create trigger trg_feedback_updated before update on feedback
  for each row execute function public.touch_updated_at();
