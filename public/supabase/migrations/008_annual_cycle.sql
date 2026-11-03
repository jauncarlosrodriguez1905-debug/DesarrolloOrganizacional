-- =====================================================================
-- Modelo anual: 3 cuartos (ene-sep) + cierre anual (oct-dic)
--  * Cada periodo tiene dos fases que RH abre y cierra por separado:
--      - allow_objectives : definir y aprobar objetivos
--      - allow_evaluations: evaluar (jefe por cuarto y cierre anual; autoevaluación solo anual)
--  * Así, de octubre a diciembre se pueden definir los objetivos del año siguiente
--    mientras se evalúa el año que cierra.
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 007)
-- =====================================================================

-- 1) Fases por periodo
alter table periods
  add column allow_objectives  boolean not null default false,
  add column allow_evaluations boolean not null default false;

-- Los periodos que ya estaban abiertos conservan su comportamiento actual
update periods set allow_objectives = true, allow_evaluations = true where status = 'open';

-- 2) Funciones de acceso basadas en las fases
create or replace function public.evals_open_of(obj uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p.allow_evaluations
    from objectives o join periods p on p.id = o.period_id
   where o.id = obj
$$;

create or replace function public.can_write_eval(obj uuid, k eval_kind) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_hr()
      or (
        public.evals_open_of(obj)
        and exists (select 1 from objectives o where o.id = obj and o.status = 'approved')
        and (
          (k = 'self'    and public.owner_of(obj) = auth.uid()) or
          (k = 'manager' and public.is_manager_of(public.owner_of(obj)))
        )
      )
$$;

-- 3) Objetivos: se escriben solo mientras la fase de objetivos esté abierta
drop policy if exists objectives_insert on objectives;
drop policy if exists objectives_update on objectives;
drop policy if exists objectives_delete on objectives;

create policy objectives_insert on objectives for insert to authenticated
  with check (
    public.is_hr()
    or (scope = 'individual' and owner_id = auth.uid()
        and exists (select 1 from periods p where p.id = period_id and p.allow_objectives))
  );

create policy objectives_update on objectives for update to authenticated
  using (
    public.is_hr()
    or (scope = 'individual' and owner_id = auth.uid() and status in ('draft', 'returned')
        and exists (select 1 from periods p where p.id = period_id and p.allow_objectives))
    or (scope = 'individual' and public.is_manager_of(owner_id) and status = 'submitted'
        and exists (select 1 from periods p where p.id = period_id and p.allow_objectives))
  )
  with check (
    public.is_hr()
    or (scope = 'individual' and (owner_id = auth.uid() or public.is_manager_of(owner_id)))
  );

create policy objectives_delete on objectives for delete to authenticated
  using (
    public.is_hr()
    or (scope = 'individual' and owner_id = auth.uid() and status in ('draft', 'returned')
        and exists (select 1 from periods p where p.id = period_id and p.allow_objectives))
  );

-- 4) Retroalimentación: solo con la fase de evaluaciones abierta
drop policy if exists feedback_insert on feedback;
drop policy if exists feedback_update on feedback;

create policy feedback_insert on feedback for insert to authenticated with check (
  public.is_hr()
  or (public.is_manager_of(employee_id)
      and exists (select 1 from periods p where p.id = period_id and p.allow_evaluations))
);

create policy feedback_update on feedback for update to authenticated
  using (
    public.is_hr()
    or (public.is_manager_of(employee_id)
        and exists (select 1 from periods p where p.id = period_id and p.allow_evaluations))
  )
  with check (public.is_hr() or public.is_manager_of(employee_id));

-- 5) Ciclos: T1..Tn (cuartos del periodo) y 'final' (cierre anual).
--    La autoevaluación solo existe en el cierre anual.
create or replace function public.enforce_evaluation_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p_start    date;
  p_end      date;
  n_quarters int;
  q          int;
begin
  select pe.starts_on, pe.ends_on into p_start, p_end
    from objectives o join periods pe on pe.id = o.period_id
   where o.id = new.objective_id;

  if new.cycle <> 'final' then
    if new.cycle !~ '^T[1-9]$' then
      raise exception 'Ciclo de evaluación no válido.';
    end if;
    q := substr(new.cycle, 2)::int;
    n_quarters := greatest(1, ceil(
      ((extract(year from p_end) - extract(year from p_start)) * 12
        + extract(month from p_end) - extract(month from p_start) + 1) / 3.0
    ))::int;
    if q > n_quarters then
      raise exception 'Ese cuarto queda fuera del periodo.';
    end if;
  end if;

  if new.kind = 'self' then
    if new.cycle <> 'final' then
      raise exception 'La autoevaluación se hace una sola vez al año, en el cierre anual.';
    end if;
    new.released_at := null;
  end if;
  return new;
end $$;

-- OPCIONAL: borra las evaluaciones MENSUALES de prueba hechas antes de este cambio.
-- (Ya no aparecen en pantalla; borrarlas solo limpia datos de prueba.)
-- delete from evaluations where cycle ~ '^\d{4}-\d{2}$';
