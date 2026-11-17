-- =====================================================================
-- Escala Likert de 5 puntos, con tope en 100%
--  * Antes: 1 = 0%, 2 = 50%, 3 = 80%, 4 = 100%, 5 = 120%.
--  * Ahora: 1 = 20% Totalmente en desacuerdo, 2 = 40% En desacuerdo,
--    3 = 60% Ni de acuerdo ni en desacuerdo, 4 = 80% De acuerdo,
--    5 = 100% Totalmente de acuerdo.
--  * Las vistas cycle_results y objective_report llaman a score_factor,
--    así que sus resultados (Dashboard, Reporte, Seguimiento) también
--    quedan topados a 100% sin cambiar las vistas.
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 015)
-- =====================================================================

create or replace function public.score_factor(s int) returns numeric
language sql immutable as $$
  select case s when 1 then 0.2 when 2 then 0.4 when 3 then 0.6 when 4 then 0.8 when 5 then 1.0 else 0 end
$$;
