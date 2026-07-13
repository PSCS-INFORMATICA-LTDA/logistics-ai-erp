import { NextResponse } from "next/server";
import {
  asaasCancelSubscription,
  asaasUpdateSubscriptionValue,
  AsaasApiError,
  getAsaasConfig,
} from "@/lib/asaas";
import { resolveChargeAmount } from "@/lib/billing";
import { defaultBillingRow, loadBillingSettings, requireCompanyMember } from "@/lib/billing-server";

export const runtime = "nodejs";

type Body = {
  charge_mode?: "test" | "production";
  test_amount?: number;
  monthly_amount?: number;
  billing_day?: number;
  payer_name?: string;
  payer_email?: string;
  payer_cpf_cnpj?: string;
  payer_phone?: string;
  payer_postal_code?: string;
  payer_address_number?: string;
  sync_subscription_value?: boolean;
};

function parseAmount(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.01) return fallback;
  return Math.round(n * 100) / 100;
}

export async function PUT(request: Request) {
  const auth = await requireCompanyMember();
  if (auth.error || !auth.user || !auth.membership) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const current = await loadBillingSettings(auth.supabase, auth.membership.company_id);
  const defaults = defaultBillingRow(auth.membership.company_id);

  const next = {
    company_id: auth.membership.company_id,
    charge_mode: body.charge_mode === "production" ? "production" : "test",
    test_amount: parseAmount(body.test_amount, current.test_amount ?? defaults.test_amount),
    monthly_amount: parseAmount(
      body.monthly_amount,
      current.monthly_amount ?? defaults.monthly_amount
    ),
    billing_day: Math.min(
      28,
      Math.max(1, Math.trunc(Number(body.billing_day ?? current.billing_day ?? 10)) || 10)
    ),
    payer_name: (body.payer_name ?? current.payer_name ?? "").trim() || null,
    payer_email: (body.payer_email ?? current.payer_email ?? "").trim() || null,
    payer_cpf_cnpj: (body.payer_cpf_cnpj ?? current.payer_cpf_cnpj ?? "").replace(/\D/g, "") || null,
    payer_phone: (body.payer_phone ?? current.payer_phone ?? "").replace(/\D/g, "") || null,
    payer_postal_code:
      (body.payer_postal_code ?? current.payer_postal_code ?? "").replace(/\D/g, "") || null,
    payer_address_number:
      (body.payer_address_number ?? current.payer_address_number ?? "").trim() || null,
    updated_by: auth.user.id,
    last_error: null as string | null,
  };

  if (next.monthly_amount < 800 && next.charge_mode === "production") {
    // Aviso suave — permite salvar, mas reforça piso comercial
  }

  const { data, error } = await auth.supabase
    .from("company_billing_settings")
    .upsert(
      {
        ...current,
        ...next,
        asaas_customer_id: current.asaas_customer_id,
        asaas_subscription_id: current.asaas_subscription_id,
        subscription_status: current.subscription_status,
        card_last4: current.card_last4,
        card_brand: current.card_brand,
        card_holder_name: current.card_holder_name,
        next_due_date: current.next_due_date,
      },
      { onConflict: "company_id" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      {
        error:
          error.message.includes("company_billing_settings") || error.code === "42P01"
            ? "Tabela de cobrança ainda não existe. Aplique o SQL apply-037-company-billing.sql no Supabase."
            : error.message,
      },
      { status: 500 }
    );
  }

  let syncNote: string | null = null;
  if (
    body.sync_subscription_value &&
    data.asaas_subscription_id &&
    ["active", "pending", "overdue"].includes(data.subscription_status) &&
    getAsaasConfig().configured
  ) {
    try {
      const value = resolveChargeAmount(data);
      await asaasUpdateSubscriptionValue(data.asaas_subscription_id, value);
      syncNote = `Valor da assinatura atualizado no Asaas para R$ ${value.toFixed(2)}.`;
    } catch (err) {
      const message = err instanceof AsaasApiError ? err.message : "Falha ao sincronizar valor no Asaas.";
      await auth.supabase
        .from("company_billing_settings")
        .update({ last_error: message })
        .eq("company_id", auth.membership.company_id);
      return NextResponse.json({ settings: data, warning: message }, { status: 200 });
    }
  }

  return NextResponse.json({ settings: data, syncNote });
}

export async function DELETE() {
  const auth = await requireCompanyMember();
  if (auth.error || !auth.user || !auth.membership) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const current = await loadBillingSettings(auth.supabase, auth.membership.company_id);

  if (current.asaas_subscription_id && getAsaasConfig().configured) {
    try {
      await asaasCancelSubscription(current.asaas_subscription_id);
    } catch (err) {
      const message = err instanceof AsaasApiError ? err.message : "Falha ao cancelar no Asaas.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const { data, error } = await auth.supabase
    .from("company_billing_settings")
    .upsert(
      {
        ...current,
        company_id: auth.membership.company_id,
        asaas_subscription_id: null,
        subscription_status: "canceled",
        card_last4: null,
        card_brand: null,
        card_holder_name: null,
        next_due_date: null,
        last_error: null,
        updated_by: auth.user.id,
      },
      { onConflict: "company_id" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: data });
}
