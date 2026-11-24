import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  actorFromRecords,
  coreRoleForCompany,
  decideSharedIdentity,
  logisticsApprovedResult,
  postPartial,
  recoveryAddressDecision,
  reprocessServiceOrder,
  reversePayment,
  type IdentityActor,
  type ReceivableLedger,
} from "../src/lib/pscs-one/identityGate.ts";
import { revokedPscsOneSessionCookies } from "../src/lib/pscs-one/core/sessionRevocation.ts";

const COMPANY = "92c4c90d-6856-4c41-a9a1-9eba6a7468f6";
const CORE = "c0910000-0000-4000-8000-0000000000a1";
const OTHER = "c0b00000-0000-4000-8000-00000000000b";

function actor(overrides: Partial<IdentityActor> = {}): IdentityActor {
  return {
    logisticsUserId: "logistics-admin",
    logisticsRole: "admin",
    logisticsCompanyId: COMPANY,
    pscsOneUserId: "core-user",
    coreUserId: "core-user",
    coreCompanyId: CORE,
    mappedLogisticsCompanyId: COMPANY,
    coreMembershipRole: "company_admin",
    coreMembershipActive: true,
    duplicateCoreEmail: false,
    ...overrides,
  };
}

describe("matriz de identidade", () => {
  it("reconhece o admin só com vínculo explícito e sessão do Core", () => {
    const decision = decideSharedIdentity(actor());
    assert.equal(decision.code, "recognized_admin");
    assert.equal(decision.arWrite, true);
  });

  it("não trata a sessão do Logistics como sessão do Core", () => {
    const decision = decideSharedIdentity(actor({ coreUserId: null }));
    assert.equal(decision.code, "core_session_missing");
    assert.equal(decision.arWrite, false);
  });

  it("recusa e-mail duplicado e vínculo com outro app_users", () => {
    assert.equal(decideSharedIdentity(actor({ duplicateCoreEmail: true })).code, "duplicate_user");
    assert.equal(decideSharedIdentity(actor({ pscsOneUserId: "outro" })).code, "identity_conflict");
    assert.equal(decideSharedIdentity(actor({ pscsOneUserId: null })).code, "identity_unbound");
  });

  it("não promove financeiro nem operacional a company_admin", () => {
    const finance = decideSharedIdentity(actor({
      logisticsRole: "financeiro",
      coreMembershipRole: "member",
    }));
    const operations = decideSharedIdentity(actor({
      logisticsRole: "operacional",
      coreMembershipRole: "member",
    }));
    const financeAsAdmin = decideSharedIdentity(actor({
      logisticsRole: "financeiro",
      coreMembershipRole: "company_admin",
    }));
    assert.equal(finance.arWrite, false);
    assert.equal(finance.coreRead, true);
    assert.equal(operations.arWrite, false);
    assert.equal(operations.coreRead, true);
    assert.equal(financeAsAdmin.code, "role_not_granted");
    assert.equal(financeAsAdmin.arWrite, false);
  });

  it("exige a empresa da OS igual à empresa mapeada", () => {
    assert.equal(
      decideSharedIdentity(actor({ mappedLogisticsCompanyId: OTHER })).code,
      "company_mismatch",
    );
  });
});

