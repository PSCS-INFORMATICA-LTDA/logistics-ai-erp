import { buildCoreSupabaseAuthCookieHeader } from "./authCookie";
import { pscsOneCoreApiBaseUrl } from "./config";
import { CoreArError, mapCoreHttpError } from "./errors";
import type { CoreArAuthSessionWithUser, CoreReceivablePayment, CoreReceivableSummary } from "./types";

export type CoreArClientOptions = {
  baseUrl?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

export class PscsOneCoreArClient {
  private readonly baseUrl: string;
  private readonly env: Record<string, string | undefined>;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly session: CoreArAuthSessionWithUser,
    options: CoreArClientOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? pscsOneCoreApiBaseUrl(options.env)).replace(/\/+$/, "");
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async coreFetch(path: string): Promise<Response> {
    let cookie: string;
    try {
      cookie = buildCoreSupabaseAuthCookieHeader(this.session, this.env);
    } catch (error) {
      if (error instanceof CoreArError) throw error;
      throw new CoreArError("core_unconfigured", "Core AR client is not configured.", 503);
    }

    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: cookie,
      },
      cache: "no-store",
    });
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
      source_system: "logistics_ai",
      source_entity_type: "service_order",
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
    return payload.receivables[0] ?? null;
  }
}
