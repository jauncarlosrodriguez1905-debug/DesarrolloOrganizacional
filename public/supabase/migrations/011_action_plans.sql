-- =====================================================================
-- Planes de acción por cuarto cuando el porcentaje es bajo (< 80%)
-- Los escribe el jefe; la persona los ve cuando el jefe publica la evaluación.
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 010)
-- =====================================================================

create table action_plans (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references profiles(id) on delete cascade,
  period_id   uuid not null references periods(id)  on delete cascade,
  cycle       text not null check (cycle ~ '^T[1-3]$'),
  actions     text not null check (char_length(btrim(actions)) > 0),
  due_date    date,
  status      goal_status not null default 'pending',
  author_id   uuid references profiles(id) default auth.uid(),
  released_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (employee_id, period_id, cycle)
);

alter table action_plans enable row level security;

-- Ven el plan: RH, el jefe directo, y la propia persona solo cuando ya fue publicado
create policy plans_read on action_plans for select to authenticated using (
  public.is_hr()
  or public.is_manager_of(employee_id)
  or (employee_id = auth.uid()
      and (released_at is not null
           or exists (select 1 from periods p where p.id = period_id and p.status = 'closed')))
);

-- Escriben: RH, o el jefe directo mientras la fase de evaluaciones esté abierta
create policy plans_insert on action_plans for insert to authenticated with check (
  public.is_hr()
  or (public.is_manager_of(employee_id)
      and exists (select 1 from periods p where p.id = period_id and p.allow_evaluations))
);

create policy plans_update on action_plans for update to authenticated
  using (
    public.is_hr()
    or (public.is_manager_of(employee_id)
        and exists (select 1 from periods p where p.id = period_id and p.allow_evaluations))
  )
  with check (public.is_hr() or public.is_manager_of(employee_id));

create policy plans_delete on action_plans for delete to authenticated using (
  public.is_hr()
  or (public.is_manager_of(employee_id)
      and exists (select 1 from periods p where p.id = period_id and p.allow_evaluations))
);

create trigger trg_plans_updated before update on action_plans
  for each row execute function public.touch_updated_at();
