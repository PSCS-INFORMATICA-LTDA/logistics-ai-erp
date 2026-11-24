export const LOGISTICS_DEV_COMPANY_A = "92c4c90d-6856-4c41-a9a1-9eba6a7468f6";
export const LOGISTICS_DEV_COMPANY_B = "bcd3c6c9-0e4a-4356-addd-4af925725576";

export type ProductCompanyMappingRow = {
  external_system: string;
  external_company_id: string;
  environment: string;
  status: string;
  deleted_at: string | null;
  company_id: string;
};

export type PartyExternalReferenceRow = {
  company_id: string;
  external_entity_type: string;
  external_entity_id: string;
  party_id: string;
  party_company_id: string;
  deleted_at: string | null;
};

export type MappingDecision =
  | { ok: true; coreCompanyId: string; partyId?: string }
  | { ok: false; code: "tenant_mapping_missing" | "PARTY_COMPANY_MISMATCH" };

export function resolveActiveLogisticsMapping(
  rows: ProductCompanyMappingRow[],
  logisticsCompanyId: string,
): MappingDecision {
  const active = rows.filter(
    (row) =>
      row.external_system === "logistics_ai" &&
      row.external_company_id === logisticsCompanyId &&
      row.environment === "dev" &&
      row.status === "active" &&
      row.deleted_at == null,
  );
  if (active.length !== 1) {
    return { ok: false, code: "tenant_mapping_missing" };
  }
  return { ok: true, coreCompanyId: active[0].company_id };
}

export function resolveClientPartyReference(
  rows: PartyExternalReferenceRow[],
  input: { coreCompanyId: string; clientId: string },
): MappingDecision {
  const active = rows.filter(
    (row) =>
      row.external_entity_type === "client" &&
      row.external_entity_id === input.clientId &&
      row.company_id === input.coreCompanyId &&
      row.deleted_at == null,
  );
  if (active.length !== 1) {
    return { ok: false, code: "tenant_mapping_missing" };
  }
  if (active[0].party_company_id !== input.coreCompanyId) {
    return { ok: false, code: "PARTY_COMPANY_MISMATCH" };
  }
  return { ok: true, coreCompanyId: input.coreCompanyId, partyId: active[0].party_id };
}
