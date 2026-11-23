import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  APPROVAL_COMPANY_MOVE_ERROR,
  APPROVAL_DELETE_DIRECT_ERROR,
  APPROVAL_INSERT_ADMIN_ERROR,
  APPROVAL_STATUS_ADMIN_ERROR,
  APPROVED_FIELD_CORRECTION_ERROR,
  SENSITIVE_APPROVED_FIELDS,
  evaluateApprovalInsert,
  evaluateApprovalStatusBatch,
  evaluateApprovalStatusUpdate,
  evaluateApprovedSensitiveUpdate,
  evaluateFinancialDelete,
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

  it("a 089 muda o padrão para submitted e não cria função pública que liga a flag de exclusão", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/089_financial_insert_delete_guard.sql", import.meta.url),
      "utf8",
    );
    assert.match(sql, /alter column approval_status set default 'submitted'/);
    assert.match(sql, /before insert on public\.financial_transactions/);
    assert.match(sql, /before delete on public\.financial_transactions/);
    assert.match(sql, /current_user in \('postgres', 'supabase_admin'\)/);
    assert.match(sql, /auto_approve_below_amount/);
    assert.match(sql, /app\.ft_audited_delete/);
    assert.doesNotMatch(sql, /create or replace function public\.allow_financial_delete/i);
    assert.match(sql, /QA-OS-ND-001/);
    assert.match(sql, /2026-11-23 16:15:59\.856477\+00/);
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

describe("criação com approval_status", () => {
  it("trata coluna omitida como submitted", () => {
    assert.deepEqual(
      evaluateApprovalInsert({
        actorRole: "financeiro",
        internalWriter: false,
        requestedStatus: null,
        entrySource: "company_ledger",
        amount: 5000,
        autoApproveBelowAmount: null,
      }),
      { ok: true, status: "submitted" },
    );
  });

  it("nega financeiro que envia approved fora da alçada", () => {
    const decision = evaluateApprovalInsert({
      actorRole: "financeiro",
      internalWriter: false,
      requestedStatus: "approved",
      entrySource: "company_ledger",
      amount: 100,
      autoApproveBelowAmount: null,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, APPROVAL_INSERT_ADMIN_ERROR);
  });

  it("nega approved com entry_source de pátio vindo do cliente", () => {
    const decision = evaluateApprovalInsert({
      actorRole: "financeiro",
      internalWriter: false,
      requestedStatus: "approved",
      entrySource: "parking",
      amount: 10,
      autoApproveBelowAmount: 1000,
    });
    assert.equal(decision.ok, false);
  });

  it("permite approved manual dentro da alçada e o caminho interno", () => {
    assert.deepEqual(
      evaluateApprovalInsert({
        actorRole: "financeiro",
        internalWriter: false,
        requestedStatus: "approved",
        entrySource: "vehicle_expense",
        amount: 40,
        autoApproveBelowAmount: 50,
      }),
      { ok: true, status: "approved" },
    );
    assert.deepEqual(
      evaluateApprovalInsert({
        actorRole: "financeiro",
        internalWriter: true,
        requestedStatus: "approved",
        entrySource: "driver_payment",
        amount: 200,
        autoApproveBelowAmount: null,
      }),
      { ok: true, status: "approved" },
    );
    assert.deepEqual(
      evaluateApprovalInsert({
        actorRole: "admin",
        internalWriter: false,
        requestedStatus: "approved",
        entrySource: "company_ledger",
        amount: 9000,
        autoApproveBelowAmount: null,
      }),
      { ok: true, status: "approved" },
    );
  });
});

describe("exclusão de lançamento", () => {
  it("bloqueia delete direto e libera só a função auditada", () => {
    const denied = evaluateFinancialDelete({ viaAuditedFunction: false });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, APPROVAL_DELETE_DIRECT_ERROR);
    assert.deepEqual(evaluateFinancialDelete({ viaAuditedFunction: true }), { ok: true });
  });
});

