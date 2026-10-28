-- Feature 05: private notification feed and the idempotent closing-soon scan (ADR 0011).
-- The browser may read its own rows through RLS. Inserts and read-state changes stay in functions.

alter table public.deal_events
  add column actor_kind text not null default 'user' check (actor_kind in ('user', 'system')),
  alter column actor_id drop not null;
alter table public.deal_events add constraint deal_events_actor_kind_valid check (
  (actor_kind = 'user' and actor_id is not null) or (actor_kind = 'system' and actor_id is null and actor_email = 'system')
);

create or replace function app.event_hash(e public.deal_events) returns text
  language sql immutable
  set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_array(
    e.prev_hash, e.id, e.tenant_id, e.deal_id, e.kind, e.body, e.actor_id, e.actor_email, e.actor_name,
    to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), e.amends_event_id
  )::text, 'UTF8'), 'sha256'), 'hex')
$$;
revoke all on function app.event_hash(public.deal_events) from public;
grant execute on function app.event_hash(public.deal_events) to authenticated;

create or replace function app.deal_events_before_insert() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_actor uuid := app.uid();
  v_prev text;
begin
  if v_actor is null then
    -- Only the database-owned scheduled scan can create a system event. API roles cannot call it.
    if current_user <> 'postgres' or new.kind <> 'closing_soon_alert' then
      raise exception 'no authenticated user' using errcode = '42501';
    end if;
    new.actor_kind := 'system';
    new.actor_id := null;
    new.actor_email := 'system';
    new.actor_name := 'System';
  else
    select u.email, nullif(u.raw_user_meta_data ->> 'full_name', '')
      into new.actor_email, new.actor_name from auth.users u where u.id = v_actor;
    if new.actor_email is null then
      raise exception 'unknown actor' using errcode = '42501';
    end if;
    new.actor_kind := 'user';
    new.actor_id := v_actor;
  end if;

  perform 1 from public.deals d where d.id = new.deal_id and d.tenant_id = new.tenant_id for update;
  select e.hash into v_prev from public.deal_events e
    where e.deal_id = new.deal_id order by e.seq desc limit 1;
  new.created_at := now();
  new.prev_hash := v_prev;
  new.hash := app.event_hash(new);
  return new;
end
$$;
revoke all on function app.deal_events_before_insert() from public;

-- Keep event kinds constrained while permitting the database-generated alert.
alter table public.deal_events drop constraint deal_events_kind_check;
alter table public.deal_events add constraint deal_events_kind_check
  check (kind in ('note', 'field_change', 'stage_change', 'decision', 'approval_decision', 'correction', 'closing_soon_alert'));

alter table public.tenants add column alert_days integer[] not null default array[5, 1]::integer[];
alter table public.tenants add column alert_on_overdue boolean not null default true;
alter table public.tenants add constraint tenants_alert_days_valid check (
  cardinality(alert_days) between 1 and 10 and 0 < all (alert_days) and 365 >= all (alert_days)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  kind text not null check (kind = 'closing_soon'),
  deal_id uuid not null,
  dedupe_key text not null unique,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key (tenant_id, user_id) references public.memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete restrict,
  unique (tenant_id, user_id, id)
);
create index notifications_recipient_unread_idx on public.notifications (tenant_id, user_id, created_at desc) where read_at is null;
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
create policy notifications_recipient_select on public.notifications
  for select to authenticated
  using (user_id = (select app.uid()) and tenant_id in (select app.my_tenants()));
revoke all on public.notifications from public, anon, authenticated, service_role;
grant select on public.notifications to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  deal_id uuid not null,
  notification_id uuid not null unique references public.notifications (id) on delete restrict,
  kind text not null check (kind = 'closing_soon_digest'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  not_before timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'cancelled', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (tenant_id, user_id) references public.memberships (tenant_id, user_id) on delete restrict,
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete restrict
);
create index email_outbox_queued_idx on public.email_outbox (not_before, created_at)
  where status = 'queued' or status = 'sending';
alter table public.email_outbox enable row level security;
alter table public.email_outbox force row level security;
revoke all on public.email_outbox from public, anon, authenticated, service_role;

create function app.cancel_closing_soon_email() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if new.stage in ('closed', 'passed') and old.stage is distinct from new.stage then
    update public.email_outbox set status = 'cancelled', claimed_at = null
      where tenant_id = new.tenant_id and deal_id = new.id and status = 'queued';
  end if;
  return new;
end
$$;
revoke all on function app.cancel_closing_soon_email() from public;
create trigger deals_cancel_closing_soon_email
  after update of stage on public.deals
  for each row execute function app.cancel_closing_soon_email();

create function app.cancel_deactivated_member_email() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if old.deactivated_at is null and new.deactivated_at is not null then
    update public.email_outbox set status = 'cancelled', claimed_at = null
      where tenant_id = new.tenant_id and user_id = new.user_id and status = 'queued';
  end if;
  return new;
