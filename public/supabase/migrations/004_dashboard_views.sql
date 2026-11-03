-- =====================================================================
-- Vistas para el dashboard (resultado por persona y ciclo, y avance)
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 003)
-- security_invoker = cada quien solo ve lo que ya le permite RLS:
--   colaborador: lo suyo · jefe: su equipo · RH: todo
-- =====================================================================

-- Resultado ponderado por persona, periodo, ciclo y tipo (autoevaluación / jefe).
-- result = suma de (peso x factor de la calificación); con pesos que suman 100 el máximo es 120.
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
      and x.scope = 'individual' and x.status = 'approved')::int as objectives
from objectives o
join evaluations e on e.objective_id = o.id
join profiles p on p.id = o.owner_id
where o.scope = 'individual' and o.status = 'approved'
group by o.owner_id, o.period_id, e.cycle, e.kind, p.full_name, p.area_id, p.manager_id;

-- Avance de definición de objetivos por persona y periodo
create or replace view public.person_progress with (security_invoker = true) as
select
  o.owner_id,
  o.period_id,
  p.full_name,
  p.area_id,
  p.manager_id,
  count(*)::int as objectives,
  (count(*) filter (where o.status = 'approved'))::int  as approved,
  (count(*) filter (where o.status = 'submitted'))::int as submitted
from objectives o
join profiles p on p.id = o.owner_id
where o.scope = 'individual'
group by o.owner_id, o.period_id, p.full_name, p.area_id, p.manager_id;
