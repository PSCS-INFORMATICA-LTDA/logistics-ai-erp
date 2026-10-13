import {
  pscsOneCoreSupabaseAnonKey,
  pscsOneCoreSupabaseUrl,
} from "./config";
import { CoreArError } from "./errors";
import type { CoreArAuthSessionWithUser } from "./types";
import { isCoreUuid } from "./tenantMapping";

export type CoreCompanyMapping = {
  coreCompanyId: string;
};

export type CoreClientPartyMapping = {
  partyId: string;
  companyId: string;
};

export interface CoreIntegrationDirectory {
  resolveCoreCompany(logisticsCompanyId: string): Promise<CoreCompanyMapping | null>;
  resolveClientParty(input: {
    coreCompanyId: string;
    clientId: string;
  }): Promise<CoreClientPartyMapping | null>;
}

type FetchLike = typeof fetch;

/**
 * Lê product_company_mappings e party_external_references com o JWT do usuário Core.
 * A chave anon só preenche o header apikey. Não usa service role.
 */
export class CoreUserDirectory implements CoreIntegrationDirectory {
  constructor(
    private readonly session: CoreArAuthSessionWithUser,
    private readonly options: {
      env?: Record<string, string | undefined>;
      fetchImpl?: FetchLike;
    } = {},
  ) {}

  async resolveCoreCompany(logisticsCompanyId: string): Promise<CoreCompanyMapping | null> {
    if (!isCoreUuid(logisticsCompanyId)) {
      throw new CoreArError("tenant_mapping_missing", "Logistics company id is invalid.", 409);
    }
    const rows = await this.restGet<Array<{ company_id?: string }>>(
      "product_company_mappings",
      {
        select: "company_id",
        external_system: "eq.logistics_ai",
        external_company_id: `eq.${logisticsCompanyId}`,
        environment: "eq.dev",
        status: "eq.active",
        deleted_at: "is.null",
      },
    );
    const ids = rows
      .map((row) => row.company_id)
      .filter((id): id is string => isCoreUuid(id));
    if (ids.length === 0) return null;
    if (ids.length !== 1 || new Set(ids).size !== 1) {
      throw new CoreArError(
        "tenant_mapping_missing",
        "Logistics company maps to more than one Core company.",
        409,
      );
    }
    return { coreCompanyId: ids[0] };
  }

  async resolveClientParty(input: {
    coreCompanyId: string;
    clientId: string;
  }): Promise<CoreClientPartyMapping | null> {
    if (!isCoreUuid(input.coreCompanyId) || !isCoreUuid(input.clientId)) {
      return null;
    }
    const references = await this.restGet<Array<{ party_id?: string; company_id?: string }>>(
      "party_external_references",
      {
        select: "party_id,company_id",
        company_id: `eq.${input.coreCompanyId}`,
        external_system: "eq.logistics_ai",
        external_entity_type: "eq.client",
        external_entity_id: `eq.${input.clientId}`,
        deleted_at: "is.null",
      },
    );
    if (references.length === 0) return null;
    if (references.length !== 1) {
      throw new CoreArError(
        "core_invalid_response",
        "Core returned more than one Party for this client.",
        502,
      );
    }
    const reference = references[0];
    if (!isCoreUuid(reference?.party_id) || reference.company_id !== input.coreCompanyId) {
      return null;
    }
    const parties = await this.restGet<Array<{ id?: string; company_id?: string }>>("parties", {
      select: "id,company_id",
      id: `eq.${reference.party_id}`,
      deleted_at: "is.null",
    });
    const party = parties[0];
    if (!party || !isCoreUuid(party.company_id)) return null;
    return { partyId: reference.party_id, companyId: party.company_id };
  }

  private async restGet<T>(table: string, query: Record<string, string>): Promise<T> {
    const env = this.options.env ?? process.env;
    const baseUrl = pscsOneCoreSupabaseUrl(env);
    const anonKey = pscsOneCoreSupabaseAnonKey(env);
    if (!baseUrl || !anonKey || !this.session.access_token) {
      throw new CoreArError(
        "core_unconfigured",
        "Core directory client is not configured.",
        503,
      );
    }
    const params = new URLSearchParams(query);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/rest/v1/${table}?${params.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${this.session.access_token}`,
        },
        cache: "no-store",
      });
    } catch {
      throw new CoreArError("core_unavailable", "Core directory is unavailable.", 502);
    }
    if (response.status === 401 || response.status === 403) {
      throw new CoreArError("core_unauthorized", "Core directory denied the session.", response.status);
    }
    if (!response.ok) {
      throw new CoreArError("core_unavailable", "Core directory request failed.", 502);
    }
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) {
      throw new CoreArError("core_invalid_response", "Core directory payload is invalid.", 502);
    }
    return body as T;
  }
}
