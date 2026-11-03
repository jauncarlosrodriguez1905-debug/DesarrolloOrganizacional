-- =====================================================================
-- Datos extra para el panel de seguimiento (estatus de cada fase)
--  * person_progress: cuántos objetivos están devueltos
--  * cycle_results  : si la evaluación del jefe ya fue publicada
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 009)
-- Las columnas nuevas van al final, así las pantallas anteriores siguen funcionando.
-- =====================================================================

create or replace view public.person_progress with (security_invoker = true) as
select
  o.owner_id,
  o.period_id,
  p.full_name,
  p.area_id,
  p.manager_id,
  count(*)::int as objectives,
  (count(*) filter (where o.status = 'approved'))::int  as approved,
  (count(*) filter (where o.status = 'submitted'))::int as submitted,
  (count(*) filter (where o.status = 'returned'))::int  as returned
from objectives o
join profiles p on p.id = o.owner_id
where o.scope = 'individual'
group by o.owner_id, o.period_id, p.full_name, p.area_id, p.manager_id;

create or replace view public.cycle_results with (security_invoker = true) as
select
  o.owner_id,
  o.period_id,
  e.cycle,
  e.kind,
  p.full_name,
  p.area_id,
  p.manager_id,
  sum(o.weight * public.score_factor(e.score))::numeric(7,2) as result,
  count(*)::int as evaluated,
  (select count(*) from objectives x
    where x.owner_id = o.owner_id and x.period_id = o.period_id
      and x.scope = 'individual' and x.status = 'approved')::int as objectives,
  bool_and(e.released_at is not null) as published
from objectives o
join evaluations e on e.objective_id = o.id
join profiles p on p.id = o.owner_id
where o.scope = 'individual' and o.status = 'approved'
group by o.owner_id, o.period_id, e.cycle, e.kind, p.full_name, p.area_id, p.manager_id;
