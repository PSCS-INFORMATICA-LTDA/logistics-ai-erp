-- NÃO EXECUTAR.
-- Devolve o UPDATE da tabela profiles para authenticated e remove a trava do vínculo.
-- Não devolve UPDATE para anon nem para PUBLIC.

begin;

drop trigger if exists trg_profiles_pscs_one_user_id_guard on public.profiles;
drop function if exists public.protect_profiles_pscs_one_user_id();

revoke update (full_name, email) on table public.profiles from authenticated;
grant update on table public.profiles to authenticated;

commit;
