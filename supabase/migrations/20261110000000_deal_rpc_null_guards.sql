-- A JSON caller can explicitly send null for SQL parameters. Keep pagination/version bounds fail-closed.
create or replace function public.set_deal_assignees(p_deal uuid, p_expected_version integer, p_assignments jsonb)
  returns integer
  language plpgsql security definer
  set search_path = ''
as $$
declare
  d public.deals;
  v_old jsonb;
  v_new jsonb;
  v_version integer;
begin
  select * into d from public.deals
    where id = p_deal and tenant_id in (select app.my_tenants())
    for update;
  if not found then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;
  if not app.has_permission(d.tenant_id, 'deal.edit') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if d.archived_at is not null then
    raise exception 'deal is archived' using errcode = '55000';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'invalid version' using errcode = '22023';
  end if;
  if d.version <> p_expected_version then
    raise exception 'stale version' using errcode = 'DP409';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array'
     or jsonb_array_length(p_assignments) > 50 then
    raise exception 'invalid assignments' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assignments) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item -> 'user_id') <> 'string'
       or (item ->> 'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(item -> 'role') <> 'string'
       or item ->> 'role' not in ('owner', 'lead', 'member')
  ) then
    raise exception 'invalid assignment role or user' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assignments) item
    cross join lateral jsonb_object_keys(item) key
    where key not in ('user_id', 'role')
  ) then
    raise exception 'unsupported assignment field' using errcode = '22023';
  end if;
  if exists (
    select item ->> 'user_id' from jsonb_array_elements(p_assignments) item
    group by item ->> 'user_id' having count(*) > 1
  ) then
    raise exception 'a user can have only one assignment role per deal' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assignments) item
    where not exists (
      select 1 from public.memberships m
      where m.tenant_id = d.tenant_id
        and m.user_id = (item ->> 'user_id')::uuid
        and m.deactivated_at is null
    )
  ) then
    raise exception 'assignee is not an active tenant member' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'role', a.role) order by a.role, a.user_id), '[]'::jsonb)
    into v_old from public.deal_assignees a where a.tenant_id = d.tenant_id and a.deal_id = d.id;
  delete from public.deal_assignees where tenant_id = d.tenant_id and deal_id = d.id;
  insert into public.deal_assignees (tenant_id, deal_id, user_id, role)
    select d.tenant_id, d.id, (item ->> 'user_id')::uuid, item ->> 'role'
    from jsonb_array_elements(p_assignments) item;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'role', a.role) order by a.role, a.user_id), '[]'::jsonb)
    into v_new from public.deal_assignees a where a.tenant_id = d.tenant_id and a.deal_id = d.id;

  update public.deals set version = version + 1 where id = d.id returning version into v_version;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (d.tenant_id, d.id, 'field_change', 'Assignees updated: ' || v_old::text || ' -> ' || v_new::text);
  return v_version;
end
$$;
revoke all on function public.set_deal_assignees(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_deal_assignees(uuid, integer, jsonb) to authenticated;

create or replace function public.list_deals(
  p_tenant uuid,
  p_stage text,
  p_search text,
  p_limit integer,
  p_offset integer
) returns jsonb
  language plpgsql stable security invoker
  set search_path = ''
as $$
declare
  v_total bigint;
  v_items jsonb;
begin
  if not app.has_permission(p_tenant, 'deal.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_stage is not null and p_stage not in ('sourcing', 'screening', 'due_diligence', 'ic_review', 'signed', 'closed', 'passed') then
    raise exception 'invalid stage' using errcode = '22023';
  end if;
  if p_search is not null and char_length(btrim(p_search)) > 100 then
    raise exception 'search is too long' using errcode = '22023';
  end if;
  if p_limit is null or p_offset is null or p_limit < 1 or p_limit > 100 or p_offset < 0 or p_offset > 10000 then
    raise exception 'invalid pagination' using errcode = '22023';
  end if;

  select count(*) into v_total
  from public.deals d
  where d.tenant_id = p_tenant
    and d.archived_at is null
    and (p_stage is null or d.stage = p_stage)
    and (nullif(btrim(p_search), '') is null or strpos(lower(d.name), lower(btrim(p_search))) > 0);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id,
    'name', page.name,
    'stage', page.stage,
    'version', page.version,
    'sector', page.sector,
    'amount', page.amount,
    'currency', page.currency,
    'expected_close_date', page.expected_close_date,
    'expected_close_time', page.expected_close_time,
    'created_at', page.created_at
  ) order by page.created_at desc, page.id), '[]'::jsonb)
  into v_items
  from (
    select d.id, d.name, d.stage, d.version, d.sector, d.amount::text as amount,
      d.currency, d.expected_close_date, d.expected_close_time, d.created_at
    from public.deals d
    where d.tenant_id = p_tenant
      and d.archived_at is null
      and (p_stage is null or d.stage = p_stage)
      and (nullif(btrim(p_search), '') is null or strpos(lower(d.name), lower(btrim(p_search))) > 0)
    order by d.created_at desc, d.id
    limit p_limit offset p_offset
  ) page;

  return jsonb_build_object('total', v_total, 'items', v_items);
end
$$;
revoke all on function public.list_deals(uuid, text, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_deals(uuid, text, text, integer, integer) to authenticated;
