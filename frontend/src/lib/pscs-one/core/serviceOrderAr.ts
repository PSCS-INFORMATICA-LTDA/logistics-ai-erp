import type { SupabaseClient } from "@supabase/supabase-js";
import { PscsOneCoreArClient } from "./arClient";
import type { CoreArAuthSessionWithUser } from "./types";
import { CoreArError } from "./errors";
import {
  assertLogisticsCompanyMatchesMapping,
  readCoreCompanyIdFromCookieHeader,
} from "./tenantMapping";
import { PSCS_ONE_MAPPED_COMPANY_COOKIE } from "../config";

export type ServiceOrderCoreArView = {
  logistics: {
    service_order_id: string;
    company_id: string;
    code: string | null;
    driver_expense_amount: number;
  };
  mapping: {
    logistics_company_id: string;
    core_company_id: string;
  };
  core: {
    receivable_id: string;
    original_amount: string;
    posted_amount: string;
    balance: string;
    status: string;
    reference_code: string | null;
    source_system: string | null;
    source_entity_id: string | null;
    payment_count: number;
    payment_amount_total: string;
  };
};

function readCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}

function sumPaymentAmounts(amounts: string[]): string {
  const total = amounts.reduce((acc, value) => acc + Number(value || 0), 0);
  return total.toFixed(2);
}

export async function loadServiceOrderCoreArView(input: {
  supabase: SupabaseClient;
  serviceOrderId: string;
  cookieHeader: string | null | undefined;
  coreSession: CoreArAuthSessionWithUser;
  coreClient?: PscsOneCoreArClient;
}): Promise<ServiceOrderCoreArView> {
  const mappedLogisticsCompanyId = readCookieValue(
    input.cookieHeader,
    PSCS_ONE_MAPPED_COMPANY_COOKIE,
  );
  const coreCompanyId = readCoreCompanyIdFromCookieHeader(input.cookieHeader);
  if (!coreCompanyId) {
    throw new CoreArError(
      "tenant_mapping_missing",
      "Core company mapping is missing. Sign in via PSCS One SSO.",
      409,
    );
  }

  const { data: order, error: orderError } = await input.supabase
    .from("service_orders")
    .select("id, company_id, code")
    .eq("id", input.serviceOrderId)
    .maybeSingle();

  if (orderError) {
    throw new CoreArError("core_unavailable", "Could not load service order.", 502, orderError.message);
  }
  if (!order) {
    throw new CoreArError("receivable_not_found", "Service order not found.", 404);
  }

  assertLogisticsCompanyMatchesMapping({
    logisticsCompanyId: String(order.company_id),
    mappedLogisticsCompanyId,
  });

  const { data: driverTx, error: driverError } = await input.supabase
    .from("financial_transactions")
    .select("amount")
    .eq("service_order_id", input.serviceOrderId)
    .ilike("description", "%pagamento mot%");

  if (driverError) {
    throw new CoreArError(
      "core_unavailable",
      "Could not load driver expense from Logistics.",
      502,
      driverError.message,
    );
  }

  const driverExpenseAmount = (driverTx ?? []).reduce(
    (acc, row) => acc + Number((row as { amount?: number }).amount ?? 0),
    0,
  );

  const client = input.coreClient ?? new PscsOneCoreArClient(input.coreSession);
  const receivable = await client.findReceivableByLogisticsSource({
    coreCompanyId,
    serviceOrderId: input.serviceOrderId,
  });

  if (!receivable) {
    throw new CoreArError(
      "receivable_not_found",
      "No Core receivable correlated to this service order.",
      404,
    );
  }

  const payments = await client.getReceivablePayments(receivable.receivable_id);

  return {
    logistics: {
      service_order_id: String(order.id),
      company_id: String(order.company_id),
      code: (order.code as string) ?? null,
      driver_expense_amount: driverExpenseAmount,
    },
    mapping: {
      logistics_company_id: String(order.company_id),
      core_company_id: coreCompanyId,
    },
    core: {
      receivable_id: receivable.receivable_id,
      original_amount: receivable.original_amount,
      posted_amount: receivable.posted_amount,
      balance: receivable.balance,
      status: receivable.status,
      reference_code: receivable.reference_code,
      source_system: receivable.source_system,
      source_entity_id: receivable.source_entity_id,
      payment_count: payments.length,
      payment_amount_total: sumPaymentAmounts(payments.map((p) => p.amount)),
    },
  };
}
