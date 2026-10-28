-- Feature 03: SQL NULL must not bypass optimistic version checks on stage and field updates.
-- The functions stay SECURITY DEFINER and retain the original authorization and write paths.

create or replace function public.move_stage(p_deal uuid, p_to text, p_expected_version integer, p_reason text default null)
  returns integer
  language plpgsql security definer
  set search_path = ''
as $$
declare
  d public.deals;
  v_missing text;
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
  if p_expected_version is null or d.version <> p_expected_version then
    raise exception 'stale version' using errcode = 'DP409';
  end if;
  if not exists (select 1 from public.stage_transitions t where t.from_stage = d.stage and t.to_stage = p_to) then
    raise exception 'transition not allowed' using errcode = 'DP422';
  end if;

  select string_agg(r.field, ', ' order by r.field) into v_missing
    from public.stage_requirements r
    where r.stage = p_to and to_jsonb(d) ->> r.field is null;
  if v_missing is not null then
    raise exception 'missing required fields: %', v_missing using errcode = 'DP422';
  end if;

  update public.deals set stage = p_to, version = version + 1 where id = d.id returning version into v_version;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (d.tenant_id, d.id, 'stage_change',
            d.stage || ' -> ' || p_to || case when nullif(p_reason, '') is not null then ': ' || p_reason else '' end);
  return v_version;
end
$$;
revoke all on function public.move_stage(uuid, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.move_stage(uuid, text, integer, text) to authenticated;

create or replace function public.update_deal(p_deal uuid, p_expected_version integer, p_changes jsonb) returns integer
  language plpgsql security definer
  set search_path = ''
as $$
declare
  d public.deals;
  v_key text;
  v_missing text;
  v_version integer;
  v_summary text;
  v_amount bigint;
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
  if p_expected_version is null or d.version <> p_expected_version then
    raise exception 'stale version' using errcode = 'DP409';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'no changes' using errcode = '22023';
  end if;
  select k into v_key from jsonb_object_keys(p_changes) as k
    where k not in ('name', 'sector', 'amount', 'currency', 'expected_close_date', 'expected_close_time')
    order by k limit 1;
  if v_key is not null then
    raise exception 'unsupported field: %', v_key using errcode = '22023';
  end if;

  if p_changes ? 'amount' and jsonb_typeof(p_changes -> 'amount') <> 'null' then
    if jsonb_typeof(p_changes -> 'amount') <> 'string' or (p_changes ->> 'amount') !~ '^-?[0-9]{1,18}$' then
      raise exception 'invalid amount' using errcode = '22023';
    end if;
    v_amount := (p_changes ->> 'amount')::bigint;
  end if;

  select string_agg(
           c.key || ': ' || coalesce(to_jsonb(d) ->> c.key, '(none)') || ' -> ' || coalesce(c.value #>> '{}', '(none)'),
           ', ' order by c.key)
    into v_summary from jsonb_each(p_changes) as c;

  update public.deals set
    name = case when p_changes ? 'name' then p_changes ->> 'name' else name end,
    sector = case when p_changes ? 'sector' then p_changes ->> 'sector' else sector end,
    amount = case when p_changes ? 'amount' then v_amount else amount end,
    currency = case when p_changes ? 'currency' then p_changes ->> 'currency' else currency end,
    expected_close_date = case when p_changes ? 'expected_close_date' then (p_changes ->> 'expected_close_date')::date else expected_close_date end,
    expected_close_time = case when p_changes ? 'expected_close_time' then (p_changes ->> 'expected_close_time')::time else expected_close_time end,
    version = version + 1
  where id = d.id
  returning * into d;

  select string_agg(r.field, ', ' order by r.field) into v_missing
    from public.stage_requirements r
    where r.stage = d.stage and to_jsonb(d) ->> r.field is null;
  if v_missing is not null then
    raise exception 'missing required fields: %', v_missing using errcode = 'DP422';
  end if;

  v_version := d.version;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (d.tenant_id, d.id, 'field_change', 'Updated: ' || v_summary);
  return v_version;
end
$$;
revoke all on function public.update_deal(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_deal(uuid, integer, jsonb) to authenticated;
