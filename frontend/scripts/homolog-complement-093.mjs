/**
 * Homologação complementar autorizada no Logistics DEV jmbajdpkvlrslirwzyze.
 * Massa descartável na empresa HOM-092-ADMIN. Não altera a empresa A nem o Auth.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = {};
for (const line of fs.readFileSync(path.join(root, "frontend", ".env.local"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, i).trim()] = v;
}
const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (host !== "jmbajdpkvlrslirwzyze.supabase.co") throw new Error("ambiente recusado");

const A = "92c4c90d-6856-4c41-a9a1-9eba6a7468f6";
const B = "bcd3c6c9-0e4a-4356-addd-4af925725576";
const HOM = "9a6d4f09-6d7d-4d55-87c5-a92d101c9bc2";
const QA = "06017813-bde8-4802-afda-8936ad81f042";
const OS = "c6f11388-3dce-4f30-8065-3befad924247";
const DAY = "2026-11-24";

function client() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const results = [];
function record(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}
function denied(error) {
  const message = String(error?.message || error || "");
  return error?.code === "42501" || /42501|permission denied|permiss|autenticado|acesso/i.test(message);
}

async function session(email, type = "magiclink") {
  const link = await admin.auth.admin.generateLink({ type, email });
  if (link.error) throw new Error(`link ${email}: ${link.error.message}`);
  const user = client();
  const verified = await user.auth.verifyOtp({
    type,
    token_hash: link.data.properties.hashed_token,
  });
  if (verified.error) throw new Error(`otp ${email}: ${verified.error.message}`);
  return { user, userId: link.data.user.id };
}

const settingsA = await admin.from("company_financial_approval_settings").select("ap_approval_enabled, updated_at").eq("company_id", A).single();
const settingsB = await admin.from("company_financial_approval_settings").select("ap_approval_enabled, updated_at").eq("company_id", B).single();
const qaBefore = await admin.from("service_orders").select("updated_at").eq("id", QA).single();
const ap25 = await admin.from("accounts_payable").select("updated_at").eq("internal_number", "AP-00000025").maybeSingle();
const ftBefore = await admin.from("financial_transactions").select("id", { count: "exact", head: true }).eq("company_id", A);
const ledgerBefore = await admin.from("_dev_schema_migrations").select("filename, applied_at");

const adminLink = await session("dev.ap.a.admin@pscs.local");
const fin = await session("dev.ap.a.fin@pscs.local");
const adminB = await session("dev.ap.b.admin@pscs.local");
const anon = client();

const prior = await admin.from("accounts_payable").select("id").eq("company_id", HOM).eq("internal_number", "HOM-COMPLEMENT-AP").maybeSingle();
if (prior.data?.id) {
  await admin.from("accounts_payable_allocations").delete().eq("accounts_payable_id", prior.data.id);
  await admin.from("accounts_payable_installments").delete().eq("accounts_payable_id", prior.data.id);
  await admin.from("accounts_payable_postings").delete().eq("accounts_payable_id", prior.data.id);
  await admin.from("accounts_payable").delete().eq("id", prior.data.id);
}

const member = await admin.from("company_members").insert({
  company_id: HOM,
  user_id: adminLink.userId,
  role: "admin",
}).select("id").single();
const chart = await admin.from("chart_of_accounts").insert({
  company_id: HOM,
  name: "HOM-COMPLEMENT Despesa",
  classification: "Operacional",
  transaction_type: "Despesa",
  status: "Ativo",
}).select("id").single();
const supplier = await admin.from("suppliers").insert({
  company_id: HOM,
  code: "HOM-COMPLEMENT",
  name: "HOM-COMPLEMENT Fornecedor",
}).select("id").single();
const settings = await admin.from("company_financial_approval_settings").insert({
  company_id: HOM,
  ap_approval_enabled: true,
}).select("company_id").single();

const ap = await admin.from("accounts_payable").insert({
  company_id: HOM,
  internal_number: "HOM-COMPLEMENT-AP",
  description: "HOM-COMPLEMENT titulo descartavel",
  competence_date: DAY,
  entry_date: DAY,
  chart_of_account_id: chart.data?.id,
  original_amount: 9,
  net_amount: 9,
  open_balance: 9,
  status: "open",
  approval_status: "draft",
  supplier_id: supplier.data?.id,
}).select("id").single();
const installment = ap.data?.id ? await admin.from("accounts_payable_installments").insert({
  company_id: HOM,
  accounts_payable_id: ap.data.id,
  installment_no: 1,
  due_date: DAY,
  amount: 9,
  open_balance: 9,
  status: "open",
}).select("id").single() : { error: { message: "sem titulo" } };
const allocation = ap.data?.id ? await admin.from("accounts_payable_allocations").insert({
  company_id: HOM,
  accounts_payable_id: ap.data.id,
  line_no: 1,
  amount: 9,
  chart_of_account_id: chart.data?.id,
  service_order_id: null,
}) : { error: { message: "sem titulo" } };

const submitted = ap.data?.id
  ? await adminLink.user.rpc("submit_accounts_payable", { p_payable_id: ap.data.id })
  : { error: { message: "sem titulo" } };
const afterSubmit = ap.data?.id
  ? await admin.from("accounts_payable").select("approval_status").eq("id", ap.data.id).single()
  : { data: null };
const finApprove = ap.data?.id
  ? await fin.user.rpc("approve_accounts_payable", { p_payable_id: ap.data.id, p_review_note: "nao deve" })
  : { error: { message: "sem titulo" } };
const adminApprove = ap.data?.id && afterSubmit.data?.approval_status === "submitted"
  ? await adminLink.user.rpc("approve_accounts_payable", { p_payable_id: ap.data.id, p_review_note: "HOM-COMPLEMENT" })
  : { error: { message: "nao ficou submetido" } };
const afterApprove = ap.data?.id
  ? await admin.from("accounts_payable").select("approval_status, reviewed_by").eq("id", ap.data.id).single()
  : { data: null };
record("C-AP-MANUAL", !member.error && !chart.error && !supplier.error && !settings.error && !ap.error && !installment.error && !allocation.error && !submitted.error && afterSubmit.data?.approval_status === "submitted" && Boolean(finApprove.error) && !adminApprove.error && afterApprove.data?.approval_status === "approved" && afterApprove.data?.reviewed_by === adminLink.userId, {
  member: member.error?.message || member.data?.id,
  submit: submitted.error?.message || afterSubmit.data?.approval_status,
  fin: finApprove.error?.message || "aprovou",
  admin: adminApprove.error?.message || afterApprove.data?.approval_status,
});

const payableA = await admin.from("accounts_payable").select("id").eq("company_id", A).eq("internal_number", "HOM-E2E-AP").maybeSingle();
const postingsBefore = payableA.data?.id
  ? await admin.from("accounts_payable_postings").select("id", { count: "exact", head: true }).eq("accounts_payable_id", payableA.data.id)
  : { count: null };
const competence = payableA.data?.id
  ? await adminB.user.rpc("_ap_post_competence", { p_payable_id: payableA.data.id })
  : { error: { message: "sem titulo" } };
const postingsAfter = payableA.data?.id
  ? await admin.from("accounts_payable_postings").select("id", { count: "exact", head: true }).eq("accounts_payable_id", payableA.data.id)
  : { count: null };
const orderAssert = await adminB.user.rpc("_assert_service_order_member", { p_order_id: OS });
record("C-HELPERS", denied(competence.error) && denied(orderAssert.error) && postingsBefore.count === postingsAfter.count, {
  competence: competence.error?.message,
  order: orderAssert.error?.message,
  postings: postingsBefore.count,
});

const publicCalls = [
  ["get_public_driver_assignment", { p_token: "hom-complement-invalid" }],
  ["get_public_patio_ticket", { p_token: "hom-complement-invalid" }],
  ["respond_to_proposal", { p_token: "hom-complement-invalid", p_action: "recusar" }],
  ["respond_to_driver_assignment", { p_token: "hom-complement-invalid", p_action: "recusar" }],
];
const publicResults = [];
for (const [name, args] of publicCalls) {
  const response = await anon.rpc(name, args);
  publicResults.push({ name, denied: denied(response.error), error: response.error?.message || null, data: response.data ? "resposta" : null });
}
record("C-PUBLIC", publicResults.every((item) => !item.denied), publicResults);

let recoveryEmail = await anon.auth.resetPasswordForEmail("dev.ap.a.admin@pscs.local", {
  redirectTo: "https://logistics-ai-erp-dev.vercel.app/auth/callback",
});
if (/only request this after/i.test(recoveryEmail.error?.message || "")) {
  const wait = Number((recoveryEmail.error.message.match(/(\d+) seconds/) || [])[1] || 60);
  await new Promise((resolve) => setTimeout(resolve, (wait + 2) * 1000));
  recoveryEmail = await anon.auth.resetPasswordForEmail("dev.ap.a.admin@pscs.local", {
    redirectTo: "https://logistics-ai-erp-dev.vercel.app/auth/callback",
  });
}
const recovery = await session("dev.ap.a.admin@pscs.local", "recovery");
const recoveryUser = await recovery.user.auth.getUser();
const recoverySession = recoveryUser.data.user?.id === recovery.userId && recoveryUser.data.user?.email === "dev.ap.a.admin@pscs.local";
const recoveryMail = !recoveryEmail.error || /invalid/i.test(recoveryEmail.error?.message || "");
record("C-RECOVERY", recoveryMail && recoverySession, {
  email: recoveryEmail.error?.message || "aceito",
  session: recoveryUser.data.user?.email || recoveryUser.error?.message,
});

const massRows = await admin.from("financial_transactions").select("id, amount, transaction_type, approval_status, entry_source, service_order_id, description").eq("company_id", A).or(`service_order_id.eq.${OS},and(entry_source.eq.parking,description.ilike.%HOM-E2E-PATIO%)`);
const dashboard = await admin.from("financial_transactions").select("amount, transaction_type").eq("company_id", A).eq("approval_status", "approved").gte("transaction_date", "2020-01-01").lte("transaction_date", "2026-12-31");
const dashboardNet = (dashboard.data || []).reduce((sum, row) => sum + Number(row.amount) * (row.transaction_type === "Receita" ? 1 : -1), 0);
const mass = (massRows.data || []).filter((row) => row.approval_status === "approved");
const osExpense = mass.filter((row) => row.service_order_id === OS && row.transaction_type === "Despesa").reduce((sum, row) => sum + Number(row.amount), 0);
const patio = mass.filter((row) => row.entry_source === "parking" && row.transaction_type === "Receita").reduce((sum, row) => sum + Number(row.amount), 0);
const consolidated = 100 - osExpense + patio;
record("C-DRE", consolidated === 78 && dashboardNet !== 78 && !dashboard.error, {
  osExpense,
  patio,
  consolidated,
  dashboardNet: Math.round(dashboardNet * 100) / 100,
  dashboardRows: dashboard.data?.length ?? 0,
});

if (ap.data?.id) {
  await adminLink.user.rpc("reverse_accounts_payable_postings", { p_payable_id: ap.data.id, p_reason: "HOM-COMPLEMENT limpeza" });
  const removedAllocations = await admin.from("accounts_payable_allocations").delete().eq("accounts_payable_id", ap.data.id);
  const removedInstallments = await admin.from("accounts_payable_installments").delete().eq("accounts_payable_id", ap.data.id);
  const removedPostings = await admin.from("accounts_payable_postings").delete().eq("accounts_payable_id", ap.data.id);
  const removedPayable = await admin.from("accounts_payable").delete().eq("id", ap.data.id);
  if (removedAllocations.error || removedInstallments.error || removedPostings.error || removedPayable.error) {
    record("C-CLEANUP", false, {
      allocations: removedAllocations.error?.message,
      installments: removedInstallments.error?.message,
      postings: removedPostings.error?.message,
      payable: removedPayable.error?.message,
    });
  }
}
if (settings.data?.company_id) await admin.from("company_financial_approval_settings").delete().eq("company_id", HOM);
if (supplier.data?.id) await admin.from("suppliers").delete().eq("id", supplier.data.id);
if (chart.data?.id) await admin.from("chart_of_accounts").delete().eq("id", chart.data.id);
if (member.data?.id) await admin.from("company_members").delete().eq("id", member.data.id);

const settingsAAfter = await admin.from("company_financial_approval_settings").select("ap_approval_enabled, updated_at").eq("company_id", A).single();
const settingsBAfter = await admin.from("company_financial_approval_settings").select("ap_approval_enabled, updated_at").eq("company_id", B).single();
const qaAfter = await admin.from("service_orders").select("updated_at").eq("id", QA).single();
const ap25After = await admin.from("accounts_payable").select("updated_at").eq("internal_number", "AP-00000025").maybeSingle();
const ftAfter = await admin.from("financial_transactions").select("id", { count: "exact", head: true }).eq("company_id", A);
const ledgerAfter = await admin.from("_dev_schema_migrations").select("filename, applied_at");
const homLeft = await admin.from("accounts_payable").select("id").eq("company_id", HOM).eq("internal_number", "HOM-COMPLEMENT-AP");
const preserved = settingsAAfter.data?.updated_at === settingsA.data?.updated_at
  && settingsAAfter.data?.ap_approval_enabled === false
  && settingsBAfter.data?.updated_at === settingsB.data?.updated_at
  && settingsBAfter.data?.ap_approval_enabled === false
  && qaAfter.data?.updated_at === qaBefore.data?.updated_at
  && ap25After.data?.updated_at === ap25.data?.updated_at
  && ftAfter.count === ftBefore.count
  && ledgerAfter.data?.length === 93
  && ledgerBefore.data?.length === 93
  && (homLeft.data || []).length === 0;
record("C-PRESERVED", preserved, {
  settingsA: settingsAAfter.data?.updated_at,
  settingsB: settingsBAfter.data?.updated_at,
  ledger: ledgerAfter.data?.length,
  financialRows: ftAfter.count,
  homLeft: homLeft.data?.length ?? 0,
});

const failed = results.filter((item) => !item.pass);
console.log(JSON.stringify({ failed: failed.map((item) => item.id), total: results.length }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
