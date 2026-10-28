-- Keep assignment reads on the authenticated user's JWT so the table's RLS policy remains the authority.
create function public.deal_assignees_for_deal(p_deal uuid)
  returns table (user_id uuid, role text, assigned_at timestamptz)
  language sql stable security invoker
  set search_path = ''
as $$
  select a.user_id, a.role, a.assigned_at
  from public.deal_assignees a
  where a.deal_id = p_deal
  order by a.role, a.user_id
$$;
revoke all on function public.deal_assignees_for_deal(uuid) from public, anon, authenticated, service_role;
grant execute on function public.deal_assignees_for_deal(uuid) to authenticated;