describe("E07B e E08B locais", () => {
  it("percorre 100, baixa 40, saldo 60, estorno 40 e saldo 100 sem mexer no DRE", () => {
    let ledger: ReceivableLedger = { original: 100, payments: [], reversals: [] };
    const first = postPartial(ledger, { companyId: CORE, actorCompanyId: CORE, key: "pay-40", amount: 40 });
    ledger = first.ledger;
    assert.deepEqual(first.step, { ok: true, balance: 60, created: true, code: "POSTED" });

    const replay = postPartial(ledger, { companyId: CORE, actorCompanyId: CORE, key: "pay-40", amount: 40 });
    assert.equal(replay.step.code, "ALREADY_POSTED");
    assert.equal(replay.step.balance, 60);
    assert.equal(replay.ledger.payments.length, 1);

    const conflict = postPartial(ledger, { companyId: CORE, actorCompanyId: CORE, key: "pay-40", amount: 10 });
    assert.equal(conflict.step.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(conflict.step.balance, 60);

    const foreign = postPartial(ledger, { companyId: CORE, actorCompanyId: OTHER, key: "pay-other", amount: 10 });
    assert.equal(foreign.step.code, "FORBIDDEN");
    assert.equal(foreign.ledger, ledger);

    const reversed = reversePayment(ledger, {
      companyId: CORE,
      actorCompanyId: CORE,
      paymentKey: "pay-40",
      key: "rev-40",
      reason: "homologacao",
    });
    ledger = reversed.ledger;
    assert.deepEqual(reversed.step, { ok: true, balance: 100, created: true, code: "REVERSED" });

    const reverseReplay = reversePayment(ledger, {
      companyId: CORE,
      actorCompanyId: CORE,
      paymentKey: "pay-40",
      key: "rev-40",
      reason: "homologacao",
    });
    assert.equal(reverseReplay.step.code, "ALREADY_REVERSED");
    assert.equal(reverseReplay.step.balance, 100);

    const reasonConflict = reversePayment(ledger, {
      companyId: CORE,
      actorCompanyId: CORE,
      paymentKey: "pay-40",
      key: "rev-40",
      reason: "outro",
    });
    assert.equal(reasonConflict.step.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(reasonConflict.step.balance, 100);

    const dre = logisticsApprovedResult({ freight: 100, toll: 10, driver: 20, patio: 8 });
    assert.equal(dre.withoutPatio, 70);
    assert.equal(dre.withPatio, 78);
  });

  it("reprocessa a OS sem segundo recebível", () => {
    assert.deepEqual(reprocessServiceOrder({ receivableExists: true, localCompleted: false }), {
      createReceivable: false,
      completeLocal: true,
      code: "LOCAL_CLOSE_FAILED",
    });
    assert.equal(reprocessServiceOrder({ receivableExists: true, localCompleted: true }).createReceivable, false);
  });
});

describe("isolamento e sessão", () => {
  it("não leva o platform_admin da empresa B para a empresa A", () => {
    const role = coreRoleForCompany(
      [{ companyId: "c0b00000-0000-4000-8000-00000000000b", role: "platform_admin", active: true }],
      "c0910000-0000-4000-8000-0000000000a1",
    );
    assert.equal(role, null);
    const actor = actorFromRecords({
      logisticsUserId: "logistics-admin",
      logisticsRole: "admin",
      logisticsCompanyId: COMPANY,
      pscsOneUserId: "core-user",
      coreUserId: "core-user",
      coreCompanyId: "c0910000-0000-4000-8000-0000000000a1",
      mappedLogisticsCompanyId: COMPANY,
      coreMembershipRole: null,
      coreMembershipActive: false,
    });
    assert.equal(actor && decideSharedIdentity(actor).arWrite, false);
  });

  it("mostra que o próprio usuário ainda pode gravar pscs_one_user_id", () => {
    const policy = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/057_company_members_admin_access.sql"),
      "utf8",
    );
    const column = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/078_pscs_one_user_id.sql"),
      "utf8",
    );
    assert.match(policy, /profiles_update_own/);
    assert.doesNotMatch(policy, /pscs_one_user_id/);
    assert.doesNotMatch(column, /revoke|trigger/i);
  });

  it("revoga os cookies da sessão do Core no logout", () => {
    const route = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/app/api/service-orders/[id]/close/route.ts"),
      "utf8",
    );
    const header = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/components/layout/Header.tsx"),
      "utf8",
    );
    const payment = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/pscs-one/core/arClient.ts"),
      "utf8",
    );
    const cookies = revokedPscsOneSessionCookies();
    assert.equal(cookies.some((cookie) => cookie.name === "pscs_one_core_session" && cookie.maxAge === 0), true);
    assert.equal(cookies.some((cookie) => cookie.name === "pscs_one_core_company_id" && cookie.maxAge === 0), true);
    assert.match(header, /\/api\/auth\/logout/);
    assert.match(route, /decideSharedIdentity/);
    assert.match(payment, /requireArWrite/);
  });
});

describe("débitos P1", () => {
  it("registra as duas RPCs sem propor migration executável", () => {
    const text = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "residual-rpc-p1.md"), "utf8");
    assert.match(text, /company_has_no_members/);
    assert.match(text, /next_company_document_number/);
    assert.match(text, /Não cria migration/);
  });
});

describe("recuperação com endereço válido", () => {
  it("aceita o correio já usado na homologação do Core e recusa domínio local", () => {
    assert.equal(recoveryAddressDecision("philippe.dev@pscsinformatica.com.br").ok, true);
    assert.equal(recoveryAddressDecision("dev.ap.a.admin@pscs.local").reason, "local_domain");
    assert.equal(recoveryAddressDecision("rafael.homolog@pscs.test").reason, "local_domain");
  });
});
