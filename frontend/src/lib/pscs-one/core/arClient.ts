import { IdentityGateError, requireArWrite, type IdentityDecision } from "../identityGate";
import { buildCoreSupabaseAuthCookieHeader } from "./authCookie";
import { pscsOneCoreApiBaseUrl } from "./config";
import { CoreArError, mapCoreHttpError } from "./errors";
import type { CoreArAuthSessionWithUser, CoreReceivablePayment, CoreReceivablePaymentReversal, CoreReceivableSummary } from "./types";

export const LOGISTICS_AR_SOURCE_SYSTEM = "logistics_ai";
export const LOGISTICS_AR_SOURCE_ENTITY_TYPE = "service_order";

export type CoreReceivableCreateRequest = {
  company_id: string;
  party_id: string;
  amount: string;
  currency: "BRL";
  issued_at: string;
  due_at: string | null;
  reference_code: string;
  source_system: typeof LOGISTICS_AR_SOURCE_SYSTEM;
  source_entity_type: typeof LOGISTICS_AR_SOURCE_ENTITY_TYPE;
  source_entity_id: string;
};

export type CoreReceivableCreateResult = {
  created: boolean;
  receivable: CoreReceivableSummary;
};

export type CoreArClientOptions = {
  baseUrl?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  identity?: IdentityDecision;
};

export class PscsOneCoreArClient {
  private readonly baseUrl: string;
  private readonly env: Record<string, string | undefined>;
  private readonly fetchImpl: typeof fetch;
  private readonly identity: IdentityDecision | null;

