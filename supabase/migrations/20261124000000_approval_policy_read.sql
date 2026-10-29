-- Feature 04: expose the current approval policy only to tenant role managers.
create function public.get_approval_policy(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_required integer;
  v_delegation_enabled boolean;
begin
  if p_tenant is null or p_tenant not in (select app.my_tenants())
    or not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select policy.required_approvals, policy.delegation_enabled
    into v_required, v_delegation_enabled
    from public.approval_policies policy where policy.tenant_id = p_tenant;
  return jsonb_build_object(
    'requiredApprovals', v_required,
    'delegationEnabled', coalesce(v_delegation_enabled, false)
  );
end
$$;
revoke all on function public.get_approval_policy(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_approval_policy(uuid) to authenticated;