describe("campos de lançamento já aprovado", () => {
  it("deixa editar valor enquanto o lançamento não está approved", () => {
    assert.deepEqual(
      evaluateApprovedSensitiveUpdate({
        oldStatus: "submitted",
        newStatus: "submitted",
        changedFields: ["amount", "description"],
        viaAuditedCorrection: false,
      }),
      { ok: true },
    );
  });

  it("deixa aprovar, rejeitar e estornar sem mexer no valor", () => {
    for (const [oldStatus, newStatus] of [
      ["submitted", "approved"],
      ["submitted", "rejected"],
      ["approved", "cancelled"],
    ] as const) {
      assert.deepEqual(
        evaluateApprovedSensitiveUpdate({
          oldStatus,
          newStatus,
          changedFields: ["approval_status", "review_note", "reviewed_by", "reviewed_at", "updated_at", "updated_by"],
          viaAuditedCorrection: false,
        }),
        { ok: true },
      );
    }
  });

  it("bloqueia valor, origem e descrição depois de approved", () => {
    for (const field of ["amount", "entry_source", "description"]) {
      const decision = evaluateApprovedSensitiveUpdate({
        oldStatus: "approved",
        newStatus: "approved",
        changedFields: [field],
        viaAuditedCorrection: false,
      });
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.reason, APPROVED_FIELD_CORRECTION_ERROR);
    }
  });

  it("não deixa a mudança de status carregar um campo sensível junto", () => {
    const becomingApproved = evaluateApprovedSensitiveUpdate({
      oldStatus: "submitted",
      newStatus: "approved",
      changedFields: ["approval_status", "amount"],
      viaAuditedCorrection: false,
    });
    const leavingApproved = evaluateApprovedSensitiveUpdate({
      oldStatus: "approved",
      newStatus: "cancelled",
      changedFields: ["approval_status", "entry_source"],
      viaAuditedCorrection: false,
    });
    assert.equal(becomingApproved.ok, false);
    assert.equal(leavingApproved.ok, false);
  });

  it("libera a correção só pelo caminho auditado, não pela flag sozinha", () => {
    assert.deepEqual(
      evaluateApprovedSensitiveUpdate({
        oldStatus: "approved",
        newStatus: "approved",
        changedFields: ["amount"],
        viaAuditedCorrection: true,
      }),
      { ok: true },
    );
    const flaggedOnly = evaluateApprovedSensitiveUpdate({
      oldStatus: "approved",
      newStatus: "approved",
      changedFields: ["amount"],
      viaAuditedCorrection: false,
    });
    assert.equal(flaggedOnly.ok, false);
  });

  it("a 090 exige postgres, o papel da conexão e o id da linha", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/090_financial_approved_field_guard.sql", import.meta.url),
      "utf8",
    );
    const rollback = readFileSync(
      new URL("../../supabase/rollbacks/090_financial_approved_field_guard.sql", import.meta.url),
      "utf8",
    );
    assert.match(sql, /before update on public\.financial_transactions/);
    assert.match(sql, /current_user = 'postgres'/);
    assert.match(sql, /session_user in \('authenticator', 'authenticated'\)/);
    assert.match(sql, /app\.ft_audited_correction', true\) is not distinct from old\.id::text/);
    assert.match(sql, /old\.approval_status is distinct from 'approved'/);
    assert.match(sql, /new\.approval_status is distinct from 'approved'/);
    for (const field of SENSITIVE_APPROVED_FIELDS) {
      assert.match(sql, new RegExp(`new\\.${field} is distinct from old\\.${field}`));
    }
    assert.match(sql, /revoke all on function public\._ap_post_competence_impl\(uuid\) from service_role/);
    assert.match(sql, /revoke all on function public\.seed_dashboard_demo_impl\(uuid\) from service_role/);
    assert.doesNotMatch(sql, /revoke all on function public\._ap_post_competence\(uuid\) from service_role/);
    assert.doesNotMatch(sql, /revoke all on function public\.seed_dashboard_demo\(uuid\) from service_role/);
    assert.doesNotMatch(sql, /drop trigger if exists trg_financial_transactions_approval_status/);
    assert.doesNotMatch(sql, /drop trigger if exists trg_financial_transactions_approval_insert/);
    assert.doesNotMatch(sql, /drop trigger if exists trg_financial_transactions_direct_delete/);
    assert.match(sql, /char_length\(v_reason\) < 8/);
    assert.match(sql, /auth_user_is_company_admin\(v_row\.company_id\)/);
    assert.match(sql, /dashboard_demo/);
    assert.match(rollback, /grant execute on function public\._ap_post_competence_impl\(uuid\) to service_role/);
    assert.match(rollback, /grant execute on function public\.seed_dashboard_demo_impl\(uuid\) to service_role/);
    assert.doesNotMatch(rollback, /trg_financial_transactions_approval_status/);
    assert.doesNotMatch(rollback, /trg_financial_transactions_approval_insert/);
    assert.doesNotMatch(rollback, /trg_financial_transactions_direct_delete/);
  });

  it("estorno, baixa e pátio não dependem de alterar valor já aprovado", () => {
    const sql089 = readFileSync(
      new URL("../../supabase/migrations/089_financial_insert_delete_guard.sql", import.meta.url),
      "utf8",
    );
    assert.match(sql089, /post_parking_revenue/);
    assert.match(sql089, /post_car_wash_revenue/);
    assert.match(sql089, /_ap_post_competence_impl/);
    const estorno = evaluateApprovedSensitiveUpdate({
      oldStatus: "approved",
      newStatus: "cancelled",
      changedFields: ["approval_status", "review_note", "reviewed_by", "reviewed_at", "updated_by", "updated_at"],
      viaAuditedCorrection: false,
    });
    assert.deepEqual(estorno, { ok: true });
    const statusGate = evaluateApprovalStatusUpdate(
      change({
        actorRoleInOldCompany: "admin",
        actorRoleInNewCompany: "admin",
        oldStatus: "approved",
        newStatus: "cancelled",
      }),
    );
    assert.deepEqual(statusGate, { ok: true });
  });
});
