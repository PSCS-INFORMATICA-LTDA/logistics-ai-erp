-- PSCS One identity projection. DEV only (jmbajdpkvlrslirwzyze).
-- Do not apply to Logistics production (tqeenmswotxqainkyyct).

alter table public.profiles
  add column if not exists pscs_one_user_id uuid;

comment on column public.profiles.pscs_one_user_id is
  'PSCS One app_users.id. Local projection for SSO. Not a second commercial identity.';

create unique index if not exists idx_profiles_pscs_one_user_id
  on public.profiles (pscs_one_user_id)
  where pscs_one_user_id is not null;
