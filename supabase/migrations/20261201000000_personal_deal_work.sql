-- User-context dashboard: return only active, tenant-scoped deals assigned to the caller.
create function public.list_my_deal_work(p_tenant uuid, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_total bigint;
  v_active_count bigint;
  v_items jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception 'invalid pagination' using errcode = '22023';
  end if;
  if not app.has_permission(p_tenant, 'deal.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select count(*), count(*) filter (where d.stage not in ('closed', 'passed'))
  into v_total, v_active_count
  from public.deals d
  join public.deal_assignees a
    on a.tenant_id = d.tenant_id and a.deal_id = d.id
  where d.tenant_id = p_tenant
    and d.archived_at is null
    and a.user_id = (select app.uid());

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
    'created_at', page.created_at,
    'assignment_role', page.assignment_role
  ) order by page.expected_close_date nulls last, page.created_at desc, page.id), '[]'::jsonb)
  into v_items
  from (
    select d.id, d.name, d.stage, d.version, d.sector, d.amount::text as amount,
      d.currency, d.expected_close_date, d.expected_close_time, d.created_at, a.role as assignment_role
    from public.deals d
    join public.deal_assignees a
      on a.tenant_id = d.tenant_id and a.deal_id = d.id
    where d.tenant_id = p_tenant
      and d.archived_at is null
      and a.user_id = (select app.uid())
    order by d.expected_close_date nulls last, d.created_at desc, d.id
    limit p_limit offset p_offset
  ) page;

  return jsonb_build_object('total', v_total, 'activeCount', v_active_count, 'items', v_items);
end
$$;

revoke all on function public.list_my_deal_work(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_deal_work(uuid, integer, integer) to authenticated;
