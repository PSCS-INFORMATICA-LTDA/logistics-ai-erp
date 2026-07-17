import { NextResponse } from "next/server";
import { getAsaasConfig } from "@/lib/asaas";
import { formatBRL, resolveChargeAmount, SUBSCRIPTION_STATUS_LABELS } from "@/lib/billing";
import { loadBillingSettings, requireCompanyMember } from "@/lib/billing-server";
import { isPscsOperatorEmail } from "@/lib/pscs-operators";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireCompanyMember();
  if (auth.error || !auth.membership || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const settings = await loadBillingSettings(auth.supabase, auth.membership.company_id);
  const asaas = getAsaasConfig();
  const chargeAmount = resolveChargeAmount(settings);

  return NextResponse.json({
    settings,
    chargeAmount,
    chargeAmountLabel: formatBRL(chargeAmount),
    statusLabel: SUBSCRIPTION_STATUS_LABELS[settings.subscription_status] ?? settings.subscription_status,
    canManagePscsPricing: isPscsOperatorEmail(auth.user.email),
    asaas: {
      configured: asaas.configured,
      env: asaas.env,
    },
  });
}
