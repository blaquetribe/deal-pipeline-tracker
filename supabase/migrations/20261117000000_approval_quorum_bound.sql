-- Feature 04, slice 1: keep quorum bounds enforced at the database boundary as well as in zod.
alter table public.approval_policies
  add constraint approval_policies_quorum_bound check (required_approvals between 1 and 50);
alter table public.approval_requests
  add constraint approval_requests_quorum_bound check (required_approvals between 1 and 50);

create or replace function public.configure_approval_policy(p_tenant uuid, p_required_approvals integer) returns void
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if p_required_approvals is null or p_required_approvals not between 1 and 50 then
    raise exception 'invalid approval quorum' using errcode = '22023';
  end if;
  if not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into public.approval_policies (tenant_id, required_approvals)
    values (p_tenant, p_required_approvals)
  on conflict (tenant_id) do update set
    required_approvals = excluded.required_approvals,
    updated_at = now();
end
$$;
revoke all on function public.configure_approval_policy(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.configure_approval_policy(uuid, integer) to authenticated;
