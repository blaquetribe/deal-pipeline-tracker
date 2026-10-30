-- Feature 05 follow-up: tenant managers can configure closing alerts; alerts include active delegates.
alter table public.tenants
  add column alert_extra_recipients text not null default 'none'
    check (alert_extra_recipients in ('none', 'ic', 'all'));

alter table public.tenants drop constraint tenants_alert_days_valid;
alter table public.tenants add constraint tenants_alert_days_valid check (
  cardinality(alert_days) between 0 and 10 and 0 < all (alert_days) and 365 >= all (alert_days)
);

create function public.get_closing_alert_settings(p_tenant uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_settings jsonb;
begin
  if p_tenant is null or p_tenant not in (select app.my_tenants())
    or not app.has_permission(p_tenant, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'alertDays', t.alert_days,
    'alertOnOverdue', t.alert_on_overdue,
    'extraRecipients', t.alert_extra_recipients
  ) into v_settings from public.tenants t where t.id = p_tenant and t.archived_at is null;
  if v_settings is null then raise exception 'permission denied' using errcode = '42501'; end if;
  return v_settings;
end
$$;
revoke all on function public.get_closing_alert_settings(uuid) from public, anon, service_role;
grant execute on function public.get_closing_alert_settings(uuid) to authenticated;

create function public.update_closing_alert_settings(
  p_tenant uuid, p_alert_days integer[], p_alert_on_overdue boolean, p_extra_recipients text
) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if p_tenant is null or p_tenant not in (select app.my_tenants())
    or not app.has_permission(p_tenant, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_alert_days is null or cardinality(p_alert_days) > 10
    or array_position(p_alert_days, null) is not null
    or exists (select 1 from unnest(p_alert_days) threshold where threshold not between 1 and 365)
    or cardinality(p_alert_days) <> (select count(distinct threshold) from unnest(p_alert_days) threshold)
    or p_alert_on_overdue is null or p_extra_recipients is null
    or p_extra_recipients not in ('none', 'ic', 'all') then
    raise exception 'invalid alert preferences' using errcode = '22023';
  end if;

  update public.tenants set
    alert_days = p_alert_days,
    alert_on_overdue = p_alert_on_overdue,
    alert_extra_recipients = p_extra_recipients
    where id = p_tenant and archived_at is null;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  perform app.record_tenant_event(p_tenant, 'settings_changed', null,
    format('Closing alert settings updated: thresholds=%s overdue=%s extra_recipients=%s',
      array_to_string(p_alert_days, ','), p_alert_on_overdue, p_extra_recipients));
end
$$;
revoke all on function public.update_closing_alert_settings(uuid, integer[], boolean, text)
  from public, anon, service_role;
grant execute on function public.update_closing_alert_settings(uuid, integer[], boolean, text) to authenticated;

create function app.closing_alert_recipients(
  p_tenant uuid, p_deal uuid, p_now timestamptz, p_extra_recipients text
) returns uuid[]
  language sql stable security definer set search_path = '' as $$
  with active_assignees as (
    select m.id as membership_id, m.user_id
    from public.deal_assignees a
    join public.memberships m on m.tenant_id = a.tenant_id and m.user_id = a.user_id
    where a.tenant_id = p_tenant and a.deal_id = p_deal and m.deactivated_at is null
  ), base_recipients as (
    select user_id from active_assignees
    union
    select fallback.user_id
    from public.memberships fallback
    join public.membership_roles mr on mr.tenant_id = fallback.tenant_id and mr.membership_id = fallback.id
    join public.roles r on r.tenant_id = mr.tenant_id and r.id = mr.role_id
    where fallback.tenant_id = p_tenant and fallback.deactivated_at is null
      and r.key in ('owner', 'admin')
      and not exists (select 1 from active_assignees)
  ), delegate_recipients as (
    select delegate.user_id
    from active_assignees assigned
    join public.memberships principal on principal.tenant_id = p_tenant
      and principal.id = assigned.membership_id and principal.deactivated_at is null
    join public.approval_delegations delegation on delegation.tenant_id = p_tenant
      and delegation.delegator_membership_id = principal.id
    join public.approval_policies policy on policy.tenant_id = p_tenant and policy.delegation_enabled
    join public.memberships delegate on delegate.tenant_id = p_tenant
      and delegate.id = delegation.delegate_membership_id and delegate.deactivated_at is null
    where delegation.cancelled_at is null and delegation.starts_at <= p_now and delegation.ends_at > p_now
      and exists (select 1 from public.membership_roles principal_role
        join public.role_permissions principal_permission
          on principal_permission.tenant_id = principal_role.tenant_id
          and principal_permission.role_id = principal_role.role_id
        where principal_role.tenant_id = p_tenant and principal_role.membership_id = principal.id
          and principal_permission.permission = 'approval.decide')
      and exists (select 1 from public.membership_roles delegate_role
        join public.role_permissions delegate_permission
          on delegate_permission.tenant_id = delegate_role.tenant_id
          and delegate_permission.role_id = delegate_role.role_id
        where delegate_role.tenant_id = p_tenant and delegate_role.membership_id = delegate.id
          and delegate_permission.permission = 'approval.decide')
      and not exists (select 1 from public.membership_roles conflict_role
        join public.role_permissions conflict_permission
          on conflict_permission.tenant_id = conflict_role.tenant_id
          and conflict_permission.role_id = conflict_role.role_id
        where conflict_role.tenant_id = p_tenant and conflict_role.membership_id = delegate.id
          and conflict_permission.permission in ('deal.request_approval', 'member.manage', 'role.manage'))
      and not exists (select 1 from public.approval_absences absence
        where absence.tenant_id = p_tenant and absence.membership_id = delegate.id
          and absence.cancelled_at is null and absence.starts_at <= p_now and absence.ends_at > p_now)
  ), extra_recipients as (
    select m.user_id from public.memberships m
    where m.tenant_id = p_tenant and m.deactivated_at is null and p_extra_recipients = 'all'
    union
    select m.user_id from public.memberships m
    where m.tenant_id = p_tenant and m.deactivated_at is null and p_extra_recipients = 'ic'
      and exists (select 1 from public.membership_roles mr
        join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
        where mr.tenant_id = p_tenant and mr.membership_id = m.id and rp.permission = 'approval.decide')
  )
  select coalesce(array_agg(distinct recipients.user_id order by recipients.user_id), '{}'::uuid[])
  from (
    select user_id from base_recipients
    union select user_id from delegate_recipients
    union select user_id from extra_recipients
  ) recipients
$$;
revoke all on function app.closing_alert_recipients(uuid, uuid, timestamptz, text) from public;

create or replace function public.scan_closing_soon(p_now timestamptz default now()) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  d record;
  v_today date;
  v_close_at timestamptz;
  v_rule text;
  v_key text;
  v_threshold integer;
  v_recipients uuid[];
  v_inserted integer;
  v_total integer := 0;
  v_payload jsonb;
  v_not_before timestamptz;
begin
  if p_now is null then raise exception 'scan time is required' using errcode = '22004'; end if;
  for d in
    select deal.id, deal.tenant_id, deal.name, deal.stage, deal.amount, deal.currency,
      deal.expected_close_date, deal.expected_close_time, tenant.timezone, tenant.alert_days,
      tenant.alert_on_overdue, tenant.alert_extra_recipients
    from public.deals deal join public.tenants tenant on tenant.id = deal.tenant_id
    where deal.archived_at is null and deal.stage not in ('closed', 'passed')
      and deal.expected_close_date is not null and tenant.archived_at is null
    for update of deal skip locked
  loop
    v_today := p_now at time zone d.timezone;
    v_close_at := case when d.expected_close_time is null
      then (d.expected_close_date + 1)::timestamp at time zone d.timezone
      else (d.expected_close_date + d.expected_close_time) at time zone d.timezone end;
    v_recipients := app.closing_alert_recipients(d.tenant_id, d.id, p_now, d.alert_extra_recipients);
    if cardinality(v_recipients) = 0 then continue; end if;

    for v_threshold in select unnest(d.alert_days) loop
      if v_today < d.expected_close_date - v_threshold then continue; end if;
      v_rule := case v_threshold when 5 then 'd5' when 1 then 'd1' else 'd' || v_threshold::text end;
      v_key := 'closing:' || d.id::text || ':' || d.expected_close_date::text || ':' || v_rule;
      v_payload := jsonb_build_object('dealId', d.id, 'dealName', d.name, 'stage', d.stage,
        'amount', d.amount::text, 'currency', d.currency, 'closeDate', d.expected_close_date,
        'closeTime', d.expected_close_time, 'timeZone', d.timezone, 'thresholdDays', v_threshold,
        'href', '/deals/' || d.id::text);
      v_not_before := case
        when (p_now at time zone d.timezone)::time < time '07:00'
          then (((p_now at time zone d.timezone)::date + time '07:00') at time zone d.timezone)
        else p_now
      end;
      with created as (
        insert into public.notifications (tenant_id, user_id, kind, deal_id, dedupe_key, payload)
          select d.tenant_id, recipient, 'closing_soon', d.id, v_key || ':' || recipient::text, v_payload
          from unnest(v_recipients) recipient
          on conflict (dedupe_key) do nothing returning id, user_id
      ), queued as (
        insert into public.email_outbox (tenant_id, user_id, deal_id, notification_id, kind, payload, not_before)
          select d.tenant_id, created.user_id, d.id, created.id, 'closing_soon_digest', v_payload, v_not_before
          from created returning notification_id
      ) select count(*) into v_inserted from created;
      if v_inserted > 0 then
        insert into public.deal_events (tenant_id, deal_id, kind, body)
          values (d.tenant_id, d.id, 'closing_soon_alert', jsonb_build_object(
            'thresholdDays', v_threshold, 'recipients', to_jsonb(v_recipients), 'closeDate', d.expected_close_date
          )::text);
        v_total := v_total + v_inserted;
      end if;
    end loop;

    if d.alert_on_overdue and p_now >= v_close_at then
      v_key := 'closing:' || d.id::text || ':' || d.expected_close_date::text || ':' ||
        coalesce(d.expected_close_time::text, 'midnight') || ':overdue';
      v_payload := jsonb_build_object('dealId', d.id, 'dealName', d.name, 'stage', d.stage,
        'amount', d.amount::text, 'currency', d.currency, 'closeDate', d.expected_close_date,
        'closeTime', d.expected_close_time, 'timeZone', d.timezone, 'overdue', true,
        'href', '/deals/' || d.id::text);
      v_not_before := case
        when (p_now at time zone d.timezone)::time < time '07:00'
          then (((p_now at time zone d.timezone)::date + time '07:00') at time zone d.timezone)
        else p_now
      end;
      with created as (
        insert into public.notifications (tenant_id, user_id, kind, deal_id, dedupe_key, payload)
          select d.tenant_id, recipient, 'closing_soon', d.id, v_key || ':' || recipient::text, v_payload
          from unnest(v_recipients) recipient
          on conflict (dedupe_key) do nothing returning id, user_id
      ), queued as (
        insert into public.email_outbox (tenant_id, user_id, deal_id, notification_id, kind, payload, not_before)
          select d.tenant_id, created.user_id, d.id, created.id, 'closing_soon_digest', v_payload, v_not_before
          from created returning notification_id
      ) select count(*) into v_inserted from created;
      if v_inserted > 0 then
        insert into public.deal_events (tenant_id, deal_id, kind, body)
          values (d.tenant_id, d.id, 'closing_soon_alert', jsonb_build_object(
            'overdue', true, 'recipients', to_jsonb(v_recipients), 'closeDate', d.expected_close_date
          )::text);
        v_total := v_total + v_inserted;
      end if;
    end if;
  end loop;
  return v_total;
end
$$;
revoke all on function public.scan_closing_soon(timestamptz) from public, anon, authenticated, service_role;
