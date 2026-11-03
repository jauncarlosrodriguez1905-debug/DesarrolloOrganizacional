-- =====================================================================
-- Objetivos personales (desarrollo propio): sin peso, sin aprobación, sin evaluación
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 004)
-- =====================================================================

create type goal_status as enum ('pending', 'in_progress', 'done');

create table personal_goals (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid() references profiles(id) on delete cascade,
  title               text not null check (char_length(btrim(title)) > 0),
  description         text,
  target_date         date,
  status              goal_status not null default 'pending',
  shared_with_manager boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index on personal_goals (owner_id);

alter table personal_goals enable row level security;

-- Privados por defecto: solo su dueño. El jefe directo los ve únicamente si la persona los comparte.
create policy goals_read on personal_goals for select to authenticated
  using (owner_id = auth.uid() or (shared_with_manager and public.is_manager_of(owner_id)));

create policy goals_insert on personal_goals for insert to authenticated
  with check (owner_id = auth.uid());

create policy goals_update on personal_goals for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy goals_delete on personal_goals for delete to authenticated
  using (owner_id = auth.uid());

create trigger trg_goals_updated before update on personal_goals
  for each row execute function public.touch_updated_at();
