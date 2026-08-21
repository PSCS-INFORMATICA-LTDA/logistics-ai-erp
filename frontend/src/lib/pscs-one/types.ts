export type PscsOneIdentityV1 = {
  version: "1";
  user_id: string;
  email: string | null;
  company_id: string;
  product_key: string;
  external_company_id: string;
  environment: "development";
};
