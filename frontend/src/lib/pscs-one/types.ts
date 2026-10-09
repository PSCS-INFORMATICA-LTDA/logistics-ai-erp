export type PscsOneIdentityV1 = {
  version: "1";
  user_id: string;
  email: string | null;
  company_id: string;
  product_key: string;
  external_company_id: string;
  environment: "development";
};

/** Optional Core Supabase session returned by the PSCS One token endpoint (server-only). */
export type PscsOneCoreAuthSessionV1 = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id?: string;
};

export type PscsOneTokenExchangeV1 = {
  identity: PscsOneIdentityV1;
  core_auth?: PscsOneCoreAuthSessionV1;
};