end
$$;
revoke all on function app.cancel_deactivated_member_email() from public;
create trigger memberships_cancel_closing_soon_email
  after update of deactivated_at on public.memberships
  for each row execute function app.cancel_deactivated_member_email();

create function public.claim_closing_soon_emails(p_limit integer default 100)
  returns table (id uuid, tenant_id uuid, user_id uuid, recipient_email text, payload jsonb)
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid email batch limit' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select o.id from public.email_outbox o
    where ((o.status = 'queued' and o.not_before <= now())
       or (o.status = 'sending' and o.claimed_at < now() - interval '10 minutes'))
      and exists (
        select 1 from public.memberships m
        where m.tenant_id = o.tenant_id and m.user_id = o.user_id and m.deactivated_at is null
      )
      and exists (select 1 from auth.users u where u.id = o.user_id and u.email is not null)
    order by o.not_before, o.created_at
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.email_outbox o set status = 'sending', claimed_at = now(), attempts = attempts + 1
      from candidates c where o.id = c.id
      returning o.id, o.tenant_id, o.user_id, o.payload
  )
  select c.id, c.tenant_id, c.user_id, u.email::text, c.payload
    from claimed c join auth.users u on u.id = c.user_id where u.email is not null;
end
$$;
revoke all on function public.claim_closing_soon_emails(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_closing_soon_emails(integer) to api_service;

create function public.complete_closing_soon_emails(p_ids uuid[], p_sent boolean) returns integer
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > 200 or p_sent is null then
    raise exception 'invalid email completion request' using errcode = '22023';
  end if;
  update public.email_outbox set
    status = case when p_sent then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
    sent_at = case when p_sent then now() else sent_at end,
    not_before = case when p_sent or attempts >= 5 then not_before else now() + interval '5 minutes' end,
    claimed_at = null
  where id = any(p_ids) and status = 'sending';
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.complete_closing_soon_emails(uuid[], boolean) from public, anon, authenticated, service_role;
grant execute on function public.complete_closing_soon_emails(uuid[], boolean) to api_service;

create function public.mark_notification_read(p_notification uuid) returns boolean
  language plpgsql security definer
  set search_path = ''
as $$
begin
  update public.notifications set read_at = coalesce(read_at, now())
    where id = p_notification and user_id = app.uid() and tenant_id in (select app.my_tenants());
  if not found then
    raise exception 'notification not found' using errcode = 'P0002';
  end if;
  return true;
end
$$;
revoke all on function public.mark_notification_read(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create function public.list_notifications(p_tenant uuid, p_limit integer default 20)
  returns table (id uuid, kind text, payload jsonb, created_at timestamptz, read_at timestamptz)
  language plpgsql stable security invoker
  set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid notification limit' using errcode = '22023';
  end if;
  if p_tenant is null or not exists (select 1 from app.my_tenants() t where t = p_tenant) then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  return query select n.id, n.kind, n.payload, n.created_at, n.read_at
    from public.notifications n where n.tenant_id = p_tenant and n.user_id = app.uid()
    order by n.created_at desc, n.id desc limit p_limit;
end
$$;
revoke all on function public.list_notifications(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_notifications(uuid, integer) to authenticated;

create function public.scan_closing_soon(p_now timestamptz default now()) returns integer
  language plpgsql security definer
  set search_path = ''
as $$
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
      tenant.alert_on_overdue
    from public.deals deal join public.tenants tenant on tenant.id = deal.tenant_id
    where deal.archived_at is null and deal.stage not in ('closed', 'passed')
      and deal.expected_close_date is not null and tenant.archived_at is null
    for update of deal skip locked
  loop
    v_today := p_now at time zone d.timezone;
    v_close_at := case when d.expected_close_time is null
      then (d.expected_close_date + 1)::timestamp at time zone d.timezone
      else (d.expected_close_date + d.expected_close_time) at time zone d.timezone end;
    v_recipients := array(
      select distinct a.user_id from public.deal_assignees a
      join public.memberships m on m.tenant_id = a.tenant_id and m.user_id = a.user_id
      where a.tenant_id = d.tenant_id and a.deal_id = d.id and m.deactivated_at is null
    );
    if cardinality(v_recipients) = 0 then
      v_recipients := array(
        select distinct m.user_id from public.memberships m
        join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
        join public.roles r on r.tenant_id = mr.tenant_id and r.id = mr.role_id
        where m.tenant_id = d.tenant_id and m.deactivated_at is null and r.key in ('owner', 'admin')
      );
    end if;
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

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('scan-closing-soon-hourly', '0 * * * *', $$select public.scan_closing_soon(now())$$)
where not exists (select 1 from cron.job where jobname = 'scan-closing-soon-hourly');
