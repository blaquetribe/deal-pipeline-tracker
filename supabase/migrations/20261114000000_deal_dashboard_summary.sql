-- Tenant-local dashboard summary and closing dates, computed from the database clock.
create function public.deal_dashboard_summary(p_tenant uuid) returns jsonb
  language plpgsql stable security invoker
  set search_path = ''
as $$
declare
  v_timezone text;
  v_window integer;
  v_now timestamptz := statement_timestamp();
  v_today date;
  v_next_midnight timestamptz;
  v_pipeline jsonb;
  v_totals jsonb;
  v_closing jsonb;
  v_closing_count bigint;
begin
  if not app.has_permission(p_tenant, 'deal.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select t.timezone, t.closing_soon_days into v_timezone, v_window
  from public.tenants t where t.id = p_tenant;
  if v_timezone is null or v_window is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  v_today := (v_now at time zone v_timezone)::date;
  v_next_midnight := ((v_today + 1)::timestamp at time zone v_timezone);

  select coalesce(jsonb_agg(jsonb_build_object('stage', stages.stage, 'count', stages.deal_count)
    order by stages.ordinal), '[]'::jsonb)
  into v_pipeline
  from (
    select s.stage, s.ordinal, count(d.id)::integer as deal_count
    from (values
      ('sourcing', 1), ('screening', 2), ('due_diligence', 3), ('ic_review', 4),
      ('signed', 5), ('closed', 6), ('passed', 7)
    ) s(stage, ordinal)
    left join public.deals d on d.tenant_id = p_tenant and d.archived_at is null and d.stage = s.stage
    group by s.stage, s.ordinal
  ) stages;

  select coalesce(jsonb_agg(jsonb_build_object('currency', totals.currency, 'amount', totals.amount)
    order by totals.currency), '[]'::jsonb)
  into v_totals
  from (
    select d.currency, sum(coalesce(d.amount, 0))::text as amount
    from public.deals d
    where d.tenant_id = p_tenant and d.archived_at is null and d.stage not in ('closed', 'passed')
    group by d.currency
  ) totals;

  select count(*) into v_closing_count
  from public.deals d
  where d.tenant_id = p_tenant and d.archived_at is null
    and d.stage not in ('closed', 'passed')
    and d.expected_close_date is not null
    and d.expected_close_date <= v_today + v_window;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id,
    'name', item.name,
    'stage', item.stage,
    'amount', item.amount,
    'currency', item.currency,
    'expectedCloseDate', item.expected_close_date,
    'expectedCloseTime', item.expected_close_time,
    'closesInDays', item.expected_close_date - v_today,
    'closesAt', item.closes_at
  ) order by item.priority, item.expected_close_date desc, item.name), '[]'::jsonb)
  into v_closing
  from (
    select d.id, d.name, d.stage, d.amount::text as amount, d.currency,
      d.expected_close_date, d.expected_close_time,
      case when d.expected_close_time is null then null
        else ((d.expected_close_date + d.expected_close_time) at time zone v_timezone)
      end as closes_at,
      greatest(d.expected_close_date - v_today, 0) as priority
    from public.deals d
    where d.tenant_id = p_tenant and d.archived_at is null
      and d.stage not in ('closed', 'passed')
      and d.expected_close_date is not null
      and d.expected_close_date <= v_today + v_window
    order by greatest(d.expected_close_date - v_today, 0), d.expected_close_date desc, d.name
    limit 10
  ) item;

  return jsonb_build_object(
    'serverNow', v_now,
    'nextMidnightAt', v_next_midnight,
    'timeZone', v_timezone,
    'windowDays', v_window,
    'pipelineByStage', v_pipeline,
    'totalsByCurrency', v_totals,
    'closingSoonCount', v_closing_count,
    'closingSoon', v_closing
  );
end
$$;
revoke all on function public.deal_dashboard_summary(uuid) from public, anon, authenticated, service_role;
grant execute on function public.deal_dashboard_summary(uuid) to authenticated;
