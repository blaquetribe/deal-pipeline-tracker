-- Feature 02: tenant names for the switcher, using the caller's RLS-filtered membership set.
create function public.tenant_choices()
  returns table (tenant_id uuid, tenant_name text)
  language sql stable
  set search_path = ''
as $$
  select t.id, t.name
  from public.tenants t
  where t.id in (select app.my_tenants())
  order by t.name, t.id
$$;

revoke all on function public.tenant_choices() from public, anon, authenticated, service_role, api_service;
grant execute on function public.tenant_choices() to authenticated;
