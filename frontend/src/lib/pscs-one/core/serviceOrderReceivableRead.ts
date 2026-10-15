import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LOGISTICS_AR_SOURCE_ENTITY_TYPE,
  LOGISTICS_AR_SOURCE_SYSTEM,
  PscsOneCoreArClient,
} from "./arClient";
import { CoreUserDirectory, type CoreIntegrationDirectory } from "./coreDirectory";
import { CoreArError } from "./errors";
import type { CoreArAuthSessionWithUser, CoreReceivablePayment, CoreReceivableSummary } from "./types";
import {
  assertLogisticsCompanyMatchesMapping,
  isCoreUuid,
  readCoreCompanyIdFromCookieHeader,
} from "./tenantMapping";
import { PSCS_ONE_MAPPED_COMPANY_COOKIE } from "../config";
import type {
  ServiceOrderReceivableBody,
  ServiceOrderReceivablePaymentView,
  ServiceOrderReceivableView,
} from "./receivablePresentation";

export type {
  ServiceOrderReceivableBody,
  ServiceOrderReceivablePaymentView,
  ServiceOrderReceivableView,
} from "./receivablePresentation";

/**
 * Leitura do recebível da OS no PSCS One.
 * A company vem da OS no Logistics. O browser não envia company_id nem receivable_id.
 * Esta função só faz GET. Não cria título.
 */

export type ServiceOrderReceivableOrder = {
  id: string;
  company_id: string;
  code: string | null;
  status: string | null;
};

export type ServiceOrderReceivableReadStore = {
  loadOrder(serviceOrderId: string): Promise<ServiceOrderReceivableOrder | null>;
  assertMembership(authUserId: string, companyId: string): Promise<boolean>;
};

const ORDER_COLUMNS = "id, company_id, code, status";

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

function fail(code: CoreArError["code"], message: string, status: number): never {
  throw new CoreArError(code, message, status);
}

function dueOnFromCore(receivable: CoreReceivableSummary): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(receivable, "due_on")) return undefined;
  const value = (receivable as { due_on?: unknown }).due_on;
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

async function resolveAgreedCoreCompany(input: {
  logisticsCompanyId: string;
  cookieHeader: string | null | undefined;
  directory: CoreIntegrationDirectory;
}): Promise<string> {
  const mappedLogisticsCompanyId = readCookieValue(
    input.cookieHeader,
    PSCS_ONE_MAPPED_COMPANY_COOKIE,
  );
  assertLogisticsCompanyMatchesMapping({
    logisticsCompanyId: input.logisticsCompanyId,
    mappedLogisticsCompanyId,
  });
  const cookieCoreCompanyId = readCoreCompanyIdFromCookieHeader(input.cookieHeader);
  if (!cookieCoreCompanyId) {
    fail(
      "tenant_mapping_missing",
      "Core company mapping is missing. Sign in via PSCS One SSO.",
      409,
    );
  }
  const mapping = await input.directory.resolveCoreCompany(input.logisticsCompanyId);
  if (!mapping) {
    fail(
      "tenant_mapping_missing",
      "Logistics company is not mapped to a Core company.",
      409,
    );
  }
  if (mapping.coreCompanyId !== cookieCoreCompanyId) {
    fail(
      "tenant_mapping_missing",
      "Core company does not match the Logistics company mapping.",
      409,
    );
  }
  return mapping.coreCompanyId;
}

function assertReceivableBelongsToOrder(
  detail: CoreReceivableSummary,
  expectedReceivableId: string,
  serviceOrderId: string,
  coreCompanyId: string,
): void {
  if (
    detail.receivable_id !== expectedReceivableId ||
    detail.company_id !== coreCompanyId ||
    detail.source_entity_id !== serviceOrderId ||
    (detail.source_system != null && detail.source_system !== LOGISTICS_AR_SOURCE_SYSTEM) ||
    (detail.source_entity_type != null &&
      detail.source_entity_type !== LOGISTICS_AR_SOURCE_ENTITY_TYPE)
  ) {
    fail("core_unauthorized", "Recebível de outra empresa.", 403);
  }
}

