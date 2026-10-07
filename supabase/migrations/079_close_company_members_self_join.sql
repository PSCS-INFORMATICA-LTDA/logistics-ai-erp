-- Close cross-company self-join on company_members.
--
-- Previous policy company_members_insert allowed any authenticated user to insert
-- a row with user_id = auth.uid() on an arbitrary company_id.
--
-- Callers that remain valid:
--   * /setup creates an empty company, then inserts the creator as admin.
--     That bootstrap stays, and only while the company has no members.
--   * An admin of that company can still insert members (auth_user_is_company_admin).
--   * Invite and PSCS One SSO insert through the service role, which bypasses RLS.
--
-- This repo has no supabase_migrations.schema_migrations ledger. Numbered SQL
-- files are the record. Apply this file only on Logistics DEV
-- (jmbajdpkvlrslirwzyze). Do not apply it on Logistics PROD.
--
-- Rollback (manual, DEV only). Do not run as part of this migration.
--   drop policy if exists company_members_insert on public.company_members;
--   create policy company_members_insert on public.company_members
--     for insert to authenticated
--     with check (
--       user_id = auth.uid()
--       or public.auth_user_is_company_admin(company_id)
--     );
--   drop function if exists public.company_has_no_members(uuid);

create or replace function public.company_has_no_members(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
  );
$$;

comment on function public.company_has_no_members(uuid) is
  'True when the company has no membership yet. Security definer so the bootstrap check is not hidden by RLS.';

revoke all on function public.company_has_no_members(uuid) from public;
revoke all on function public.company_has_no_members(uuid) from anon;
grant execute on function public.company_has_no_members(uuid) to authenticated;

drop policy if exists company_members_insert_own on public.company_members;
drop policy if exists company_members_insert on public.company_members;
create policy company_members_insert
on public.company_members
for insert
to authenticated
with check (
  public.auth_user_is_company_admin(company_id)
  or (
    user_id = auth.uid()
    and role = 'admin'
    and public.company_has_no_members(company_id)
  )
);

comment on policy company_members_insert on public.company_members is
  'Admin of the company may add members. A user may add only themselves as admin of a company that still has no members (setup bootstrap).';
