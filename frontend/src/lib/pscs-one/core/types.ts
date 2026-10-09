export type CoreReceivableSummary = {
  receivable_id: string;
  company_id: string;
  party_id: string;
  currency_code: string;
  original_amount: string;
  posted_amount: string;
  balance: string;
  status: string;
  reference_code: string | null;
  source_system: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
};

export type CoreReceivablePayment = {
  payment_id: string;
  amount: string;
  currency_code: string;
  status: string;
  reference_code: string | null;
};

export type CoreArAuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

export type CoreArAuthSessionWithUser = CoreArAuthSession & { user_id?: string };
