-- =====================================================================
-- El cierre anual del jefe NO es una evaluación aparte: es el PROMEDIO de los 3 cuartos.
--  * El jefe solo evalúa por cuarto (T1, T2, T3).
--  * La autoevaluación se hace una vez al año (cierre anual) y se compara contra ese promedio.
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 012)
-- =====================================================================

create or replace function public.enforce_evaluation_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p_start date;
  p_end   date;
  q       int;
  q_start date;
  q_end   date;
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
  return new;
end $$;

-- OPCIONAL: borra las evaluaciones de jefe de prueba que se hicieron antes en "cierre anual".
-- (Ya no se usan ni aparecen; borrarlas solo limpia datos de prueba.)
-- delete from evaluations where kind = 'manager' and cycle = 'final';
