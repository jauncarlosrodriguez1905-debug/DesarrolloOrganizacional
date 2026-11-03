-- =====================================================================
-- Flujo de definición de objetivos: borrador -> en revisión -> aprobado / devuelto
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de schema.sql)
-- =====================================================================

create type objective_status as enum ('draft', 'submitted', 'approved', 'returned');

alter table objectives
  add column status         objective_status not null default 'draft',
  add column review_comment text,
  add column submitted_at   timestamptz,
  add column reviewed_at    timestamptz,
  add column reviewed_by    uuid references profiles(id);

-- ---------- Políticas: se reemplaza la política general de escritura ----------
drop policy if exists objectives_write on objectives;

-- Crear: RH, o el dueño de un objetivo individual con periodo abierto
create policy objectives_insert on objectives for insert to authenticated
  with check (
    public.is_hr()
    or (scope = 'individual' and owner_id = auth.uid()
        and exists (select 1 from periods p where p.id = period_id and p.status = 'open'))
  );

-- Editar: RH; el dueño mientras sea borrador o devuelto; el jefe solo si está en revisión
create policy objectives_update on objectives for update to authenticated
  using (
    public.is_hr()
    or (scope = 'individual' and owner_id = auth.uid() and status in ('draft', 'returned')
        and exists (select 1 from periods p where p.id = period_id and p.status = 'open'))
    or (scope = 'individual' and public.is_manager_of(owner_id) and status = 'submitted'
        and exists (select 1 from periods p where p.id = period_id and p.status = 'open'))
  )
  with check (
    public.is_hr()
    or (scope = 'individual' and (owner_id = auth.uid() or public.is_manager_of(owner_id)))
  );

-- Eliminar: RH, o el dueño mientras sea borrador o devuelto
create policy objectives_delete on objectives for delete to authenticated
  using (
    public.is_hr()
    or (scope = 'individual' and owner_id = auth.uid() and status in ('draft', 'returned')
        and exists (select 1 from periods p where p.id = period_id and p.status = 'open'))
  );

-- ---------- Reglas del flujo (la base de datos las impone, no la pantalla) ----------
create or replace function public.enforce_objective_flow() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  total int;
begin
  -- Llave de servicio o RH: sin restricciones de flujo
  if uid is null or public.is_hr() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.review_comment := null;
    new.submitted_at := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    return new;
  end if;

  -- UPDATE
  if new.owner_id is distinct from old.owner_id
     or new.scope is distinct from old.scope
     or new.period_id is distinct from old.period_id then
    raise exception 'No se puede cambiar el dueño, el tipo ni el periodo del objetivo.';
  end if;

  if old.owner_id = uid then
    -- El dueño solo puede editar o enviar a revisión
    if new.status not in (old.status, 'submitted') then
      raise exception 'Solo puedes enviar el objetivo a revisión.';
    end if;
    new.review_comment := old.review_comment;
    new.reviewed_at    := old.reviewed_at;
    new.reviewed_by    := old.reviewed_by;
    if new.status = 'submitted' and old.status <> 'submitted' then
      select coalesce(sum(weight), 0) into total from objectives
       where scope = 'individual' and owner_id = new.owner_id and period_id = new.period_id
         and id <> new.id;
      if total + new.weight <> 100 then
        raise exception 'Los pesos de tus objetivos deben sumar 100%% para enviarlos a revisión (suman %).', total + new.weight;
      end if;
      new.submitted_at := now();
    end if;

  elsif public.is_manager_of(old.owner_id) then
    -- El jefe solo puede aprobar o devolver, sin tocar el contenido
    if old.status <> 'submitted' or new.status not in ('approved', 'returned') then
      raise exception 'Solo puedes aprobar o devolver objetivos que están en revisión.';
    end if;
    if new.title       is distinct from old.title
       or new.description is distinct from old.description
       or new.category    is distinct from old.category
       or new.weight      is distinct from old.weight then
      raise exception 'El jefe no puede modificar el contenido del objetivo.';
    end if;
    if new.status = 'returned' and coalesce(btrim(new.review_comment), '') = '' then
      raise exception 'Escribe un comentario al devolver el objetivo.';
    end if;
    new.reviewed_at := now();
    new.reviewed_by := uid;
    new.submitted_at := old.submitted_at;

  else
    raise exception 'No tienes permiso para modificar este objetivo.';
  end if;

  return new;
end $$;

create trigger trg_objective_flow
  before insert or update on objectives
  for each row execute function public.enforce_objective_flow();