function toPaymentView(payment: CoreReceivablePayment): ServiceOrderReceivablePaymentView {
  return {
    payment_id: payment.payment_id,
    amount: payment.amount,
    currency_code: payment.currency_code,
    status: payment.status,
    reference_code: payment.reference_code ?? null,
  };
}

export async function readServiceOrderReceivable(input: {
  authUserId: string;
  serviceOrderId: string;
  cookieHeader: string | null | undefined;
  coreSession: CoreArAuthSessionWithUser;
  store: ServiceOrderReceivableReadStore;
  directory?: CoreIntegrationDirectory;
  coreClient?: PscsOneCoreArClient;
}): Promise<ServiceOrderReceivableView> {
  if (!input.authUserId) {
    fail("core_unauthenticated", "Authentication required.", 401);
  }
  if (!input.coreSession?.access_token) {
    fail(
      "core_session_missing",
      "Core session is missing. Sign in via PSCS One SSO to refresh Core AR access.",
      401,
    );
  }
  if (!isCoreUuid(input.serviceOrderId)) {
    fail("receivable_not_found", "Service order not found.", 404);
  }

  const order = await input.store.loadOrder(input.serviceOrderId);
  if (!order) {
    fail("receivable_not_found", "Service order not found.", 404);
  }
  const member = await input.store.assertMembership(input.authUserId, order.company_id);
  if (!member) {
    fail("core_unauthorized", "You are not a member of this company.", 403);
  }

  const directory = input.directory ?? new CoreUserDirectory(input.coreSession);
  const coreCompanyId = await resolveAgreedCoreCompany({
    logisticsCompanyId: order.company_id,
    cookieHeader: input.cookieHeader,
    directory,
  });

  if (order.status !== "Concluido") {
    fail(
      "SERVICE_ORDER_NOT_CLOSABLE",
      "O financeiro do PSCS One aparece quando a OS está concluída.",
      409,
    );
  }

  const coreClient = input.coreClient ?? new PscsOneCoreArClient(input.coreSession);
  const found = await coreClient.findReceivableByLogisticsSource({
    coreCompanyId,
    serviceOrderId: order.id,
  });
  if (!found) {
    fail(
      "AR_RECONCILIATION_REQUIRED",
      "A OS já está concluída e não há recebível correspondente no PSCS One. Nada foi criado.",
      409,
    );
  }
  if (found.company_id !== coreCompanyId || found.source_entity_id !== order.id) {
    fail("core_unauthorized", "Recebível de outra empresa.", 403);
  }

  const detail = await coreClient.getReceivable(found.receivable_id);
  assertReceivableBelongsToOrder(detail, found.receivable_id, order.id, coreCompanyId);
  const payments = await coreClient.getReceivablePayments(detail.receivable_id);

  const receivable: ServiceOrderReceivableBody = {
    receivable_id: detail.receivable_id,
    currency_code: detail.currency_code,
    original_amount: detail.original_amount,
    posted_amount: detail.posted_amount,
    balance: detail.balance,
    status: detail.status,
    reference_code: detail.reference_code ?? null,
  };
  const dueOn = dueOnFromCore(detail);
  if (dueOn !== undefined) {
    receivable.due_on = dueOn;
  }

  return {
    receivable,
    payments: payments.map(toPaymentView),
  };
}

export function createSupabaseServiceOrderReceivableStore(
  supabase: SupabaseClient,
): ServiceOrderReceivableReadStore {
  return {
    async loadOrder(serviceOrderId) {
      const { data, error } = await supabase
        .from("service_orders")
        .select(ORDER_COLUMNS)
        .eq("id", serviceOrderId)
        .maybeSingle();
      if (error) {
        throw new CoreArError("core_unavailable", "Could not load service order.", 502, error.message);
      }
      return (data as ServiceOrderReceivableOrder | null) ?? null;
    },
    async assertMembership(authUserId, companyId) {
      const { data, error } = await supabase
        .from("company_members")
        .select("id")
        .eq("user_id", authUserId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) {
        throw new CoreArError(
          "core_unavailable",
          "Could not verify company membership.",
          502,
          error.message,
        );
      }
      return Boolean(data);
    },
  };
}
