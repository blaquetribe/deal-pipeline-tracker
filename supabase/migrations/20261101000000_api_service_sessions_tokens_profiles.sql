-- Feature 02, slice A (ADR 0015): the narrow api_service role, server-side sessions, single-use email
-- tokens, and tenant-scoped profiles. api_service has no table privilege at all, only EXECUTE on the
-- eight SECURITY DEFINER functions below; the API reaches it through PostgREST with a signed JWT.

create role api_service nologin noinherit;
grant api_service to authenticator;
grant usage on schema public to api_service;

-- Sessions ---------------------------------------------------------------------------------------------------
-- The API stores only the sha256 of the opaque cookie value and the (API-encrypted) Supabase tokens.

create table public.api_sessions (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users (id) on delete restrict,
  tokens_enc bytea not null,
  active_tenant_id uuid references public.tenants (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index api_sessions_user_idx on public.api_sessions (user_id) where revoked_at is null;

create table public.email_tokens (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('verify_email', 'reset_password')),
  user_id uuid not null references auth.users (id) on delete restrict,
  email text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz
);
create index email_tokens_user_idx on public.email_tokens (user_id, purpose);

alter table public.api_sessions enable row level security;
alter table public.api_sessions force row level security;
alter table public.email_tokens enable row level security;
alter table public.email_tokens force row level security;
-- No policies: nobody but the owner (inside the definer functions) can read or write these.
revoke all on public.api_sessions, public.email_tokens from public, anon, authenticated, service_role, api_service;

create function public.session_create(p_session_hash text, p_user uuid, p_tokens_enc bytea) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid session hash' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null) then
    raise exception 'email not verified' using errcode = '42501';
  end if;
  -- Absolute lifetime: a session never outlives a working day, however often it is refreshed.
  insert into public.api_sessions (session_hash, user_id, tokens_enc, expires_at)
    values (p_session_hash, p_user, p_tokens_enc, now() + interval '12 hours')
    returning id into v_id;
  return v_id;
end
$$;

create function public.session_lookup(p_session_hash text)
  returns table (user_id uuid, tokens_enc bytea, active_tenant_id uuid)
  language sql stable security definer
  set search_path = ''
as $$
  select s.user_id, s.tokens_enc,
         -- A tenant stays active only while the membership does.
         case when exists (select 1 from public.memberships m
                           where m.user_id = s.user_id and m.tenant_id = s.active_tenant_id and m.deactivated_at is null)
              then s.active_tenant_id end
  from public.api_sessions s
  where s.session_hash = p_session_hash and s.revoked_at is null and s.expires_at > now()
$$;

create function public.session_update_tokens(p_session_hash text, p_tokens_enc bytea) returns void
  language plpgsql security definer
  set search_path = ''
as $$
begin
  update public.api_sessions set tokens_enc = p_tokens_enc
    where session_hash = p_session_hash and revoked_at is null and expires_at > now();
  if not found then
    raise exception 'no active session' using errcode = '42501';
  end if;
end
$$;

create function public.session_set_tenant(p_session_hash text, p_tenant uuid) returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_session public.api_sessions;
begin
  select * into v_session from public.api_sessions
    where session_hash = p_session_hash and revoked_at is null and expires_at > now()
    for update;
  if not found then
    raise exception 'no active session' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships m
                 where m.user_id = v_session.user_id and m.tenant_id = p_tenant and m.deactivated_at is null) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  update public.api_sessions set active_tenant_id = p_tenant where id = v_session.id;
end
$$;

create function public.session_revoke(p_session_hash text) returns void
  language sql security definer
  set search_path = ''
as $$
  update public.api_sessions set revoked_at = now() where session_hash = p_session_hash and revoked_at is null
$$;

create function public.session_revoke_user(p_user uuid) returns integer
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.api_sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Email tokens ------------------------------------------------------------------------------------------------------
-- The API generates 32 random bytes and sends only their sha256. Single use, purpose- and email-bound,
-- expiring; a newer token for the same user and purpose revokes the older ones. Consumption is one
-- statement, so two parallel requests cannot both succeed.

create function public.token_issue(p_purpose text, p_user uuid, p_token_hash text) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_email text;
  v_id uuid;
begin
  if p_purpose not in ('verify_email', 'reset_password') then
    raise exception 'unknown purpose' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22023';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  if v_email is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  update public.email_tokens set revoked_at = now()
    where user_id = p_user and purpose = p_purpose and consumed_at is null and revoked_at is null;
  insert into public.email_tokens (purpose, user_id, email, token_hash, expires_at)
    values (p_purpose, p_user, v_email, p_token_hash,
            now() + case p_purpose when 'verify_email' then interval '24 hours' else interval '1 hour' end)
    returning id into v_id;
  return v_id;
end
$$;

-- Every failure looks the same (DP401): unknown, used, revoked, expired, wrong purpose, email changed.
-- Consuming a verify_email token also marks the email verified, in the same transaction, so a crash
-- between the two steps cannot strand a user.
create function public.token_consume(p_purpose text, p_token_hash text) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_purpose not in ('verify_email', 'reset_password') then
    raise exception 'unknown purpose' using errcode = '22023';
  end if;

  update public.email_tokens t set consumed_at = now()
    from auth.users u
    where t.token_hash = p_token_hash and t.purpose = p_purpose
      and t.consumed_at is null and t.revoked_at is null and t.expires_at > now()
      and u.id = t.user_id and u.email = t.email
    returning t.user_id into v_user;
  if v_user is null then
    raise exception 'invalid token' using errcode = 'DP401';
  end if;

  if p_purpose = 'verify_email' then
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_user;
  end if;
  return v_user;
end
$$;

revoke all on function
  public.session_create(text, uuid, bytea), public.session_lookup(text), public.session_update_tokens(text, bytea),
  public.session_set_tenant(text, uuid), public.session_revoke(text), public.session_revoke_user(uuid),
  public.token_issue(text, uuid, text), public.token_consume(text, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.session_create(text, uuid, bytea), public.session_lookup(text), public.session_update_tokens(text, bytea),
  public.session_set_tenant(text, uuid), public.session_revoke(text), public.session_revoke_user(uuid),
  public.token_issue(text, uuid, text), public.token_consume(text, text)
  to api_service;

-- Profiles: a tenant-scoped directory ---------------------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 100),
  job_title text check (char_length(job_title) between 1 and 100),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- You see your own profile and those of people who share a tenant with you (members past and present
-- of that tenant, so authors of old events still resolve); never anyone else's.
create function app.shares_tenant_with(p_user uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.tenant_id = mine.tenant_id
    where mine.user_id = (select app.uid()) and mine.deactivated_at is null and theirs.user_id = p_user
  )
$$;
revoke all on function app.shares_tenant_with(uuid) from public;
grant execute on function app.shares_tenant_with(uuid) to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (user_id = (select app.uid()) or (select app.shares_tenant_with(user_id)));
revoke all on public.profiles from public, anon, authenticated, service_role;
grant select on public.profiles to authenticated;

create function public.profile_upsert(p_display_name text, p_job_title text default null) returns void
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if app.uid() is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into public.profiles (user_id, display_name, job_title)
    values (app.uid(), p_display_name, p_job_title)
    on conflict (user_id) do update
      set display_name = excluded.display_name, job_title = excluded.job_title, updated_at = now();
end
$$;
revoke all on function public.profile_upsert(text, text) from public, anon, authenticated, service_role;
grant execute on function public.profile_upsert(text, text) to authenticated;
