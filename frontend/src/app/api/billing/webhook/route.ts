import { NextResponse } from "next/server";
import { mapAsaasSubscriptionStatus } from "@/lib/asaas";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * Webhook Asaas — configure a URL:
 * https://SEU_DOMINIO/api/billing/webhook?token=ASAAS_WEBHOOK_TOKEN
 *
 * Requer SUPABASE_SERVICE_ROLE_KEY no servidor para atualizar o status sem login.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("asaas-access-token");
  const expected = process.env.ASAAS_WEBHOOK_TOKEN?.trim();

  if (expected && token !== expected) {
    return NextResponse.json({ error: "Token inválido." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as {
    event?: string;
    payment?: { subscription?: string; status?: string; dueDate?: string };
    subscription?: { id?: string; status?: string; nextDueDate?: string };
  } | null;

  if (!payload) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const subscriptionId = payload.subscription?.id || payload.payment?.subscription;
  if (!subscriptionId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        error: "SUPABASE_SERVICE_ROLE_KEY não configurada — webhook não pode atualizar o status.",
      },
      { status: 503 }
    );
  }

  const { data: row } = await supabase
    .from("company_billing_settings")
    .select("company_id")
    .eq("asaas_subscription_id", subscriptionId)
    .maybeSingle();

  if (!row?.company_id) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const statusSource = payload.subscription?.status || payload.payment?.status;
  const nextStatus = mapAsaasSubscriptionStatus(statusSource);
  const nextDue = payload.subscription?.nextDueDate || payload.payment?.dueDate || null;

  await supabase
    .from("company_billing_settings")
    .update({
      subscription_status: nextStatus,
      ...(nextDue ? { next_due_date: nextDue } : {}),
      last_error: null,
    })
    .eq("company_id", row.company_id);

  return NextResponse.json({ ok: true });
}
