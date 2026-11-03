-- =====================================================================
-- Evidencia por objetivo: archivos en un espacio PRIVADO de Supabase Storage
--  * Se adjunta solo a objetivos APROBADOS y mientras el periodo no esté cerrado.
--  * La ven: el dueño, su jefe directo y RH.
--  * Límites: 10 MB por archivo, 10 archivos por objetivo, solo tipos de oficina e imágenes.
-- Ejecutar UNA sola vez en Supabase > SQL Editor (después de 011)
-- =====================================================================

-- 1) Espacio de almacenamiento privado con límites
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence', 'evidence', false, 10485760,
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) Las rutas son  <id de la persona>/<id del objetivo>/<archivo>
create or replace function public.evidence_owner(obj_name text) returns uuid
language sql stable as $$
  select case
    when (storage.foldername(obj_name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then ((storage.foldername(obj_name))[1])::uuid
  end
$$;

create policy evidence_read on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence'
    and (public.is_hr()
         or public.evidence_owner(name) = auth.uid()
         or public.is_manager_of(public.evidence_owner(name)))
  );

create policy evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and public.evidence_owner(name) = auth.uid());

create policy evidence_delete on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and (public.evidence_owner(name) = auth.uid() or public.is_hr()));

-- 3) Registro de cada archivo (datos del archivo; el archivo vive en Storage)
create table objective_evidence (
  id          uuid primary key default gen_random_uuid(),
  objective_id uuid not null references objectives(id) on delete cascade,
  owner_id    uuid not null references profiles(id) on delete cascade,
  file_path   text not null unique,
  file_name   text not null,
  mime_type   text,
  size_bytes  bigint not null default 0 check (size_bytes >= 0),
  note        text,
  uploaded_by uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  -- la ruta debe corresponder a la persona y al objetivo
  check (file_path like owner_id::text || '/' || objective_id::text || '/%')
);

create index on objective_evidence (objective_id);

alter table objective_evidence enable row level security;

create policy evidence_rows_read on objective_evidence for select to authenticated
  using (public.is_hr() or owner_id = auth.uid() or public.is_manager_of(owner_id));

create policy evidence_rows_insert on objective_evidence for insert to authenticated
  with check (
    public.is_hr()
    or (
      owner_id = auth.uid()
      and exists (
        select 1 from objectives o join periods p on p.id = o.period_id
         where o.id = objective_id and o.owner_id = auth.uid()
           and o.status = 'approved' and p.status <> 'closed'
      )
    )
  );

create policy evidence_rows_delete on objective_evidence for delete to authenticated
  using (
    public.is_hr()
    or (
      owner_id = auth.uid()
      and exists (
        select 1 from objectives o join periods p on p.id = o.period_id
         where o.id = objective_id and p.status <> 'closed'
      )
    )
  );

-- 4) Máximo 10 archivos por objetivo
create or replace function public.enforce_evidence_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from objective_evidence where objective_id = new.objective_id) >= 10 then
    raise exception 'Máximo 10 archivos por objetivo. Elimina alguno para subir otro.';
  end if;
  return new;
end $$;

create trigger trg_evidence_limit before insert on objective_evidence
  for each row execute function public.enforce_evidence_limit();
