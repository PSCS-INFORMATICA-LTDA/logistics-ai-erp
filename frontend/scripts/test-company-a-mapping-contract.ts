import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOGISTICS_DEV_COMPANY_A,
  LOGISTICS_DEV_COMPANY_B,
  resolveActiveLogisticsMapping,
  resolveClientPartyReference,
  type PartyExternalReferenceRow,
  type ProductCompanyMappingRow,
} from "../src/lib/pscs-one/core/companyMappingContract.ts";
import { CoreArError } from "../src/lib/pscs-one/core/errors.ts";
import { assertLogisticsCompanyMatchesMapping } from "../src/lib/pscs-one/core/tenantMapping.ts";

const CORE_A = "c0a00000-0000-4000-8000-00000000000a";
const CORE_B = "c0b00000-0000-4000-8000-00000000000b";

function row(overrides: Partial<ProductCompanyMappingRow> = {}): ProductCompanyMappingRow {
  return {
    external_system: "logistics_ai",
    external_company_id: LOGISTICS_DEV_COMPANY_A,
    environment: "dev",
    status: "active",
    deleted_at: null,
    company_id: CORE_A,
    ...overrides,
  };
}

describe("mapeamento ativo da empresa A", () => {
  it("aceita uma única linha active em dev", () => {
    const decision = resolveActiveLogisticsMapping([row()], LOGISTICS_DEV_COMPANY_A);
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.coreCompanyId, CORE_A);
  });

  it("recusa planned, ambiente errado, linha apagada e duplicata", () => {
    assert.equal(resolveActiveLogisticsMapping([row({ status: "planned" })], LOGISTICS_DEV_COMPANY_A).ok, false);
    assert.equal(resolveActiveLogisticsMapping([row({ environment: "prod" })], LOGISTICS_DEV_COMPANY_A).ok, false);
    assert.equal(
      resolveActiveLogisticsMapping([row({ deleted_at: "2026-11-24T00:00:00Z" })], LOGISTICS_DEV_COMPANY_A).ok,
      false,
    );
    assert.equal(resolveActiveLogisticsMapping([row(), row({ company_id: CORE_B })], LOGISTICS_DEV_COMPANY_A).ok, false);
  });

  it("não promove a empresa B que permanece planned", () => {
    const rows = [
      row(),
      row({
        external_company_id: LOGISTICS_DEV_COMPANY_B,
        status: "planned",
        company_id: CORE_B,
      }),
    ];
    assert.equal(resolveActiveLogisticsMapping(rows, LOGISTICS_DEV_COMPANY_B).ok, false);
    const activeA = resolveActiveLogisticsMapping(rows, LOGISTICS_DEV_COMPANY_A);
    assert.equal(activeA.ok && activeA.coreCompanyId, CORE_A);
  });

  it("exige uma party da mesma empresa Core", () => {
    const party: PartyExternalReferenceRow = {
      company_id: CORE_A,
      external_entity_type: "client",
      external_entity_id: "0850a780-993e-4daa-9845-5cf5915147d8",
      party_id: "11111111-1111-4111-8111-111111111111",
      party_company_id: CORE_A,
      deleted_at: null,
    };
    const ok = resolveClientPartyReference([party], {
      coreCompanyId: CORE_A,
      clientId: party.external_entity_id,
    });
    assert.equal(ok.ok && ok.partyId, party.party_id);
    assert.equal(
      resolveClientPartyReference([{ ...party, party_company_id: CORE_B }], {
        coreCompanyId: CORE_A,
        clientId: party.external_entity_id,
      }).code,
      "PARTY_COMPANY_MISMATCH",
    );
    assert.equal(resolveClientPartyReference([party, party], {
      coreCompanyId: CORE_A,
      clientId: party.external_entity_id,
    }).ok, false);
  });

  it("diverge o cookie da empresa da OS sem escolher outro vínculo", () => {
    assert.throws(
      () =>
        assertLogisticsCompanyMatchesMapping({
          logisticsCompanyId: LOGISTICS_DEV_COMPANY_A,
          mappedLogisticsCompanyId: LOGISTICS_DEV_COMPANY_B,
        }),
      (error: unknown) => error instanceof CoreArError && error.code === "tenant_mapping_missing",
    );
  });
});
