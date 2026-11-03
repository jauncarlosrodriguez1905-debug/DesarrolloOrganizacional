-- =====================================================================
-- Reconocimiento laboral positivo por cuarto
--  * El jefe registra algo positivo de cada colaborador en cada cuarto (T1, T2, T3).
--  * SIN reconocimiento no se puede publicar (cerrar) el cuarto de esa persona: lo exige la base de datos.
--  * La persona lo ve cuando el jefe publica la evaluación.
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 014)
-- =====================================================================

create table recognitions (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references profiles(id) on delete cascade,
  period_id   uuid not null references periods(id)  on delete cascade,
  cycle       text not null check (cycle ~ '^T[1-3]$'),
  body        text not null check (char_length(btrim(body)) > 0),
  author_id   uuid references profiles(id) default auth.uid(),
  released_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (employee_id, period_id, cycle)
);

alter table recognitions enable row level security;

-- Lo ven: RH, el jefe directo, y la propia persona solo cuando ya fue publicado
create policy recognitions_read on recognitions for select to authenticated using (
  public.is_hr()
  or public.is_manager_of(employee_id)
  or (employee_id = auth.uid()
      and (released_at is not null
           or exists (select 1 from periods p where p.id = period_id and p.status = 'closed')))
);

-- Lo escriben: RH, o el jefe directo mientras la fase de evaluaciones esté abierta
create policy recognitions_insert on recognitions for insert to authenticated with check (
  public.is_hr()
  or (public.is_manager_of(employee_id)
      and exists (select 1 from periods p where p.id = period_id and p.allow_evaluations))
);

create policy recognitions_update on recognitions for update to authenticated
  using (
    public.is_hr()
    or (public.is_manager_of(employee_id)
        and exists (select 1 from periods p where p.id = period_id and p.allow_evaluations))
  )
  with check (public.is_hr() or public.is_manager_of(employee_id));

create policy recognitions_delete on recognitions for delete to authenticated using (
  public.is_hr()
  or (public.is_manager_of(employee_id)
      and released_at is null
      and exists (select 1 from periods p where p.id = period_id and p.allow_evaluations))
);

create trigger trg_recognitions_updated before update on recognitions
  for each row execute function public.touch_updated_at();

-- Regla de las evaluaciones (013) + candado: no se publica un cuarto sin reconocimiento
create or replace function public.enforce_evaluation_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p_start       date;
  p_end         date;
  q             int;
  q_start       date;
  q_end         date;
  prev_released timestamptz := null;
begin
  select pe.starts_on, pe.ends_on into p_start, p_end
    from objectives o join periods pe on pe.id = o.period_id
   where o.id = new.objective_id;

  if new.cycle <> 'final' then
    if new.cycle !~ '^T[1-3]$' then
      raise exception 'Ciclo no válido: solo hay 3 cuartos (enero a septiembre) y el cierre anual.';
    end if;
    q := substr(new.cycle, 2)::int;
    q_start := make_date(extract(year from p_start)::int, (q - 1) * 3 + 1, 1);
    q_end   := (q_start + interval '3 months' - interval '1 day')::date;
    if q_start > p_end or q_end < p_start then
      raise exception 'Ese cuarto queda fuera del periodo.';
    end if;
  end if;

  if new.kind = 'manager' and new.cycle = 'final' then
    raise exception 'El jefe evalúa por cuarto; el cierre anual es el promedio de los cuartos.';
  end if;

  if new.kind = 'self' then
    if new.cycle <> 'final' then
      raise exception 'La autoevaluación se hace una sola vez al año, en el cierre anual.';
    end if;
    new.released_at := null;
  end if;

  -- Publicar (cerrar) el cuarto exige el reconocimiento positivo
  if tg_op = 'UPDATE' then
    prev_released := old.released_at;
  end if;
  if new.kind = 'manager' and new.released_at is not null and prev_released is null then
    if not exists (
      select 1
        from recognitions r
        join objectives o on o.id = new.objective_id
       where r.employee_id = o.owner_id and r.period_id = o.period_id and r.cycle = new.cycle
         and char_length(btrim(r.body)) > 0
    ) then
      raise exception 'Falta el reconocimiento positivo del cuarto. Regístralo para poder publicar la evaluación.';
    end if;
  end if;

  return new;
end $$;
