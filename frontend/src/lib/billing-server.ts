import { createClient } from "@/lib/supabase/server";
import type { CompanyBillingSettings } from "@/types/database";
import { DEFAULT_MONTHLY_AMOUNT, DEFAULT_TEST_AMOUNT } from "@/lib/billing";

export async function requireCompanyMember() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Não autenticado.", status: 401 as const, supabase, user: null, membership: null };
  }

  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership?.company_id) {
    return {
      error: "Usuário sem empresa vinculada.",
      status: 403 as const,
      supabase,
      user,
      membership: null,
    };
  }

  return { error: null, status: 200 as const, supabase, user, membership };
}

export function defaultBillingRow(companyId: string): CompanyBillingSettings {
  return {
    company_id: companyId,
    charge_mode: "test",
    test_amount: DEFAULT_TEST_AMOUNT,
    monthly_amount: DEFAULT_MONTHLY_AMOUNT,
    billing_day: 10,
    payer_name: null,
    payer_email: null,
    payer_cpf_cnpj: null,
    payer_phone: null,
    payer_postal_code: null,
    payer_address_number: null,
    asaas_customer_id: null,
    asaas_subscription_id: null,
    subscription_status: "inactive",
    card_last4: null,
    card_brand: null,
    card_holder_name: null,
    next_due_date: null,
    last_error: null,
  };
}

export async function loadBillingSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string
): Promise<CompanyBillingSettings> {
  const { data, error } = await supabase
    .from("company_billing_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !data) return defaultBillingRow(companyId);
  return data as CompanyBillingSettings;
}
