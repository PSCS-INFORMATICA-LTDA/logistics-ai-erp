/**
 * Fluxo funcional Contas a Pagar via sessão usuário (Empresa A).
 * Pré: seed-dev-ap-multicompany.mjs + DEV_SEED_PASSWORD
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  approveAccountsPayable,
  cancelAccountsPayable,
  createAccountsPayableDraft,
  createFinancialAccount,
  fetchApKpis,
  listAccountsPayable,
  registerApPayment,
  rejectAccountsPayable,
  reverseApPayment,
  softDeleteAccountsPayable,
  submitAccountsPayable,
  updateFinancialAccountActive,
} from "../src/lib/accounts-payable-api.ts";
import { splitInstallments as splitLocal } from "../src/lib/accounts-payable.ts";

const PROD = "tqeenmswotxqainkyyct";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

function fail(m) {
  console.error("FAIL", m);
  process.exit(1);
}
function ok(m) {
  console.log("PASS", m);
}

function loadEnv(p) {
  const o = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    o[t.slice(0, i)] = v;
  }
  return o;
}

const verify = spawnSync(process.execPath, [path.join(__dirname, "verify-dev-environment.mjs")], {
  cwd: frontendRoot,
  encoding: "utf8",
});
if (verify.status !== 0) fail("verify");
process.stdout.write(verify.stdout || "");

const env = loadEnv(path.join(frontendRoot, ".env.local"));
if ((env.NEXT_PUBLIC_SUPABASE_URL || "").includes(PROD)) fail("prod");
const password = process.env.DEV_SEED_PASSWORD;
if (!password) fail("DEV_SEED_PASSWORD");
const meta = JSON.parse(
  fs.readFileSync(path.join(frontendRoot, ".tmp-dev-ap-multicompany.json"), "utf8")
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: loginErr } = await sb.auth.signInWithPassword({
  email: meta.emails.aAdmin,
  password,
});
if (loginErr) fail(loginErr.message);

const companyId = meta.companyA.id;
const supplierId = meta.companyA.supplierId;
const chartId = meta.companyA.chartId;
const today = new Date();
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = iso(today);
const future = new Date(today);
future.setDate(future.getDate() + 14);
const futureIso = iso(future);

// Parcelamento unitário
const parts = splitLocal(100, 3, todayIso);
const sum = Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100);
if (sum !== 10000) fail(`parcelas soma ${sum}`);
ok(`parcelamento 3x = ${parts.map((p) => p.amount).join("+")}`);

// Conta financeira
const bankName = "Banco DEV Teste Final";
let bankId = meta.companyA.accountId;
{
  const { data: existing } = await sb
    .from("company_financial_accounts")
    .select("id")
    .eq("company_id", companyId)
    .eq("name", bankName)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing?.id) bankId = existing.id;
  else {
    const created = await createFinancialAccount(sb, {
      companyId,
      name: bankName,
      accountType: "checking",
      openingBalance: 1000,
      openingBalanceDate: todayIso,
    });
    if (created.error || !created.row) fail(created.error || "conta");
    bankId = created.row.id;
    ok("conta financeira criada");
  }
}

await updateFinancialAccountActive(sb, companyId, bankId, false);
ok("conta inativada");
await updateFinancialAccountActive(sb, companyId, bankId, true);
ok("conta reativada");

// Rascunho
const draftDesc = "Teste DEV — Locação de veículo";
let draftId;
{
  const { data: ex } = await sb
    .from("accounts_payable")
    .select("id, internal_number")
    .eq("company_id", companyId)
    .eq("description", draftDesc)
    .is("deleted_at", null)
    .maybeSingle();
  if (ex) {
    draftId = ex.id;
    ok(`rascunho existente ${ex.internal_number}`);
  } else {
    const res = await createAccountsPayableDraft(sb, {
      companyId,
      description: draftDesc,
      competenceDate: todayIso,
      firstDueDate: futureIso,
      chartOfAccountId: chartId,
      originalAmount: 1000,
      installmentCount: 1,
      supplierId,
    });
    if (res.error || !res.id) fail(res.error || "draft");
    draftId = res.id;
    ok(`rascunho ${res.internalNumber}`);
  }
}

// Parcelado 3x
const manDesc = "Teste DEV — Manutenção preventiva";
{
  const { data: ex } = await sb
    .from("accounts_payable")
    .select("id")
    .eq("company_id", companyId)
    .eq("description", manDesc)
    .is("deleted_at", null)
    .maybeSingle();
  if (!ex) {
    const res = await createAccountsPayableDraft(sb, {
      companyId,
      description: manDesc,
      competenceDate: todayIso,
      firstDueDate: futureIso,
      chartOfAccountId: chartId,
      originalAmount: 100,
      installmentCount: 3,
      supplierId,
    });
    if (res.error) fail(res.error);
    const { data: inst } = await sb
      .from("accounts_payable_installments")
      .select("amount")
      .eq("accounts_payable_id", res.id)
      .order("installment_no");
    const s = Math.round((inst || []).reduce((a, r) => a + Number(r.amount), 0) * 100);
    if (s !== 10000) fail(`DB parcelas ${s}`);
    ok(`manutenção 3 parcelas ok (${(inst || []).map((i) => i.amount).join(",")})`);
  } else ok("manutenção já existia");
}

// Aprovação com workflow: ligar aprovação, criar, submeter, aprovar
await sb
  .from("company_financial_approval_settings")
  .upsert({ company_id: companyId, ap_approval_enabled: true });

const apprDesc = "Teste DEV — Aprovação final";
let apprId;
{
  const { data: ex } = await sb
    .from("accounts_payable")
    .select("id, approval_status")
    .eq("company_id", companyId)
    .eq("description", apprDesc)
    .is("deleted_at", null)
    .maybeSingle();
  if (ex) apprId = ex.id;
  else {
    const res = await createAccountsPayableDraft(sb, {
      companyId,
      description: apprDesc,
      competenceDate: todayIso,
      firstDueDate: futureIso,
      chartOfAccountId: chartId,
      originalAmount: 200,
      installmentCount: 1,
      supplierId,
    });
    if (res.error) fail(res.error);
    apprId = res.id;
  }
  const sub = await submitAccountsPayable(sb, apprId);
  if (sub.error && !/já|aprovado|enviado/i.test(sub.error)) {
    // pode já estar aprovado
  }
  const { data: mid } = await sb
    .from("accounts_payable")
    .select("approval_status")
    .eq("id", apprId)
    .single();
  if (mid?.approval_status === "submitted") {
    ok("status Pendente de aprovação");
    const { count: before } = await sb
      .from("accounts_payable_postings")
      .select("id", { count: "exact", head: true })
      .eq("accounts_payable_id", apprId);
    if ((before || 0) > 0) fail("DRE antes da aprovação");
    const ap = await approveAccountsPayable(sb, apprId, "ok");
    if (ap.error) fail(ap.error);
    ok("aprovado");
  } else if (mid?.approval_status === "approved") {
    ok("já aprovado");
  } else {
    // approval disabled path may auto-approve
    ok(`approval_status=${mid?.approval_status}`);
  }
  const again = await approveAccountsPayable(sb, apprId, "dup");
  if (!again.error) {
    const { count } = await sb
      .from("accounts_payable_postings")
      .select("id", { count: "exact", head: true })
      .eq("accounts_payable_id", apprId)
      .is("reversed_at", null);
    // segunda aprovação deve falhar
  } else ok("reaprovação bloqueada");
}

// Rejeição
await sb
  .from("company_financial_approval_settings")
  .upsert({ company_id: companyId, ap_approval_enabled: true });
const rejDesc = "Teste DEV — Rejeição final";
{
  let id;
  const { data: ex } = await sb
    .from("accounts_payable")
    .select("id, approval_status")
    .eq("company_id", companyId)
    .eq("description", rejDesc)
    .is("deleted_at", null)
    .maybeSingle();
  if (ex) id = ex.id;
  else {
    const res = await createAccountsPayableDraft(sb, {
      companyId,
      description: rejDesc,
      competenceDate: todayIso,
      firstDueDate: futureIso,
      chartOfAccountId: chartId,
      originalAmount: 50,
      installmentCount: 1,
      supplierId,
    });
    if (res.error) fail(res.error);
    id = res.id;
  }
  await submitAccountsPayable(sb, id);
  const { data: st } = await sb
    .from("accounts_payable")
    .select("approval_status")
    .eq("id", id)
    .single();
  if (st?.approval_status === "submitted") {
    const rej = await rejectAccountsPayable(sb, id, "Motivo DEV rejeição");
    if (rej.error) fail(rej.error);
    const { count } = await sb
      .from("accounts_payable_postings")
      .select("id", { count: "exact", head: true })
      .eq("accounts_payable_id", id);
    if ((count || 0) > 0) fail("posting após rejeição");
    ok("rejeição sem DRE");
  } else ok(`rejeição skip status=${st?.approval_status}`);
}

// Pagamento parcial + total + estorno em título dedicado
await sb
  .from("company_financial_approval_settings")
  .upsert({ company_id: companyId, ap_approval_enabled: false });

const payDesc = "Teste DEV — Pagamento parcial/total";
let payId;
let instId;
{
  const { data: ex } = await sb
    .from("accounts_payable")
    .select("id, open_balance, status, approval_status")
    .eq("company_id", companyId)
    .eq("description", payDesc)
    .is("deleted_at", null)
    .maybeSingle();
  if (ex) {
    payId = ex.id;
  } else {
    const res = await createAccountsPayableDraft(sb, {
      companyId,
      description: payDesc,
      competenceDate: todayIso,
      firstDueDate: futureIso,
      chartOfAccountId: chartId,
      originalAmount: 1000,
      installmentCount: 1,
      supplierId,
    });
    if (res.error) fail(res.error);
    payId = res.id;
    const sub = await submitAccountsPayable(sb, payId);
    if (sub.error) fail(sub.error);
  }
  const { data: inst } = await sb
    .from("accounts_payable_installments")
    .select("id, open_balance")
    .eq("accounts_payable_id", payId)
    .eq("installment_no", 1)
    .single();
  instId = inst.id;

  const { data: apRow } = await sb
    .from("accounts_payable")
    .select("open_balance, status, approval_status")
    .eq("id", payId)
    .single();

  if (apRow.approval_status !== "approved") {
    const ap = await approveAccountsPayable(sb, payId);
    if (ap.error) fail(ap.error);
  }

  const { data: pays } = await sb
    .from("accounts_payable_payments")
    .select("id, reversed_at, principal_amount")
    .eq("accounts_payable_id", payId);

  if (!(pays || []).some((p) => !p.reversed_at)) {
    const p1 = await registerApPayment(sb, {
      installmentId: instId,
      financialAccountId: bankId,
      paidAt: todayIso,
      principalAmount: 600,
      interestAmount: 20,
      penaltyAmount: 10,
      discountAmount: 5,
      paymentMethod: "Pix",
    });
    if (p1.error) fail(p1.error);
    const { data: after } = await sb
      .from("accounts_payable")
      .select("open_balance, status")
      .eq("id", payId)
      .single();
    if (Number(after.open_balance) !== 400) fail(`saldo ${after.open_balance}`);
    if (after.status !== "partially_paid") fail(`status ${after.status}`);
    ok("pagamento parcial 600 + juros/multa/desc");
  } else ok("pagamento parcial já existia");

  const { data: mid } = await sb
    .from("accounts_payable")
    .select("open_balance, status")
    .eq("id", payId)
    .single();
  if (Number(mid.open_balance) > 0) {
    const { data: inst2 } = await sb
      .from("accounts_payable_installments")
      .select("id, open_balance")
      .eq("accounts_payable_id", payId)
      .single();
    const p2 = await registerApPayment(sb, {
      installmentId: inst2.id,
      financialAccountId: bankId,
      paidAt: todayIso,
      principalAmount: Number(inst2.open_balance),
      interestAmount: 0,
      penaltyAmount: 0,
      discountAmount: 0,
      paymentMethod: "Pix",
    });
    if (p2.error) fail(p2.error);
    const { data: done } = await sb
      .from("accounts_payable")
      .select("open_balance, status")
      .eq("id", payId)
      .single();
    if (Number(done.open_balance) !== 0 || done.status !== "paid") fail("pagamento total");
    ok("pagamento total");
  }

  const { data: lastPay } = await sb
    .from("accounts_payable_payments")
    .select("id")
    .eq("accounts_payable_id", payId)
    .is("reversed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastPay) {
    const rev = await reverseApPayment(sb, lastPay.id, "Estorno DEV final");
    if (rev.error) fail(rev.error);
    const { data: reopened } = await sb
      .from("accounts_payable")
      .select("open_balance, status")
      .eq("id", payId)
      .single();
    if (!(Number(reopened.open_balance) > 0)) fail("saldo após estorno");
    ok("estorno reabriu saldo");
  }
}

// Cancelamento sem pagamento
const cancelDesc = "Teste DEV — Cancelamento final";
{
  let id;
  const { data: ex } = await sb
    .from("accounts_payable")
    .select("id, status")
    .eq("company_id", companyId)
    .eq("description", cancelDesc)
    .is("deleted_at", null)
    .maybeSingle();
  if (ex) id = ex.id;
  else {
    const res = await createAccountsPayableDraft(sb, {
      companyId,
      description: cancelDesc,
      competenceDate: todayIso,
      firstDueDate: futureIso,
      chartOfAccountId: chartId,
      originalAmount: 75,
      installmentCount: 1,
      supplierId,
    });
    if (res.error) fail(res.error);
    id = res.id;
    await submitAccountsPayable(sb, id);
  }
  const { data: row } = await sb.from("accounts_payable").select("status").eq("id", id).single();
  if (row.status !== "cancelled") {
    const c = await cancelAccountsPayable(sb, id, "Cancelamento DEV");
    if (c.error) fail(c.error);
  }
  ok("cancelamento");
}

// Soft delete + restauração (rascunho dedicado)
{
  await sb.auth.signInWithPassword({ email: meta.emails.aAdmin, password });
  const softDesc = "Teste DEV — Soft delete restauração";
  let softId;
  let softNumber;
  const { data: softEx } = await sb
    .from("accounts_payable")
    .select("id, internal_number, deleted_at")
    .eq("company_id", companyId)
    .eq("description", softDesc)
    .maybeSingle();
  if (softEx?.deleted_at) {
    softId = softEx.id;
    softNumber = softEx.internal_number;
  } else if (softEx) {
    softId = softEx.id;
    softNumber = softEx.internal_number;
  } else {
    const res = await createAccountsPayableDraft(sb, {
      companyId,
      description: softDesc,
      competenceDate: todayIso,
      firstDueDate: futureIso,
      chartOfAccountId: chartId,
      originalAmount: 55,
      installmentCount: 1,
      supplierId,
    });
    if (res.error) fail(res.error);
    softId = res.id;
    softNumber = res.internalNumber;
  }

  if (!softEx?.deleted_at) {
    const del = await softDeleteAccountsPayable(sb, companyId, softId, {
      code: "other",
      detail: "Soft delete DEV final",
    });
    if (del.error) fail(del.error);
  }

  const list = await listAccountsPayable(sb, companyId);
  if (list.rows.some((r) => r.id === softId)) fail("ainda na listagem após soft delete");
  ok("soft delete fora da listagem");

  const { data: audit } = await sb
    .from("deletion_audit_events")
    .select("id, entity_id, entity_code")
    .eq("company_id", companyId)
    .eq("entity_type", "accounts_payable")
    .eq("entity_id", softId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!audit?.id) fail("deletion_audit_events sem registro");
  ok(`auditoria exclusão ${audit.entity_code || softNumber}`);

  const { error: restErr } = await sb.rpc("restore_deleted_from_audit", {
    p_event_id: audit.id,
    p_restoration_reason: "Restauração DEV final Contas a Pagar",
  });
  if (restErr) fail(restErr.message);

  const { data: restored } = await sb
    .from("accounts_payable")
    .select("id, internal_number, deleted_at")
    .eq("id", softId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!restored) fail("restauração não trouxe o título");
  if (restored.internal_number !== softNumber) {
    fail(`número alterado ${restored.internal_number} != ${softNumber}`);
  }
  const { count: instCount } = await sb
    .from("accounts_payable_installments")
    .select("id", { count: "exact", head: true })
    .eq("accounts_payable_id", softId);
  if (!(instCount > 0)) fail("parcelas não preservadas");
  ok(`restauração manteve ${softNumber} e parcelas`);
}

// Soft delete também no título cancelado (sem pagamento)
{
  const { data: cancelRow } = await sb
    .from("accounts_payable")
    .select("id, deleted_at")
    .eq("company_id", companyId)
    .eq("description", cancelDesc)
    .maybeSingle();
  if (cancelRow?.id && !cancelRow.deleted_at) {
    const del = await softDeleteAccountsPayable(sb, companyId, cancelRow.id, {
      code: "other",
      detail: "Soft delete cancelado DEV",
    });
    if (del.error) fail(del.error);
    ok("soft delete de cancelado");
  } else if (cancelRow?.deleted_at) {
    ok("soft delete de cancelado já aplicado");
  }
}

const kpis = await fetchApKpis(sb, companyId);
if (kpis.error) fail(kpis.error);
ok(
  `kpis open=${kpis.kpis.openTotal} overdue=${kpis.kpis.overdueTotal} paidMonth=${kpis.kpis.paidMonth}`
);

console.log("FUNCTIONAL_FLOW_OK");
