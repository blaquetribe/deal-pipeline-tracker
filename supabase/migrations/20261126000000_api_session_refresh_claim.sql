-- Serialize rotating GoTrue refresh tokens across API instances. The API service can claim
-- one short lease per session; it cannot read or write api_sessions directly.
alter table public.api_sessions
  add column refresh_claim_hash text check (refresh_claim_hash is null or refresh_claim_hash ~ '^[0-9a-f]{64}$'),
  add column refresh_claim_expires_at timestamptz,
  add constraint api_sessions_refresh_claim_pair check (
    (refresh_claim_hash is null and refresh_claim_expires_at is null)
    or (refresh_claim_hash is not null and refresh_claim_expires_at is not null)
  );

create function public.session_refresh_claim(p_session_hash text, p_claim_hash text, p_lease_ms integer)
  returns table (claimed boolean, tokens_enc bytea)
  language plpgsql security definer set search_path = '' as $$
declare
  s public.api_sessions;
  v_claimed boolean := false;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_claim_hash is null or p_claim_hash !~ '^[0-9a-f]{64}$'
    or p_lease_ms is null or p_lease_ms not between 1000 and 30000 then
    raise exception 'invalid refresh claim' using errcode = '22023';
  end if;

  select * into s from public.api_sessions
    where session_hash = p_session_hash and revoked_at is null and expires_at > now()
    for update;
  if not found then return; end if;

  if s.refresh_claim_hash is null or s.refresh_claim_expires_at <= now() then
    update public.api_sessions set
      refresh_claim_hash = p_claim_hash,
      refresh_claim_expires_at = now() + make_interval(secs => p_lease_ms / 1000.0)
      where id = s.id
      returning * into s;
    v_claimed := true;
  end if;

  return query select v_claimed, s.tokens_enc;
end
$$;

create function public.session_refresh_complete(
  p_session_hash text, p_claim_hash text, p_tokens_enc bytea
) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  v_updated boolean;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_claim_hash is null or p_claim_hash !~ '^[0-9a-f]{64}$'
    or p_tokens_enc is null then
    raise exception 'invalid refresh completion' using errcode = '22023';
  end if;

  update public.api_sessions set
    tokens_enc = p_tokens_enc,
    refresh_claim_hash = null,
    refresh_claim_expires_at = null
    where session_hash = p_session_hash and revoked_at is null and expires_at > now()
      and refresh_claim_hash = p_claim_hash and refresh_claim_expires_at > now();
  v_updated := found;
  return v_updated;
end
$$;

create function public.session_refresh_release(p_session_hash text, p_claim_hash text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_claim_hash is null or p_claim_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid refresh claim' using errcode = '22023';
  end if;

  update public.api_sessions set
    refresh_claim_hash = null,
    refresh_claim_expires_at = null
    where session_hash = p_session_hash and refresh_claim_hash = p_claim_hash;
end
$$;

revoke all on function public.session_refresh_claim(text, text, integer),
  public.session_refresh_complete(text, text, bytea), public.session_refresh_release(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.session_refresh_claim(text, text, integer),
  public.session_refresh_complete(text, text, bytea), public.session_refresh_release(text, text)
  to api_service;
revoke execute on function public.session_update_tokens(text, bytea) from api_service;
