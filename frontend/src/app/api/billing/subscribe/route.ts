import { NextResponse } from "next/server";
import {
  asaasCreateOrUpdateCustomer,
  asaasCancelSubscription,
  asaasCreateSubscription,
  AsaasApiError,
  getAsaasConfig,
  mapAsaasSubscriptionStatus,
} from "@/lib/asaas";
import { nextBillingDueDate, resolveChargeAmount } from "@/lib/billing";
import { loadBillingSettings, requireCompanyMember } from "@/lib/billing-server";

export const runtime = "nodejs";

type Body = {
  card: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  payer?: {
    name?: string;
    email?: string;
    cpfCnpj?: string;
    phone?: string;
    postalCode?: string;
    addressNumber?: string;
  };
};

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "127.0.0.1";
  return request.headers.get("x-real-ip")?.trim() || "127.0.0.1";
}

export async function POST(request: Request) {
  const auth = await requireCompanyMember();
  if (auth.error || !auth.user || !auth.membership) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!getAsaasConfig().configured) {
    return NextResponse.json(
      {
        error:
          "Asaas ainda não está configurado no servidor. Cadastre ASAAS_API_KEY (sandbox) na Vercel / .env.local.",
      },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.card?.number || !body.card.ccv || !body.card.holderName) {
    return NextResponse.json({ error: "Informe os dados do cartão." }, { status: 400 });
  }

  const settings = await loadBillingSettings(auth.supabase, auth.membership.company_id);

  const payerName = (body.payer?.name || settings.payer_name || body.card.holderName).trim();
  const payerEmail = (body.payer?.email || settings.payer_email || auth.user.email || "").trim();
  const payerCpf = (body.payer?.cpfCnpj || settings.payer_cpf_cnpj || "").replace(/\D/g, "");
  const payerPhone = (body.payer?.phone || settings.payer_phone || "").replace(/\D/g, "");
  const postalCode = (body.payer?.postalCode || settings.payer_postal_code || "").replace(/\D/g, "");
  const addressNumber = (body.payer?.addressNumber || settings.payer_address_number || "").trim();

  if (!payerEmail || !payerCpf || payerCpf.length < 11) {
    return NextResponse.json(
      { error: "Informe e-mail e CPF/CNPJ do pagador (em Parâmetros ou neste formulário)." },
      { status: 400 }
    );
  }
  if (postalCode.length < 8 || !addressNumber) {
    return NextResponse.json(
      { error: "Informe CEP e número do endereço do titular do cartão." },
      { status: 400 }
    );
  }

  const value = resolveChargeAmount(settings);
  const nextDueDate = nextBillingDueDate(settings.billing_day);

  try {
    if (settings.asaas_subscription_id) {
      try {
        await asaasCancelSubscription(settings.asaas_subscription_id);
      } catch {
        // segue — pode já estar cancelada
      }
    }

    const customer = await asaasCreateOrUpdateCustomer({
      existingId: settings.asaas_customer_id,
      name: payerName,
      email: payerEmail,
      cpfCnpj: payerCpf,
      phone: payerPhone,
      postalCode,
      addressNumber,
    });

    const subscription = await asaasCreateSubscription({
      customerId: customer.id,
      value,
      nextDueDate,
      description: `GRX Management — mensalidade (${settings.charge_mode === "test" ? "teste" : "produção"})`,
      creditCard: body.card,
      creditCardHolderInfo: {
        name: payerName,
        email: payerEmail,
        cpfCnpj: payerCpf,
        postalCode,
        addressNumber,
        phone: payerPhone || undefined,
      },
      remoteIp: clientIp(request),
    });

    const last4 =
      subscription.creditCard?.creditCardNumber?.replace(/\D/g, "").slice(-4) ||
      body.card.number.replace(/\D/g, "").slice(-4);

    const { data, error } = await auth.supabase
      .from("company_billing_settings")
      .upsert(
        {
          ...settings,
          company_id: auth.membership.company_id,
          payer_name: payerName,
          payer_email: payerEmail,
          payer_cpf_cnpj: payerCpf,
          payer_phone: payerPhone || null,
          payer_postal_code: postalCode,
          payer_address_number: addressNumber,
          asaas_customer_id: customer.id,
          asaas_subscription_id: subscription.id,
          subscription_status: mapAsaasSubscriptionStatus(subscription.status) as
            | "inactive"
            | "pending"
            | "active"
            | "overdue"
            | "canceled"
            | "error",
          card_last4: last4,
          card_brand: subscription.creditCard?.creditCardBrand ?? null,
          card_holder_name: body.card.holderName.trim(),
          next_due_date: subscription.nextDueDate ?? nextDueDate,
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

    return NextResponse.json({
      ok: true,
      settings: data,
      message: `Assinatura criada. Cobrança de R$ ${value.toFixed(2).replace(".", ",")} no ciclo mensal.`,
    });
  } catch (err) {
    const message = err instanceof AsaasApiError ? err.message : "Falha ao criar assinatura.";
    await auth.supabase.from("company_billing_settings").upsert(
      {
        ...settings,
        company_id: auth.membership.company_id,
        subscription_status: "error",
        last_error: message,
        updated_by: auth.user.id,
      },
      { onConflict: "company_id" }
    );
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
