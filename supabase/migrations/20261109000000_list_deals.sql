-- Server-side deal list contract: tenant filtering, stage/search, bounded pagination, exact money.
create function public.list_deals(
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
  if p_limit < 1 or p_limit > 100 or p_offset < 0 or p_offset > 10000 then
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
