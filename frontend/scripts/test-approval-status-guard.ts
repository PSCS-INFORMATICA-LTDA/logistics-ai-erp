import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  APPROVAL_COMPANY_MOVE_ERROR,
  APPROVAL_STATUS_ADMIN_ERROR,
  evaluateApprovalStatusBatch,
  evaluateApprovalStatusUpdate,
  type ApprovalStatusUpdateInput,
} from "../src/lib/approval-status-guard.ts";

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

function change(partial: Partial<ApprovalStatusUpdateInput>): ApprovalStatusUpdateInput {
  return {
    actorRoleInOldCompany: "financeiro",
    actorRoleInNewCompany: "financeiro",
    oldStatus: "submitted",
    newStatus: "approved",
    oldCompanyId: COMPANY_A,
    newCompanyId: COMPANY_A,
    ...partial,
  };
}

describe("transição de approval_status", () => {
  it("deixa o administrador aprovar, rejeitar e cancelar na própria empresa", () => {
    for (const newStatus of ["approved", "rejected", "cancelled", "draft"]) {
      assert.deepEqual(
        evaluateApprovalStatusUpdate(
          change({
            actorRoleInOldCompany: "admin",
            actorRoleInNewCompany: "admin",
            newStatus,
          }),
        ),
        { ok: true },
      );
    }
  });

  it("nega financeiro e operacional mesmo com outras colunas no mesmo update", () => {
    for (const role of ["financeiro", "operacional", "socio"] as const) {
      const decision = evaluateApprovalStatusUpdate(
        change({ actorRoleInOldCompany: role, actorRoleInNewCompany: role }),
      );
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.reason, APPROVAL_STATUS_ADMIN_ERROR);
    }
  });

  it("preserva update financeiro que não mexe em status nem empresa", () => {
    assert.deepEqual(
      evaluateApprovalStatusUpdate(
        change({
          oldStatus: "submitted",
          newStatus: "submitted",
        }),
      ),
      { ok: true },
    );
    assert.deepEqual(
      evaluateApprovalStatusUpdate(
        change({
          actorRoleInOldCompany: "operacional",
          actorRoleInNewCompany: "operacional",
          oldStatus: "approved",
          newStatus: "approved",
        }),
      ),
      { ok: true },
    );
  });

  it("nega quem não é membro da empresa da linha", () => {
    const decision = evaluateApprovalStatusUpdate(
      change({ actorRoleInOldCompany: null, actorRoleInNewCompany: "admin" }),
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, APPROVAL_STATUS_ADMIN_ERROR);
  });
});

describe("isolamento e lote", () => {
  it("nega trocar a empresa sem ser administrador das duas", () => {
    const financeiro = evaluateApprovalStatusUpdate(
      change({
        oldStatus: "submitted",
        newStatus: "submitted",
        newCompanyId: COMPANY_B,
        actorRoleInNewCompany: "financeiro",
      }),
    );
    assert.equal(financeiro.ok, false);
    if (!financeiro.ok) assert.equal(financeiro.reason, APPROVAL_COMPANY_MOVE_ERROR);

    const adminOnlyOrigin = evaluateApprovalStatusUpdate(
      change({
        actorRoleInOldCompany: "admin",
        actorRoleInNewCompany: "financeiro",
        oldStatus: "approved",
        newStatus: "approved",
        newCompanyId: COMPANY_B,
      }),
    );
    assert.equal(adminOnlyOrigin.ok, false);
  });

  it("permite ao administrador das duas empresas mover sem mudar o status", () => {
    assert.deepEqual(
      evaluateApprovalStatusUpdate(
        change({
          actorRoleInOldCompany: "admin",
          actorRoleInNewCompany: "admin",
          oldStatus: "submitted",
          newStatus: "submitted",
          newCompanyId: COMPANY_B,
        }),
      ),
      { ok: true },
    );
  });

  it("um lote para na primeira linha de outra empresa", () => {
    const batch = evaluateApprovalStatusBatch([
      change({
        actorRoleInOldCompany: "admin",
        actorRoleInNewCompany: "admin",
      }),
      change({
        oldCompanyId: COMPANY_B,
        newCompanyId: COMPANY_B,
        actorRoleInOldCompany: "financeiro",
        actorRoleInNewCompany: "financeiro",
      }),
    ]);
    assert.deepEqual(batch, {
      ok: false,
      index: 1,
      reason: APPROVAL_STATUS_ADMIN_ERROR,
    });
  });
});

describe("contrato do banco e do servidor", () => {
  it("a migration 088 repete a regra e não abre bypass", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/088_financial_approval_status_guard.sql", import.meta.url),
      "utf8",
    );
    const apply = readFileSync(
      new URL("./apply-088-financial-approval-status-guard.sql", import.meta.url),
      "utf8",
    );
    for (const source of [sql, apply]) {
      assert.match(source, /before update on public\.financial_transactions/);
      assert.match(source, /for each row/);
      assert.match(source, /auth_user_is_company_admin\(old\.company_id\)/);
      assert.match(source, /auth_user_is_company_admin\(new\.company_id\)/);
      assert.match(source, /auth\.uid\(\) is null/);
      assert.match(source, /is distinct from old\.approval_status/);
      assert.match(source, /revoke all on function public\.guard_financial_transaction_approval_status\(\) from authenticated/);
      assert.doesNotMatch(source, /set_config|service_role|security definer/i);
    }
  });

  it("a função de aprovação lê o papel e ignora isAdmin e Senha Máster", () => {
    const source = readFileSync(
      new URL("../src/lib/financial-approval.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /loadCallerRoleInCompany/);
    assert.match(source, /evaluateApprovalStatusUpdate/);
    assert.doesNotMatch(source, /if \(isAdmin\) return \{ ok: true \}/);
    assert.doesNotMatch(source, /isMasterSessionUnlocked|verifyMasterPassword/);
    assert.doesNotMatch(source, /isAdmin: boolean/);
  });
});
