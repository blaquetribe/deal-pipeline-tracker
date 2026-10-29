-- Feature 06: idempotent, fictional development data. User accounts are created through GoTrue
-- by the internal API seed job; the database function only accepts the server-only api_service role.
create function public.seed_demo_data() returns jsonb
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_user record;
  v_tenant record;
  v_member record;
  v_sample record;
  v_membership uuid;
  v_role uuid;
  v_deal uuid;
  v_version integer;
  v_role_count integer;
  v_stage text;
  v_inserted integer := 0;
  v_tenants integer := 0;
begin
  for v_user in
    select * from (values
      ('d0000000-0000-4000-8000-000000000001'::uuid, 'owner@asteron.example.test'),
      ('d0000000-0000-4000-8000-000000000002'::uuid, 'admin@asteron.example.test'),
      ('d0000000-0000-4000-8000-000000000003'::uuid, 'lead@asteron.example.test'),
      ('d0000000-0000-4000-8000-000000000004'::uuid, 'member@asteron.example.test'),
      ('d0000000-0000-4000-8000-000000000005'::uuid, 'ic@asteron.example.test'),
      ('d0000000-0000-4000-8000-000000000006'::uuid, 'observer@asteron.example.test'),
      ('d0000000-0000-4000-8000-000000000007'::uuid, 'owner@imbali.example.test'),
      ('d0000000-0000-4000-8000-000000000008'::uuid, 'admin@imbali.example.test'),
      ('d0000000-0000-4000-8000-000000000009'::uuid, 'lead@imbali.example.test'),
      ('d0000000-0000-4000-8000-000000000010'::uuid, 'member@imbali.example.test'),
      ('d0000000-0000-4000-8000-000000000011'::uuid, 'ic@imbali.example.test'),
      ('d0000000-0000-4000-8000-000000000012'::uuid, 'observer@imbali.example.test')
    ) as users(user_id, email)
  loop
    if not exists (
      select 1 from auth.users u
      where u.id = v_user.user_id and lower(u.email) = v_user.email and u.email_confirmed_at is not null
    ) then
      raise exception 'development seed account is missing or unverified';
    end if;
  end loop;

  for v_tenant in
    select * from (values
      ('d1000000-0000-4000-8000-000000000001'::uuid, 'Asteron Capital', 'd0000000-0000-4000-8000-000000000001'::uuid),
      ('d1000000-0000-4000-8000-000000000002'::uuid, 'Imbali Growth Partners', 'd0000000-0000-4000-8000-000000000007'::uuid)
    ) as tenants(tenant_id, name, owner_id)
  loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tenant.owner_id)::text, true);
    insert into public.tenants (id, name) values (v_tenant.tenant_id, v_tenant.name)
      on conflict (id) do nothing;
    if not found then
      if not exists (
        select 1 from public.tenants t where t.id = v_tenant.tenant_id and t.name = v_tenant.name
      ) then
        raise exception 'development seed tenant id conflicts with existing data';
      end if;
    else
      v_tenants := v_tenants + 1;
      perform app.record_tenant_event(v_tenant.tenant_id, 'tenant_created', null, 'Development sample tenant');
    end if;

    select count(*) into v_role_count from public.roles r where r.tenant_id = v_tenant.tenant_id;
    if v_role_count = 0 then
      perform app.seed_system_roles(v_tenant.tenant_id);
    elsif v_role_count <> 6 then
      raise exception 'development seed tenant has an incomplete role catalogue';
    end if;

    for v_member in
      select * from (values
        ('d0000000-0000-4000-8000-000000000001'::uuid, 'owner', 'Amara Ndlovu', 'Investment Director'),
        ('d0000000-0000-4000-8000-000000000002'::uuid, 'admin', 'Thabo Maseko', 'Operations Manager'),
        ('d0000000-0000-4000-8000-000000000003'::uuid, 'deal_lead', 'Lerato Molefe', 'Principal'),
        ('d0000000-0000-4000-8000-000000000004'::uuid, 'deal_member', 'Sibusiso Dlamini', 'Associate'),
        ('d0000000-0000-4000-8000-000000000005'::uuid, 'ic_member', 'Naledi Khumalo', 'Investment Committee'),
        ('d0000000-0000-4000-8000-000000000006'::uuid, 'observer_compliance', 'Mandla Zulu', 'Compliance'),
        ('d0000000-0000-4000-8000-000000000007'::uuid, 'owner', 'Zanele Mbeki', 'Investment Director'),
        ('d0000000-0000-4000-8000-000000000008'::uuid, 'admin', 'Pieter Jacobs', 'Operations Manager'),
        ('d0000000-0000-4000-8000-000000000009'::uuid, 'deal_lead', 'Ayanda Nkosi', 'Principal'),
        ('d0000000-0000-4000-8000-000000000010'::uuid, 'deal_member', 'Nandi Botha', 'Associate'),
        ('d0000000-0000-4000-8000-000000000011'::uuid, 'ic_member', 'Karabo Dube', 'Investment Committee'),
        ('d0000000-0000-4000-8000-000000000012'::uuid, 'observer_compliance', 'Mpho van der Merwe', 'Compliance')
      ) as members(user_id, role_key, display_name, job_title)
      where (v_tenant.tenant_id = 'd1000000-0000-4000-8000-000000000001'::uuid and members.user_id between 'd0000000-0000-4000-8000-000000000001'::uuid and 'd0000000-0000-4000-8000-000000000006'::uuid)
         or (v_tenant.tenant_id = 'd1000000-0000-4000-8000-000000000002'::uuid and members.user_id between 'd0000000-0000-4000-8000-000000000007'::uuid and 'd0000000-0000-4000-8000-000000000012'::uuid)
    loop
      insert into public.memberships (tenant_id, user_id)
        values (v_tenant.tenant_id, v_member.user_id)
        on conflict (tenant_id, user_id) do nothing;
      select m.id into v_membership from public.memberships m
        where m.tenant_id = v_tenant.tenant_id and m.user_id = v_member.user_id;
      select r.id into v_role from public.roles r
        where r.tenant_id = v_tenant.tenant_id and r.key = v_member.role_key;

      insert into public.membership_roles (tenant_id, membership_id, role_id)
        values (v_tenant.tenant_id, v_membership, v_role)
        on conflict (membership_id, role_id) do nothing;
      if found then
        perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tenant.owner_id)::text, true);
        perform app.record_tenant_event(v_tenant.tenant_id, 'role_granted', v_member.user_id, v_member.role_key);
      end if;

      perform set_config('request.jwt.claims', jsonb_build_object('sub', v_member.user_id)::text, true);
      perform public.profile_upsert(v_member.display_name, v_member.job_title);
    end loop;

    for v_sample in
      select * from (values
        ('Asterion Renewable Storage', 'Energy', 27500000000::bigint, 4, 'screening', 'Commercial-scale battery storage platform.'),
        ('Umzi Diagnostics Network', 'Healthcare', 9500000000::bigint, 24, 'due_diligence', 'Regional diagnostics network with recurring contracts.'),
        ('Karoo Cold Chain', 'Logistics', 16000000000::bigint, 45, 'ic_review', 'Temperature-controlled logistics expansion.'),
        ('Nala Data Systems', 'Technology', 8200000000::bigint, -4, 'passed', 'Passed: outside the current investment mandate.'),
        ('Ubuntu Water Reuse', 'Infrastructure', 31000000000::bigint, 60, 'sourcing', 'Industrial water reuse and treatment assets.'),
        ('Moya Foods Cooperative', 'Consumer', 5500000000::bigint, 20, 'screening', 'Branded staple foods with national distribution.'),
        ('Lumen Solar Services', 'Energy', 18500000000::bigint, 15, 'due_diligence', 'Distributed solar operations and maintenance.'),
        ('Cedar Medical Network', 'Healthcare', 12000000000::bigint, 40, 'ic_review', 'Outpatient clinics with a regional growth plan.'),
        ('Kgalagadi Microgrid', 'Energy', 29000000000::bigint, 75, 'sourcing', 'Commercial microgrids for remote industrial sites.'),
        ('Vela Payments Platform', 'Financial Services', 8800000000::bigint, -3, 'passed', 'Passed: unit economics did not meet the hurdle.')
      ) as samples(name, sector, amount, close_days, target_stage, note)
    loop
      if v_tenant.tenant_id = 'd1000000-0000-4000-8000-000000000001'::uuid
         and v_sample.name not in ('Asterion Renewable Storage', 'Umzi Diagnostics Network', 'Karoo Cold Chain', 'Nala Data Systems', 'Ubuntu Water Reuse') then
        continue;
      end if;
      if v_tenant.tenant_id = 'd1000000-0000-4000-8000-000000000002'::uuid
         and v_sample.name not in ('Moya Foods Cooperative', 'Lumen Solar Services', 'Cedar Medical Network', 'Kgalagadi Microgrid', 'Vela Payments Platform') then
        continue;
      end if;

      perform set_config('request.jwt.claims', jsonb_build_object('sub', v_tenant.owner_id)::text, true);
      select d.id, d.version, d.stage into v_deal, v_version, v_stage
        from public.deals d where d.tenant_id = v_tenant.tenant_id and d.name = v_sample.name
        order by d.created_at limit 1;
      if not found then
        v_deal := public.create_deal(
          v_tenant.tenant_id,
          v_sample.name,
          v_sample.sector,
          v_sample.amount,
          'ZAR',
          current_date + v_sample.close_days
        );
        v_inserted := v_inserted + 1;
        v_version := 1;
        perform public.set_deal_assignees(v_deal, v_version, jsonb_build_array(
          jsonb_build_object('user_id', v_tenant.owner_id, 'role', 'owner'),
          jsonb_build_object('user_id', case when v_tenant.tenant_id = 'd1000000-0000-4000-8000-000000000001'::uuid then 'd0000000-0000-4000-8000-000000000003'::uuid else 'd0000000-0000-4000-8000-000000000009'::uuid end, 'role', 'lead'),
          jsonb_build_object('user_id', case when v_tenant.tenant_id = 'd1000000-0000-4000-8000-000000000001'::uuid then 'd0000000-0000-4000-8000-000000000004'::uuid else 'd0000000-0000-4000-8000-000000000010'::uuid end, 'role', 'member')
        ));
        v_version := v_version + 1;

        if v_sample.target_stage in ('screening', 'due_diligence', 'ic_review') then
          perform public.move_stage(v_deal, 'screening', v_version, 'Seeded demonstration data');
          v_version := v_version + 1;
        end if;
        if v_sample.target_stage in ('due_diligence', 'ic_review') then
          perform public.move_stage(v_deal, 'due_diligence', v_version, 'Seeded demonstration data');
          v_version := v_version + 1;
        end if;
        if v_sample.target_stage = 'ic_review' then
          perform public.move_stage(v_deal, 'ic_review', v_version, 'Seeded demonstration data');
        elsif v_sample.target_stage = 'passed' then
          perform public.move_stage(v_deal, 'passed', v_version, v_sample.note);
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('tenants', 2, 'roles', 12, 'deals_created', v_inserted);
end
$$;

revoke all on function public.seed_demo_data() from public, anon, authenticated, service_role;
grant execute on function public.seed_demo_data() to api_service;
