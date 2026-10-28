-- Preserve ledger sequence values exactly through JSON and JavaScript clients.
create or replace function public.deal_activity(
  p_deal uuid,
  p_limit integer default 50,
  p_before_seq bigint default null
) returns jsonb
  language plpgsql stable security invoker
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_events jsonb;
  v_has_more boolean;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid activity limit' using errcode = '22023';
  end if;
  if p_before_seq is not null and p_before_seq < 1 then
    raise exception 'invalid activity cursor' using errcode = '22023';
  end if;

  select d.tenant_id into v_tenant from public.deals d where d.id = p_deal;
  if v_tenant is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;
  if not app.has_permission(v_tenant, 'deal.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'seq', e.seq::text,
      'id', e.id,
      'kind', e.kind,
      'body', e.body,
      'actor_id', e.actor_id,
      'actor_name', e.actor_name,
      'actor_email', e.actor_email,
      'created_at', e.created_at,
      'amends_event_id', e.amends_event_id
    ) order by e.seq desc
  ), '[]'::jsonb)
  into v_events
  from (
    select e.seq, e.id, e.kind, e.body, e.actor_id, e.actor_name, e.actor_email, e.created_at, e.amends_event_id
    from public.deal_events e
    where e.deal_id = p_deal and (p_before_seq is null or e.seq < p_before_seq)
    order by e.seq desc
    limit p_limit
  ) e;

  select count(*) > p_limit into v_has_more
  from (
    select e.seq from public.deal_events e
    where e.deal_id = p_deal and (p_before_seq is null or e.seq < p_before_seq)
    order by e.seq desc
    limit p_limit + 1
  ) e;

  return jsonb_build_object(
    'events', v_events,
    'hasMore', v_has_more,
    'integrityOk', public.verify_ledger(p_deal)
  );
end
$$;
