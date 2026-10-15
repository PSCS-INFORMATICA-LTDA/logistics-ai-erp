import type { SupabaseClient } from "@supabase/supabase-js";
import { PscsOneCoreArClient, LOGISTICS_AR_SOURCE_ENTITY_TYPE, LOGISTICS_AR_SOURCE_SYSTEM } from "./arClient";
import type { CoreReceivableCreateResult } from "./arClient";
import { CoreUserDirectory, type CoreIntegrationDirectory } from "./coreDirectory";
import { CoreArError } from "./errors";
import { resolveServiceOrderReceivableAmount } from "./receivableAmount";
import {
  resolveServiceOrderReceivableDueAt,
  resolveServiceOrderReceivableIssuedAt,
  type DueAtResult,
} from "./receivableSchedule";
import type { CoreArAuthSessionWithUser, CoreReceivableSummary } from "./types";
import {
  assertLogisticsCompanyMatchesMapping,
  isCoreUuid,
  readCoreCompanyIdFromCookieHeader,
} from "./tenantMapping";
import { PSCS_ONE_MAPPED_COMPANY_COOKIE } from "../config";
import { isCanonicalDriverConfirmed } from "@/lib/driver-confirmed";

export const SERVICE_ORDER_CLOSE_COLUMNS =
  "id, company_id, code, status, client_id, service_type, service_date, service_amount, freight_agreed_amount, driver_id, driver_assignment_response, proposal_sent_at, proposal_response, service_completed_at";

export const CANONICAL_RECEIVABLE_CURRENCY = "BRL" as const;

export type CloseOrderRow = {
  id: string;
  company_id: string;
  code: string | null;
  status: string | null;
  client_id: string | null;
  service_type: string | null;
  service_date: string | null;
  service_amount: number | string | null;
  freight_agreed_amount: number | string | null;
  driver_id: string | null;
  driver_assignment_response: string | null;
  proposal_sent_at: string | null;
  proposal_response: string | null;
  service_completed_at?: string | null;
};

export type LogisticsCloseStore = {
  loadOrder(serviceOrderId: string): Promise<CloseOrderRow | null>;
  assertMembership(authUserId: string, companyId: string): Promise<boolean>;
  completeOrder(serviceOrderId: string): Promise<{ status: string; service_completed_at: string | null }>;
};

export class LocalCloseAlreadyCompleted extends Error {
  constructor() {
    super("Ordem de serviço já concluída");
    this.name = "LocalCloseAlreadyCompleted";
  }
}

export type CloseServiceOrderResult = {
  order: {
    id: string;
    status: string;
    service_completed_at: string | null;
  };
  receivable: CoreReceivableSummary;
  receivable_created: boolean;
};

export type CloseDueAtResolver = (order: CloseOrderRow) => DueAtResult;

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

function proposalBlocksClose(order: CloseOrderRow): boolean {
  if (order.proposal_response === "rejected") return true;
  if (order.proposal_sent_at && order.proposal_response !== "accepted") return true;
  return false;
}

function assertDriverConfirmed(order: CloseOrderRow): void {
  if (isCanonicalDriverConfirmed(order)) return;
  if (order.driver_assignment_response === "rejected") {
    fail(
      "DRIVER_ASSIGNMENT_REJECTED",
      "Motorista recusou a designação. A OS não foi concluída.",
      409,
    );
  }
  fail(
    "DRIVER_ASSIGNMENT_PENDING",
    "Motorista ainda não confirmou a designação. A OS não foi concluída.",
    409,
  );
}

function assertReferenceCode(code: string | null): string {
  if (!code || code !== code.trim() || code.length > 80) {
    fail("REFERENCE_CODE_INVALID", "Código da OS não pode ser usado como referência do recebível.", 422);
  }
  return code;
}

