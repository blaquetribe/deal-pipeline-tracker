-- Feature 08: database rows authorize private objects. Bytes are handled by the API ObjectStore.

create table public.files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  deal_id uuid,
  kind text not null check (kind in ('avatar', 'attachment')),
  object_key text not null unique check (object_key !~ '(^/|\\.\\.)'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type in ('image/webp', 'application/pdf')),
  byte_size bigint not null check (byte_size between 1 and 20971520),
  state text not null default 'pending' check (state in ('pending', 'ready')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, deal_id) references public.deals(tenant_id, id) on delete restrict,
  check ((kind = 'avatar' and deal_id is null and content_type = 'image/webp' and byte_size <= 2097152)
      or (kind = 'attachment' and deal_id is not null))
);
create index files_tenant_deal_idx on public.files(tenant_id, deal_id, created_at desc)
  where kind = 'attachment' and state = 'ready';
create index files_owner_avatar_idx on public.files(owner_id, created_at desc)
  where kind = 'avatar' and state = 'ready';

alter table public.files enable row level security;
alter table public.files force row level security;
create policy files_select on public.files for select to authenticated
  using (state = 'ready' and (
    (kind = 'avatar' and (owner_id = (select app.uid()) or (select app.shares_tenant_with(owner_id))))
    or (kind = 'attachment' and (select app.has_permission(tenant_id, 'deal.view')))
  ));
revoke all on public.files from public, anon, authenticated, service_role, api_service;
grant select on public.files to authenticated;

-- Upload metadata is derived from the signed-in identity and active tenant. The service role never
-- gets a table grant; these narrow RPCs are the only write path.
create function public.file_create_pending(
  p_tenant uuid, p_kind text, p_deal uuid, p_object_key text, p_content_sha256 text,
  p_content_type text, p_byte_size bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.uid();
  v_tenant uuid;
  v_id uuid;
begin
  if v_uid is null then raise exception 'permission denied' using errcode = '42501'; end if;
  select m.tenant_id into v_tenant from public.memberships m
    where m.user_id = v_uid and m.tenant_id = p_tenant and m.deactivated_at is null
      and (p_kind = 'avatar' or app.has_permission(m.tenant_id, 'deal.edit'));
  if v_tenant is null then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_kind not in ('avatar', 'attachment') or p_content_sha256 !~ '^[0-9a-f]{64}$'
     or p_content_type not in ('image/webp', 'application/pdf')
     or p_byte_size not between 1 and 20971520
     or (p_kind = 'avatar' and (p_deal is not null or p_content_type <> 'image/webp' or p_byte_size > 2097152))
     or (p_kind = 'attachment' and p_deal is null) then
    raise exception 'invalid file metadata' using errcode = '22023';
  end if;
  if p_kind = 'avatar' and p_object_key !~ ('^(Dev|Prod)/users/' || v_uid::text || '/avatar/[0-9a-f-]{36}-' || p_content_sha256 || '$') then
    raise exception 'invalid object key' using errcode = '22023';
  end if;
  if p_kind = 'attachment' and p_object_key !~ ('^(Dev|Prod)/tenants/' || v_tenant::text || '/attachment/[0-9a-f-]{36}-' || p_content_sha256 || '$') then
    raise exception 'invalid object key' using errcode = '22023';
  end if;
  if p_kind = 'attachment' and not exists (
    select 1 from public.deals d where d.id = p_deal and d.tenant_id = v_tenant
      and app.has_permission(d.tenant_id, 'deal.edit')
  ) then raise exception 'deal not found' using errcode = 'P0002'; end if;
  insert into public.files(tenant_id, owner_id, deal_id, kind, object_key, content_sha256, content_type, byte_size)
    values (v_tenant, v_uid, p_deal, p_kind, p_object_key, p_content_sha256, p_content_type, p_byte_size)
    returning id into v_id;
  return v_id;
end $$;

create function public.file_mark_ready(p_file uuid) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  update public.files set state = 'ready'
    where id = p_file and owner_id = app.uid() and state = 'pending';
  if not found then raise exception 'file not found' using errcode = 'P0002'; end if;
end $$;

create function public.file_metadata(p_file uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', f.id, 'object_key', f.object_key, 'content_type', f.content_type,
                            'byte_size', f.byte_size, 'kind', f.kind)
  from public.files f where f.id = p_file and f.state = 'ready' and (
    (f.kind = 'avatar' and (f.owner_id = app.uid() or app.shares_tenant_with(f.owner_id)))
    or (f.kind = 'attachment' and app.has_permission(f.tenant_id, 'deal.view'))
  )
$$;

create function public.file_avatar_id(p_user uuid) returns uuid
  language sql stable security definer set search_path = '' as $$
  select f.id from public.files f where f.owner_id = p_user and f.kind = 'avatar' and f.state = 'ready'
    and (p_user = app.uid() or app.shares_tenant_with(p_user))
  order by f.created_at desc limit 1
$$;

create function public.file_list_for_deal(p_deal uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'byteSize', f.byte_size, 'createdAt', f.created_at
  ) order by f.created_at desc), '[]'::jsonb)
  from public.files f join public.deals d on d.id = f.deal_id and d.tenant_id = f.tenant_id
  where f.deal_id = p_deal and f.kind = 'attachment' and f.state = 'ready'
    and app.has_permission(d.tenant_id, 'deal.view')
$$;

create function public.file_cleanup_stale_pending() returns text[]
  language sql security definer set search_path = '' as $$
  with stale as (
    delete from public.files where state = 'pending' and created_at < now() - interval '24 hours'
      returning object_key
  )
  select coalesce(array_agg(object_key), array[]::text[]) from stale
$$;

create function public.file_list_object_keys() returns text[]
  language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(object_key), array[]::text[]) from public.files
$$;

revoke all on function public.file_create_pending(uuid, text, uuid, text, text, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.file_mark_ready(uuid) from public, anon, authenticated, service_role;
revoke all on function public.file_metadata(uuid) from public, anon, authenticated, service_role;
revoke all on function public.file_avatar_id(uuid) from public, anon, authenticated, service_role;
revoke all on function public.file_list_for_deal(uuid) from public, anon, authenticated, service_role;
revoke all on function public.file_cleanup_stale_pending() from public, anon, authenticated, service_role;
revoke all on function public.file_list_object_keys() from public, anon, authenticated, service_role;
grant execute on function public.file_create_pending(uuid, text, uuid, text, text, text, bigint) to authenticated;
grant execute on function public.file_mark_ready(uuid) to authenticated;
grant execute on function public.file_metadata(uuid) to authenticated;
grant execute on function public.file_avatar_id(uuid) to authenticated;
grant execute on function public.file_list_for_deal(uuid) to authenticated;
grant execute on function public.file_cleanup_stale_pending() to api_service;
grant execute on function public.file_list_object_keys() to api_service;