  constructor(
    private readonly session: CoreArAuthSessionWithUser,
    options: CoreArClientOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? pscsOneCoreApiBaseUrl(options.env)).replace(/\/+$/, "");
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.identity = options.identity ?? null;
  }

  private assertWrite(): void {
    try {
      requireArWrite(
        this.identity ?? { code: "identity_unbound", arWrite: false, coreRead: false },
      );
    } catch (error) {
      if (error instanceof IdentityGateError) {
        throw new CoreArError("core_unauthorized", "A sessão não autoriza o recebível.", 403, error.code);
      }
      throw error;
    }
  }

  private async coreFetch(
    path: string,
    init?: { method?: "GET" | "POST"; body?: unknown },
  ): Promise<Response> {
    let cookie: string;
    try {
      cookie = buildCoreSupabaseAuthCookieHeader(this.session, this.env);
    } catch (error) {
      if (error instanceof CoreArError) throw error;
      throw new CoreArError("core_unconfigured", "Core AR client is not configured.", 503);
    }

    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init?.method ?? "GET",
        headers: {
          Accept: "application/json",
          Cookie: cookie,
          ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      });
    } catch {
      throw new CoreArError("core_unavailable", "Core AR service unavailable.", 502);
    }
  }

  private async parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new CoreArError(
        "core_invalid_response",
        "Core returned a non-JSON response.",
        response.status >= 400 ? response.status : 502,
      );
    }
  }

  async getReceivable(receivableId: string): Promise<CoreReceivableSummary> {
    const response = await this.coreFetch(`/api/receivables/${encodeURIComponent(receivableId)}`);
    const body = await this.parseJson(response);
    if (!response.ok) {
      throw mapCoreHttpError(response.status, body);
    }
    const payload = body as { ok?: boolean; receivable?: CoreReceivableSummary };
    if (payload.ok !== true || !payload.receivable?.receivable_id) {
      throw new CoreArError("core_invalid_response", "Core receivable payload is invalid.", 502);
    }
    return payload.receivable;
  }

  async getReceivablePayments(receivableId: string): Promise<CoreReceivablePayment[]> {
    const response = await this.coreFetch(
      `/api/receivables/${encodeURIComponent(receivableId)}/payments`,
    );
    const body = await this.parseJson(response);
    if (!response.ok) {
      throw mapCoreHttpError(response.status, body);
    }
    const payload = body as { ok?: boolean; payments?: CoreReceivablePayment[] };
    if (payload.ok !== true || !Array.isArray(payload.payments)) {
      throw new CoreArError("core_invalid_response", "Core payments payload is invalid.", 502);
    }
    return payload.payments;
  }

  async findReceivableByLogisticsSource(input: {
    coreCompanyId: string;
    serviceOrderId: string;
  }): Promise<CoreReceivableSummary | null> {
    const params = new URLSearchParams({
      company_id: input.coreCompanyId,
      source_system: LOGISTICS_AR_SOURCE_SYSTEM,
      source_entity_type: LOGISTICS_AR_SOURCE_ENTITY_TYPE,
      source_entity_id: input.serviceOrderId,
    });
    const response = await this.coreFetch(`/api/receivables?${params.toString()}`);
    const body = await this.parseJson(response);
    if (!response.ok) {
      throw mapCoreHttpError(response.status, body);
    }
    const payload = body as { ok?: boolean; receivables?: CoreReceivableSummary[] };
    if (payload.ok !== true || !Array.isArray(payload.receivables)) {
      throw new CoreArError("core_invalid_response", "Core receivable list payload is invalid.", 502);
    }
    const matches = payload.receivables.filter(
      (row) => row.source_entity_id === input.serviceOrderId,
    );
    if (matches.length === 0) {
      return null;
    }
    if (matches.length > 1) {
      throw new CoreArError(
        "core_invalid_response",
        "Core returned more than one receivable for the same source_entity_id.",
        502,
      );
    }
    return matches[0] ?? null;
  }

  async createReceivable(input: CoreReceivableCreateRequest): Promise<CoreReceivableCreateResult> {
    this.assertWrite();
    const response = await this.coreFetch("/api/receivables", { method: "POST", body: input });
    const body = await this.parseJson(response);
    if (!response.ok) {
      throw mapCoreHttpError(response.status, body);
    }
    const payload = body as {
      ok?: boolean;
      created?: boolean;
      receivable?: CoreReceivableSummary;
      data?: CoreReceivableSummary;
    };
    const receivable = payload.receivable ?? payload.data;
    if (payload.ok !== true || (payload.created !== true && payload.created !== false) || !receivable?.receivable_id) {
      throw new CoreArError("core_invalid_response", "Core create receivable payload is invalid.", 502);
    }
    return { created: payload.created, receivable };
  }

  async postReceivablePayment(input: {
    company_id: string;
    receivable_id: string;
    currency_code: "BRL";
    amount: string;
    reference_code?: string;
    source_system?: typeof LOGISTICS_AR_SOURCE_SYSTEM;
    source_entity_type?: string;
    source_entity_id?: string;
  }): Promise<{ payment: CoreReceivablePayment; receivable: CoreReceivableSummary | null }> {
    this.assertWrite();
    if (!/^\d+\.\d{2}$/.test(input.amount) || Number(input.amount) <= 0) {
      throw new CoreArError("COMMERCIAL_AMOUNT_INVALID", "Payment amount must be a positive decimal.", 422);
    }
    const response = await this.coreFetch("/api/receivables/payments", { method: "POST", body: input });
    const body = await this.parseJson(response);
    if (!response.ok) {
      throw mapCoreHttpError(response.status, body);
    }
    const payload = body as {
      ok?: boolean;
      payment?: CoreReceivablePayment;
      receivable?: CoreReceivableSummary;
    };
    if (payload.ok !== true || !payload.payment?.payment_id) {
      throw new CoreArError("core_invalid_response", "Core payment payload is invalid.", 502);
    }
    if (payload.receivable && payload.receivable.company_id !== input.company_id) {
      throw new CoreArError("core_unauthorized", "Core returned a payment for another company.", 403);
    }
    return { payment: payload.payment, receivable: payload.receivable ?? null };
  }

  async reverseReceivablePayment(input: {
    company_id: string;
    payment_id: string;
    reason: string;
    idempotency_key: string;
  }): Promise<{
    created: boolean;
    reversal: CoreReceivablePaymentReversal;
    receivable: CoreReceivableSummary | null;
  }> {
    this.assertWrite();
    if (!input.reason.trim()) {
      throw new CoreArError("REFERENCE_CODE_INVALID", "Reversal reason is required.", 422);
    }
    const response = await this.coreFetch("/api/receivables/payments/reversals", {
      method: "POST",
      body: input,
    });
    const body = await this.parseJson(response);
    if (!response.ok) {
      throw mapCoreHttpError(response.status, body);
    }
    const payload = body as {
      ok?: boolean;
      created?: boolean;
      reversal?: CoreReceivablePaymentReversal;
      receivable?: CoreReceivableSummary;
    };
    if (
      payload.ok !== true ||
      (payload.created !== true && payload.created !== false) ||
      !payload.reversal?.reversal_id ||
      payload.reversal.payment_id !== input.payment_id
    ) {
      throw new CoreArError("core_invalid_response", "Core reversal payload is invalid.", 502);
    }
    if (payload.receivable && payload.receivable.company_id !== input.company_id) {
      throw new CoreArError("core_unauthorized", "Core returned a reversal for another company.", 403);
    }
    return {
      created: payload.created,
      reversal: payload.reversal,
      receivable: payload.receivable ?? null,
    };
  }
}
