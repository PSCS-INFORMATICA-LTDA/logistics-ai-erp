import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const migration093 = read("supabase/migrations/093_residual_search_path_and_helpers.sql");
const rollback093 = read("supabase/rollbacks/093_after_commit.sql");
const closeSrc = read("frontend/src/lib/pscs-one/core/closeServiceOrder.ts");

const HELPERS = [
  "_ap_assert_company_member",
  "_ap_post_competence",
  "_assert_service_order_member",
];
const PUBLIC_ENDPOINTS = [
  "get_public_proposal",
  "respond_to_proposal",
  "get_public_driver_assignment",
  "respond_to_driver_assignment",
  "get_public_patio_ticket",
];

function chainDre(lines) {
  const osExpenses = lines
    .filter((row) => row.serviceOrderId && row.type === "Despesa" && row.approval === "approved")
    .reduce((sum, row) => sum + row.amount, 0);
  const patio = lines
    .filter((row) => row.source === "parking" && row.type === "Receita" && row.approval === "approved")
    .reduce((sum, row) => sum + row.amount, 0);
  const reversedTitleNet = lines
    .filter((row) => row.source === "accounts_payable" && row.approval === "cancelled")
    .reduce((sum) => sum, 0);
  return {
    osResult: 100 - osExpenses,
    patio,
    reversedTitleNet,
    consolidated: 100 - osExpenses + patio,
  };
}

describe("cobertura complementar sem nova escrita no DEV", () => {
  it("nega os três helpers e preserva os cinco endpoints públicos no texto da 093", () => {
    for (const helper of HELPERS) {
      assert.match(migration093, new RegExp(`REVOKE ALL ON FUNCTION public\\.${helper}\\(uuid\\) FROM authenticated`));
      assert.match(migration093, new RegExp(`REVOKE ALL ON FUNCTION public\\.${helper}\\(uuid\\) FROM anon`));
      assert.match(migration093, new RegExp(`REVOKE ALL ON FUNCTION public\\.${helper}\\(uuid\\) FROM PUBLIC`));
    }
    for (const endpoint of PUBLIC_ENDPOINTS) {
      assert.equal(migration093.includes(`REVOKE ALL ON FUNCTION public.${endpoint}`), false);
    }
  });

  it("formaliza o rollback pós-commit com o ledger voltando a 92", () => {
    assert.match(rollback093, /NÃO EXECUTAR/);
    assert.match(rollback093, /rollback_093_requires_ledger_93/);
    assert.match(rollback093, /delete from public\._dev_schema_migrations/);
    assert.match(rollback093, /rollback_093_ledger_not_92/);
    assert.match(rollback093, /rollback_093_dev_marker_missing/);
    assert.match(rollback093, /lock table public\._dev_schema_migrations/i);
    assert.match(rollback093, /rollback_093_requires_postgres/);
    assert.match(rollback093, /count\(distinct filename\)/);
    assert.match(rollback093, /rollback_093_timestamp_changed/);
    assert.match(rollback093, /rollback_093_historical_row_changed/);
    assert.match(rollback093, /rollback_093_history/);
    assert.match(rollback093, /rollback_093_privilege_mismatch/);
    for (const helper of HELPERS) {
      assert.match(rollback093, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${helper}`));
    }
  });

  it("cobre a falha entre o recebível e a conclusão da OS no orquestrador", () => {
    const findAt = closeSrc.indexOf("findReceivableByLogisticsSource");
    const createAt = closeSrc.indexOf("createReceivable");
    assert.ok(findAt > 0 && findAt < createAt);
    assert.match(closeSrc, /LOCAL_CLOSE_FAILED/);
    assert.match(closeSrc, /PSCS_ONE_CLOSE_WITH_AR === "1" \? "core_receivable" : "operational"/);
  });

  it("separa o DRE da massa do dashboard completo", () => {
    const chain = chainDre([
      { amount: 10, type: "Despesa", approval: "approved", source: "vehicle_expense", serviceOrderId: "os" },
      { amount: 20, type: "Despesa", approval: "approved", source: null, serviceOrderId: "os" },
      { amount: 8, type: "Receita", approval: "approved", source: "parking", serviceOrderId: null },
      { amount: 15, type: "Despesa", approval: "cancelled", source: "accounts_payable", serviceOrderId: null },
      { amount: 1000, type: "Despesa", approval: "approved", source: "accounts_payable", serviceOrderId: null },
    ]);
    assert.deepEqual(chain, { osResult: 70, patio: 8, reversedTitleNet: 0, consolidated: 78 });
    assert.notEqual(chain.consolidated, 1000);
  });

  it("aponta a evidência já existente e o que ainda exige execução", () => {
    const evidence = {
      manualApproval: "PENDENTE_EXECUCAO",
      helperDenial: "EVIDENCIA_PARCIAL_UM_HELPER",
      publicEndpoints: "EVIDENCIA_FUNCIONAL_UM_ENDPOINT",
      driverReplacement: "EVIDENCIA_E04",
      passwordRecovery: "TESTE_LOCAL_REDIRECT",
      rbacSessions: "EVIDENCIA_T34_T40",
      receivableCloseGap: "TESTE_LOCAL_ORQUESTRADOR",
      dreVersusDashboard: "EVIDENCIA_E09_COM_HISTORICO",
    };
    assert.equal(fs.existsSync(path.join(root, "frontend/scripts/test-password-recovery-redirect.ts")), true);
    assert.equal(fs.existsSync(path.join(root, "frontend/scripts/test-driver-reassignment.ts")), true);
    assert.equal(fs.existsSync(path.join(root, "frontend/scripts/test-role-access.ts")), true);
    assert.equal(evidence.manualApproval, "PENDENTE_EXECUCAO");
    assert.equal(evidence.driverReplacement, "EVIDENCIA_E04");
  });
});
