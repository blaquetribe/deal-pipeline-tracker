-- Feature 02, slice C: find an account by email for flows that run before sign-in (resend the
-- verification link, send a password reset). api_service only; exact match, never a pattern.
create function public.account_lookup(p_email text) returns table (user_id uuid, email_verified boolean)
  language sql stable security definer
  set search_path = ''
as $$
  select u.id, u.email_confirmed_at is not null
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
$$;
revoke all on function public.account_lookup(text) from public, anon, authenticated, service_role;
grant execute on function public.account_lookup(text) to api_service;
