-- NÃO EXECUTAR.
-- Impede o usuário autenticado de alterar public.profiles.pscs_one_user_id.
-- O UPDATE da tabela inteira faz has_column_privilege devolver verdadeiro para toda coluna.
-- Esta correção tira o UPDATE da tabela de anon, authenticated e PUBLIC e devolve
-- somente full_name e email para authenticated.
-- O trigger trg_profiles_updated_at permanece. O vínculo continua gravável por
-- service_role, postgres e supabase_admin, que é o caminho do SSO.
-- Não altera Auth, não cria usuário e não mexe no ledger.

begin;

revoke update on table public.profiles from public;
revoke update on table public.profiles from anon;
revoke update on table public.profiles from authenticated;

grant update (full_name, email) on table public.profiles to authenticated;
grant select, update on table public.profiles to service_role;

create or replace function public.protect_profiles_pscs_one_user_id()
returns trigger
language plpgsql
as $$
begin
  if new.pscs_one_user_id is distinct from old.pscs_one_user_id
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'pscs_one_user_id_immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_pscs_one_user_id_guard on public.profiles;
create trigger trg_profiles_pscs_one_user_id_guard
  before update of pscs_one_user_id on public.profiles
  for each row
  execute function public.protect_profiles_pscs_one_user_id();

do $$
begin
  if has_column_privilege('authenticated', 'public.profiles', 'pscs_one_user_id', 'UPDATE') then
    raise exception 'pscs_one_user_id_still_writable';
  end if;
  if has_column_privilege('anon', 'public.profiles', 'pscs_one_user_id', 'UPDATE') then
    raise exception 'pscs_one_user_id_still_writable_anon';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') then
    raise exception 'profile_name_not_writable';
  end if;
  if not has_column_privilege('service_role', 'public.profiles', 'pscs_one_user_id', 'UPDATE') then
    raise exception 'sso_link_not_writable';
  end if;
end $$;

commit;