async function resolveAgreedCoreCompany(input: {
  order: CloseOrderRow;
  cookieHeader: string | null | undefined;
  directory: CoreIntegrationDirectory;
}): Promise<string> {
  const mappedLogisticsCompanyId = readCookieValue(
    input.cookieHeader,
    PSCS_ONE_MAPPED_COMPANY_COOKIE,
  );
  assertLogisticsCompanyMatchesMapping({
    logisticsCompanyId: input.order.company_id,
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
  const mapping = await input.directory.resolveCoreCompany(input.order.company_id);
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

function idempotentResult(
  order: CloseOrderRow,
  receivable: CoreReceivableSummary,
  completedAt: string | null,
): CloseServiceOrderResult {
  return {
    order: {
      id: order.id,
      status: "Concluido",
      service_completed_at: completedAt ?? order.service_completed_at ?? null,
    },
    receivable,
    receivable_created: false,
  };
}

export async function closeServiceOrderWithCoreReceivable(input: {
  authUserId: string;
  serviceOrderId: string;
  cookieHeader: string | null | undefined;
  coreSession: CoreArAuthSessionWithUser;
  store: LogisticsCloseStore;
  directory?: CoreIntegrationDirectory;
  coreClient?: PscsOneCoreArClient;
  resolveDueAt?: CloseDueAtResolver;
}): Promise<CloseServiceOrderResult> {
  if (!input.authUserId) {
    fail("core_unauthenticated", "Authentication required.", 401);
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
  const coreClient = input.coreClient ?? new PscsOneCoreArClient(input.coreSession);

  let prepared:
    | {
        commercialAmount: string;
        issuedAt: string;
        referenceCode: string;
        clientId: string;
      }
    | null = null;

  if (order.status !== "Concluido") {
    if (order.status === "Cancelado") {
      fail("SERVICE_ORDER_NOT_CLOSABLE", "Ordem de serviço cancelada. A OS não foi concluída.", 409);
    }
    if (proposalBlocksClose(order)) {
      fail("PROPOSAL_NOT_ACCEPTED", "A proposta ainda não foi aceita. A OS não foi concluída.", 409);
    }
    assertDriverConfirmed(order);
    if (!isCoreUuid(order.client_id)) {
      fail(
        "CLIENT_ID_REQUIRED",
        "A OS não tem cliente do cadastro. A OS não foi concluída.",
        409,
      );
    }
    const commercial = resolveServiceOrderReceivableAmount(order);
    if (!commercial.ok) {
      fail(
        commercial.code,
        "Não foi possível determinar o valor comercial do cliente. A OS não foi concluída.",
        422,
      );
    }
    const issued = resolveServiceOrderReceivableIssuedAt(order);
    if (!issued.ok) {
      fail(issued.code, "A OS não tem data do documento para o recebível.", 422);
    }
    prepared = {
      commercialAmount: commercial.amount,
      issuedAt: issued.issuedAt,
      referenceCode: assertReferenceCode(order.code),
      clientId: order.client_id,
    };
  }

  const coreCompanyId = await resolveAgreedCoreCompany({
    order,
    cookieHeader: input.cookieHeader,
    directory,
  });

  if (order.status === "Concluido") {
    const existing = await coreClient.findReceivableByLogisticsSource({
      coreCompanyId,
      serviceOrderId: order.id,
    });
    if (!existing) {
      fail(
        "AR_RECONCILIATION_REQUIRED",
        "A OS já está concluída e não há recebível correspondente no PSCS One. Nada foi criado.",
        409,
      );
    }
    if (existing.company_id !== coreCompanyId) {
      fail("PARTY_COMPANY_MISMATCH", "Recebível de outra empresa.", 403);
    }
    return idempotentResult(order, existing, null);
  }

  if (!prepared) {
    fail("SERVICE_ORDER_NOT_CLOSABLE", "Ordem de serviço não elegível. A OS não foi concluída.", 409);
  }

  const party = await directory.resolveClientParty({
    coreCompanyId,
    clientId: prepared.clientId,
  });
  if (!party) {
    fail(
      "CORE_PARTY_MAPPING_REQUIRED",
      "Cliente ainda não está vinculado ao cadastro financeiro do PSCS One.",
      409,
    );
  }
  if (party.companyId !== coreCompanyId) {
    fail(
      "PARTY_COMPANY_MISMATCH",
      "O cadastro financeiro do cliente pertence a outra empresa. A OS não foi concluída.",
      403,
    );
  }

  const due = (input.resolveDueAt ?? resolveServiceOrderReceivableDueAt)(order);
  if (!due.ok) {
    fail(
      "AR_DUE_DATE_RULE_REQUIRED",
      "Não há regra de vencimento para registrar o recebível. A OS não foi concluída.",
      409,
    );
  }
  if (due.dueAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(due.dueAt)) {
    fail("AR_DUE_DATE_RULE_REQUIRED", "Vencimento do recebível é inválido. A OS não foi concluída.", 409);
  }

  let created: CoreReceivableCreateResult;
  try {
    created = await coreClient.createReceivable({
      company_id: coreCompanyId,
      party_id: party.partyId,
      amount: prepared.commercialAmount,
      currency: CANONICAL_RECEIVABLE_CURRENCY,
      issued_at: prepared.issuedAt,
      due_at: due.dueAt,
      reference_code: prepared.referenceCode,
      source_system: LOGISTICS_AR_SOURCE_SYSTEM,
      source_entity_type: LOGISTICS_AR_SOURCE_ENTITY_TYPE,
      source_entity_id: order.id,
    });
  } catch (error) {
    if (error instanceof CoreArError) throw error;
    fail("core_unavailable", "Não foi possível registrar o recebível. A OS não foi concluída.", 502);
  }

  if (created.receivable.company_id !== coreCompanyId || created.receivable.party_id !== party.partyId) {
    fail("PARTY_COMPANY_MISMATCH", "Core devolveu recebível de outra empresa.", 403);
  }

  try {
    const completed = await input.store.completeOrder(order.id);
    return {
      order: {
        id: order.id,
        status: completed.status || "Concluido",
        service_completed_at: completed.service_completed_at,
      },
      receivable: created.receivable,
      receivable_created: created.created,
    };
  } catch (error) {
    if (error instanceof LocalCloseAlreadyCompleted) {
      return idempotentResult(order, created.receivable, null);
    }
    if (error instanceof CoreArError) throw error;
    fail(
      "LOCAL_CLOSE_FAILED",
      "Não foi possível concluir a OS depois do recebível. Tente novamente.",
      503,
    );
  }
}

export function createSupabaseLogisticsCloseStore(supabase: SupabaseClient): LogisticsCloseStore {
  return {
    async loadOrder(serviceOrderId) {
      const { data, error } = await supabase
        .from("service_orders")
        .select(SERVICE_ORDER_CLOSE_COLUMNS)
        .eq("id", serviceOrderId)
        .maybeSingle();
      if (error) {
        throw new CoreArError("core_unavailable", "Could not load service order.", 502, error.message);
      }
      return (data as CloseOrderRow | null) ?? null;
    },
    async assertMembership(authUserId, companyId) {
      const { data, error } = await supabase
        .from("company_members")
        .select("id")
        .eq("user_id", authUserId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) {
        throw new CoreArError("core_unavailable", "Could not verify company membership.", 502, error.message);
      }
      return Boolean(data);
    },
    async completeOrder(serviceOrderId) {
      const { data, error } = await supabase.rpc("complete_service_order", {
        p_order_id: serviceOrderId,
      });
      if (error) {
        if (/já concluída/i.test(error.message ?? "")) {
          throw new LocalCloseAlreadyCompleted();
        }
        throw new CoreArError("LOCAL_CLOSE_FAILED", error.message, 503, error.message);
      }
      const payload = data as { status?: string; service_completed_at?: string } | null;
      return {
        status: payload?.status ?? "Concluido",
        service_completed_at: payload?.service_completed_at ?? null,
      };
    },
  };
}
