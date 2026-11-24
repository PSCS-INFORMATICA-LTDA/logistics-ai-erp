/**
 * Reteste pós-093 e cadeia E01–E12 sem E07B/E08B.
 * DEV jmbajdpkvlrslirwzyze. Não reaplica migration. Não usa produção nem o Core.
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
const QA = "06017813-bde8-4802-afda-8936ad81f042";
const DAY = "2026-11-24";
const PEDAGIO = "bb6a2f83-751e-4091-8025-f37fa2fd0195";
const CONSULTORIA = "fd5963da-2c57-45f0-9131-f4895ed80b92";
const RECEITA = "6a278578-fc35-45ff-b050-1c51ad401a95";
const CAIXA = "a7c3fb45-b0b1-4455-9592-9fd4a0a2e73a";
const DRIVER_1 = "08326e3c-b04f-4cb2-a483-b901437f8ac8";
const DRIVER_2 = "2e57248d-26f0-4670-b160-6538dfd9c40d";

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
  return error?.code === "42501" || /42501|permission denied|permiss|autenticado/i.test(message);
}

async function session(email) {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`link ${email}: ${link.error.message}`);
  const user = client();
  const verified = await user.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.data.properties.hashed_token,
  });
  if (verified.error) throw new Error(`otp ${email}: ${verified.error.message}`);
  return user;
}

const qaBefore = await admin.from("service_orders").select("updated_at").eq("id", QA).single();
const audit089Before = await admin.from("deletion_audit_events").select("id", { count: "exact", head: true }).eq("screen_key", "homolog.089");
const ap25Before = await admin.from("accounts_payable").select("id, updated_at, net_amount").eq("internal_number", "AP-00000025").maybeSingle();

const adminA = await session("dev.ap.a.admin@pscs.local");
const fin = await session("dev.ap.a.fin@pscs.local");
const oper = await session("rafael.homolog@pscs.test");
const adminB = await session("dev.ap.b.admin@pscs.local");
const anon = client();

const ledger = await admin.from("_dev_schema_migrations").select("filename");
const names = new Set((ledger.data || []).map((row) => row.filename));
record("R-LEDGER", !ledger.error && ledger.data.length === 93 && names.size === 93 && names.has("093_residual_search_path_and_helpers.sql") && names.has("092_chart_seed_finance_guard.sql"), {
  rows: ledger.data?.length,
  names: names.size,
});

const helper = await adminA.rpc("_ap_assert_company_member", { p_company_id: A });
record("R-HELPER", denied(helper.error), helper.error?.message || "chamada direta passou");

const pub = await anon.rpc("get_public_proposal", { p_token: "x" });
record("R-PUBLIC", !denied(pub.error), pub.error?.message || "anon executou o endpoint");

const accountsBefore = await admin.from("chart_of_accounts").select("id", { count: "exact", head: true }).eq("company_id", A);
const seedAdmin = await adminA.rpc("seed_chart_of_accounts", { p_company_id: A });
const accountsAfter = await admin.from("chart_of_accounts").select("id", { count: "exact", head: true }).eq("company_id", A);
record("R-SEED-ADMIN", !seedAdmin.error && accountsBefore.count === accountsAfter.count, {
  returned: seedAdmin.data,
  before: accountsBefore.count,
  after: accountsAfter.count,
  error: seedAdmin.error?.message,
});
const seedOper = await oper.rpc("seed_chart_of_accounts", { p_company_id: A });
record("R-SEED-OPER", denied(seedOper.error), seedOper.error?.message || "operacional semeou");

const ratesBefore = await admin.from("freight_rate_tables").select("id", { count: "exact", head: true }).eq("company_id", A);
const rates = await oper.rpc("seed_freight_rate_defaults", { p_company_id: A });
const ratesAfter = await admin.from("freight_rate_tables").select("id", { count: "exact", head: true }).eq("company_id", A);
record("R-RATES", !rates.error && ratesBefore.count === ratesAfter.count, {
  returned: rates.data,
  before: ratesBefore.count,
  after: ratesAfter.count,
  error: rates.error?.message,
});

const completeDenied = await oper.rpc("complete_service_order", { p_order_id: "00000000-0000-4000-8000-000000000000" });
record("R-OS-RPC", Boolean(completeDenied.error) && !/permission denied for function public\._assert_service_order_member/i.test(completeDenied.error.message), completeDenied.error?.message);

const mandatory = results.filter((row) => row.id.startsWith("R-"));
if (mandatory.some((row) => !row.pass)) {
  console.log(JSON.stringify({ stopped: true, results }, null, 2));
  process.exit(1);
}

const own = await oper.from("companies").select("id");
record("E12", (own.data || []).some((row) => row.id === A) && !(own.data || []).some((row) => row.id === B), `empresas=${own.data?.length ?? 0}`);

let clientRow = (await admin.from("clients").select("id").eq("company_id", A).eq("code", "88000024").maybeSingle()).data;
if (!clientRow) {
  const inserted = await oper.from("clients").insert({
    company_id: A,
    code: "88000024",
    name: "HOM-E2E Cliente",
    document: "88000024000124",
    status: "Ativo",
  }).select("id").single();
  record("E01-INSERT", !inserted.error, inserted.error?.message || inserted.data.id);
  clientRow = inserted.data;
} else {
  record("E01-INSERT", true, "cliente já existia");
}
const seenByB = await adminB.from("clients").select("id").eq("id", clientRow.id);
record("E01", Boolean(clientRow?.id) && (seenByB.data || []).length === 0, {
  id: clientRow?.id,
  visibleToB: seenByB.data?.length ?? 0,
});
record("E11-CLIENT", (seenByB.data || []).length === 0, "empresa B não lê o cliente");

let order = (await admin.from("service_orders").select("id, code, proposal_token, driver_assignment_token, proposal_response, driver_assignment_response, status, freight_agreed_amount").eq("company_id", A).eq("code", "HOM-E2E-OS").maybeSingle()).data;
if (!order) {
  const inserted = await oper.from("service_orders").insert({
    company_id: A,
    code: "HOM-E2E-OS",
    service_name: "Frete HOM-E2E",
    service_type: "Frete",
    service_date: DAY,
    plate: "HOM0E01",
    service_amount: 100,
    freight_agreed_amount: 100,
    client_id: clientRow.id,
    client_name: "HOM-E2E Cliente",
    chart_of_account_id: RECEITA,
    status: "Aberto",
  }).select("id, code").single();
  record("E03", !inserted.error, inserted.error?.message || inserted.data);
  order = inserted.data;
} else {
  record("E03", true, "OS já existia");
}

const proposalNow = await admin.from("service_orders").select("proposal_response, proposal_token").eq("id", order.id).single();
const sent = proposalNow.data?.proposal_response === "accepted"
  ? { error: null }
  : await oper.rpc("mark_proposal_sent", { p_order_id: order.id });
record("E02-SEND", !sent.error, sent.error?.message || "enviada");
const tokenRow = proposalNow.data?.proposal_response === "accepted"
  ? proposalNow
  : await admin.from("service_orders").select("proposal_token").eq("id", order.id).single();
const accept = proposalNow.data?.proposal_response === "accepted"
  ? { error: null }
  : await anon.rpc("respond_to_proposal", { p_token: tokenRow.data.proposal_token, p_action: "accept" });
const acceptAgain = await anon.rpc("respond_to_proposal", { p_token: tokenRow.data.proposal_token, p_action: "accept" });
const shortToken = await anon.rpc("get_public_proposal", { p_token: "curto" });
const proposal = await admin.from("service_orders").select("proposal_response").eq("id", order.id).single();
record("E02", proposal.data?.proposal_response === "accepted" && Boolean(acceptAgain.error) && !denied(shortToken.error) && shortToken.data?.found === false, {
  response: proposal.data?.proposal_response,
  first: accept.error?.message || "ok",
  reuse: acceptAgain.error?.message,
  short: shortToken.error?.message || shortToken.data || "vazio",
});

const driverStateNow = await admin.from("service_orders").select("driver_id, driver_assignment_response, status").eq("id", order.id).single();
if (driverStateNow.data?.driver_id === DRIVER_2 && driverStateNow.data?.driver_assignment_response === "accepted") {
  record("E04", true, "designação final já confirmada");
} else {
const assign = await oper.rpc("send_driver_assignment", {
  p_order_id: order.id,
  p_driver_id: DRIVER_1,
  p_driver_pay_amount: 20,
  p_assistant_pay_amount: 0,
});
const driverToken = await admin.from("service_orders").select("driver_assignment_token").eq("id", order.id).single();
const driverAccept = await anon.rpc("respond_to_driver_assignment", {
  p_token: driverToken.data.driver_assignment_token,
  p_action: "accept",
});
const reassign = await oper.rpc("reassign_accepted_service_order_driver", {
  p_order_id: order.id,
  p_driver_id: DRIVER_2,
  p_driver_pay_amount: 20,
  p_assistant_pay_amount: 0,
});
const secondToken = reassign.data?.token;
const secondAccept = await anon.rpc("respond_to_driver_assignment", { p_token: secondToken, p_action: "accept" });
const driverState = await admin.from("service_orders").select("driver_id, driver_assignment_response").eq("id", order.id).single();
record("E04", driverState.data?.driver_id === DRIVER_2 && driverState.data?.driver_assignment_response === "accepted", {
  assign: assign.error?.message || "ok",
  firstAccept: driverAccept.error?.message || "ok",
  reassign: reassign.error?.message || "ok",
  secondAccept: secondAccept.error?.message || "ok",
  state: driverState.data,
});
}

const orderStatusBefore = await admin.from("service_orders").select("status").eq("id", order.id).single();
const completed = orderStatusBefore.data?.status === "Concluido"
  ? { error: null }
  : await oper.rpc("complete_service_order", { p_order_id: order.id });
const orderStatus = await admin.from("service_orders").select("status").eq("id", order.id).single();
record("E05-OS", orderStatus.data?.status === "Concluido", completed.error?.message || orderStatus.data?.status);

let parking = (await admin.from("parking_entries").select("id, financial_transaction_id").eq("company_id", A).eq("code", "HOM-E2E-PATIO").maybeSingle()).data;
if (!parking) {
  const inserted = await oper.from("parking_entries").insert({
    company_id: A,
    code: "HOM-E2E-PATIO",
    plate: "HOM0E01",
    entry_date: DAY,
    exit_date: DAY,
    total_amount: 8,
    status: "Finalizado",
  }).select("id").single();
  parking = inserted.data;
  record("E05-PATIO-INSERT", !inserted.error, inserted.error?.message || parking?.id);
}
if (!parking?.id) {
  record("E05", false, "entrada de pátio não criada");
} else {
const posted = parking.financial_transaction_id
  ? { error: null }
  : await fin.rpc("post_parking_revenue", { p_entry_id: parking.id });
const patioTx = await admin.from("parking_entries").select("financial_transaction_id").eq("id", parking.id).single();
const patioRow = await admin.from("financial_transactions").select("amount, transaction_type, approval_status, service_order_id, entry_source").eq("id", patioTx.data.financial_transaction_id).single();
record("E05", !posted.error && Number(patioRow.data?.amount) === 8 && patioRow.data?.transaction_type === "Receita" && patioRow.data?.approval_status === "approved" && patioRow.data?.service_order_id == null, {
  error: posted.error?.message,
  patio: patioRow.data,
});
}

const existingToll = (await admin.from("financial_transactions").select("id, approval_status").eq("company_id", A).eq("service_order_id", order.id).eq("chart_of_account_id", PEDAGIO).eq("entry_source", "vehicle_expense").maybeSingle()).data;
const toll = existingToll
  ? { error: null, data: existingToll }
  : await fin.from("financial_transactions").insert({
  company_id: A,
  transaction_date: DAY,
  amount: 10,
  chart_of_account_id: PEDAGIO,
  classification: "Administrativo",
  transaction_type: "Despesa",
  service_order_id: order.id,
  service_date: DAY,
  description: "HOM-E2E pedagio",
  entry_source: "vehicle_expense",
}).select("id").single();
const tollAgain = await fin.from("financial_transactions").insert({
  company_id: A,
  transaction_date: DAY,
  amount: 10,
  chart_of_account_id: PEDAGIO,
  classification: "Administrativo",
  transaction_type: "Despesa",
  service_order_id: order.id,
  service_date: DAY,
  description: "HOM-E2E pedagio duplicado",
  entry_source: "vehicle_expense",
}).select("id").single();
const tollApproved = toll.data?.id
  ? await adminA.from("financial_transactions").update({
      approval_status: "approved",
      review_note: "Homologacao E2E",
    }).eq("id", toll.data.id).eq("approval_status", "submitted")
  : { error: { message: "sem pedagio" } };
const driverPay = await fin.rpc("mark_driver_payment_paid", { p_order_id: order.id });
const driverPaid = !driverPay.error || /já registrado/i.test(driverPay.error.message);
record("E06", !toll.error && Boolean(tollAgain.error) && !tollApproved.error && driverPaid, {
  toll: toll.error?.message || toll.data?.id,
  duplicate: tollAgain.error?.code || tollAgain.error?.message,
  approved: tollApproved.error?.message || "ok",
  driver: driverPay.error?.message || "ok",
});

const apExisting = await admin.from("accounts_payable").select("id").eq("company_id", A).eq("internal_number", "HOM-E2E-AP").maybeSingle();
let payableId = apExisting.data?.id;
if (!payableId) {
  const ap = await fin.from("accounts_payable").insert({
    company_id: A,
    internal_number: "HOM-E2E-AP",
    description: "HOM-E2E titulo avulso",
    competence_date: DAY,
    entry_date: DAY,
    chart_of_account_id: CONSULTORIA,
    original_amount: 15,
    net_amount: 15,
    open_balance: 15,
    status: "open",
    approval_status: "draft",
    supplier_id: "bbba1079-bd32-4b3f-951f-e2d4b25de9ff",
  }).select("id").single();
  payableId = ap.data?.id;
  const inst = payableId ? await fin.from("accounts_payable_installments").insert({
    company_id: A,
    accounts_payable_id: payableId,
    installment_no: 1,
    due_date: DAY,
    amount: 15,
    open_balance: 15,
    status: "open",
  }).select("id").single() : { error: { message: "sem titulo" } };
  const alloc = payableId ? await fin.from("accounts_payable_allocations").insert({
    company_id: A,
    accounts_payable_id: payableId,
    line_no: 1,
    amount: 15,
    chart_of_account_id: CONSULTORIA,
    service_order_id: null,
  }) : { error: { message: "sem titulo" } };
  record("E07A-INSERT", !ap.error && !inst.error && !alloc.error, ap.error?.message || inst.error?.message || alloc.error?.message || payableId);
}
const apState = payableId
  ? (await admin.from("accounts_payable").select("approval_status").eq("id", payableId).single()).data
  : null;
const submitted = apState && apState.approval_status !== "draft"
  ? { error: null, data: { approval_status: apState.approval_status } }
  : await fin.rpc("submit_accounts_payable", { p_payable_id: payableId });
const finApprove = apState?.approval_status === "approved"
  ? { error: { message: "Título já aprovado pela configuração da empresa" } }
  : await fin.rpc("approve_accounts_payable", { p_payable_id: payableId, p_review_note: "nao deve" });
const seenAp = await adminB.from("accounts_payable").select("id").eq("id", payableId);
record("E07A", !submitted.error && (seenAp.data || []).length === 0 && (denied(finApprove.error) || /já aprovado/i.test(finApprove.error?.message || "")), {
  submit: submitted.error?.message || submitted.data,
  fin: finApprove.error?.message,
  visibleToB: seenAp.data?.length ?? 0,
  note: "A empresa A está com aprovação desligada; o envio chama a aprovação automática.",
});

const postingNow = payableId
  ? (await admin.from("accounts_payable_postings").select("reversed_at, financial_transaction_id").eq("accounts_payable_id", payableId)).data || []
  : [];
const alreadyReversed = Boolean(postingNow[0]?.reversed_at);
const adminApprove = alreadyReversed
  ? { error: null }
  : await adminA.rpc("approve_accounts_payable", { p_payable_id: payableId, p_review_note: "Homologacao E2E" });
const installment = payableId
  ? await admin.from("accounts_payable_installments").select("id").eq("accounts_payable_id", payableId).maybeSingle()
  : { data: null };
if (!installment.data?.id) {
  record("E08A", false, "parcela ausente");
} else {
const payment = alreadyReversed
  ? { error: null }
  : await adminA.rpc("register_accounts_payable_payment", {
  p_installment_id: installment.data.id,
  p_financial_account_id: CAIXA,
  p_paid_at: DAY,
  p_principal_amount: 15,
});
const reversal = alreadyReversed
  ? { error: null, data: { ok: true, reused: true } }
  : await adminA.rpc("reverse_accounts_payable_postings", {
  p_payable_id: payableId,
  p_reason: "Homologacao E2E estorno",
});
const apFinal = await admin.from("accounts_payable").select("net_amount, approval_status").eq("id", payableId).single();
const posting = await admin.from("accounts_payable_postings").select("reversed_at, financial_transaction_id").eq("accounts_payable_id", payableId);
const apTx = posting.data?.[0]?.financial_transaction_id
  ? await admin.from("financial_transactions").select("approval_status, amount, service_order_id").eq("id", posting.data[0].financial_transaction_id).single()
  : { data: null };
record("E08A", (alreadyReversed || !adminApprove.error || /já aprovado/i.test(adminApprove.error?.message || "")) && !payment.error && !reversal.error && Number(apFinal.data?.net_amount) === 15 && apTx.data?.approval_status === "cancelled" && Boolean(posting.data?.[0]?.reversed_at) && apTx.data?.service_order_id == null, {
  approve: adminApprove.error?.message || "ok",
  pay: payment.error?.message || "ok",
  reverse: reversal.error?.message || reversal.data,
  amount: apFinal.data?.net_amount,
  tx: apTx.data,
  reversedAt: posting.data?.[0]?.reversed_at,
});
}

const chain = await admin.from("financial_transactions").select("amount, transaction_type, approval_status, entry_source, service_order_id, description").eq("company_id", A).or(`service_order_id.eq.${order.id},description.ilike.HOM-E2E%,entry_source.eq.parking,entry_source.eq.accounts_payable`);
const approved = (chain.data || []).filter((row) => row.approval_status === "approved");
const osRevenue = 100;
const osExpense = approved.filter((row) => row.service_order_id === order.id && row.transaction_type === "Despesa").reduce((sum, row) => sum + Number(row.amount), 0);
const patio = approved.filter((row) => row.entry_source === "parking" && Number(row.amount) === 8).reduce((sum, row) => sum + Number(row.amount), 0);
const osResult = osRevenue - osExpense;
const consolidated = osResult + patio;
record("E09", osResult === 70 && patio === 8 && consolidated === 78, {
  osResult,
  patio,
  consolidated,
  lines: approved.map((row) => ({
    amount: row.amount,
    type: row.transaction_type,
    source: row.entry_source,
    order: row.service_order_id,
  })),
});

const priorAudit = await admin.from("deletion_audit_events").select("id").eq("screen_key", "homolog.e2e").limit(1);
if ((priorAudit.data || []).length > 0) {
  record("E10", true, { reused: priorAudit.data[0].id });
} else {
const auditRow = await adminA.from("financial_transactions").insert({
  company_id: A,
  transaction_date: DAY,
  amount: 1,
  chart_of_account_id: CONSULTORIA,
  classification: "Operacional",
  transaction_type: "Despesa",
  description: "HOM-E2E auditoria",
  entry_source: "company_ledger",
}).select("id").single();
const removed = auditRow.data?.id
  ? await adminA.rpc("delete_financial_transaction_audited", {
      p_id: auditRow.data.id,
      p_reason: "Homologacao E2E descartavel",
      p_reason_code: "other",
      p_screen_key: "homolog.e2e",
    })
  : { error: { message: "sem linha" } };
const event = await admin.from("deletion_audit_events").select("id").eq("screen_key", "homolog.e2e").order("occurred_at", { ascending: false }).limit(1);
const restored = event.data?.[0]?.id
  ? await adminA.rpc("restore_deleted_from_audit", {
      p_event_id: event.data[0].id,
      p_restoration_reason: "Homologacao E2E restaura",
    })
  : { error: { message: "sem evento" } };
const eventAfter = event.data?.[0]?.id
  ? await admin.from("deletion_audit_events").select("id").eq("id", event.data[0].id)
  : { data: [] };
record("E10", !auditRow.error && !removed.error && !restored.error && (eventAfter.data || []).length === 1, {
  insert: auditRow.error?.message || auditRow.data?.id,
  remove: removed.error?.message || "ok",
  restore: restored.error?.message || "ok",
  eventKept: eventAfter.data?.length ?? 0,
});
}

const bOrder = await adminB.from("service_orders").select("id").eq("id", order.id);
const bTx = await adminB.from("financial_transactions").select("id").eq("service_order_id", order.id);
const bRates = await adminB.rpc("seed_freight_rate_defaults", { p_company_id: A });
record("E11", (bOrder.data || []).length === 0 && (bTx.data || []).length === 0 && denied(bRates.error), {
  order: bOrder.data?.length ?? 0,
  tx: bTx.data?.length ?? 0,
  rates: bRates.error?.message,
});

const qaAfter = await admin.from("service_orders").select("updated_at").eq("id", QA).single();
const audit089After = await admin.from("deletion_audit_events").select("id", { count: "exact", head: true }).eq("screen_key", "homolog.089");
const ap25After = ap25Before.data?.id
  ? await admin.from("accounts_payable").select("updated_at, net_amount").eq("id", ap25Before.data.id).single()
  : { data: null };
record("PRESERVE", qaBefore.data?.updated_at === qaAfter.data?.updated_at && audit089Before.count === audit089After.count && ap25Before.data?.updated_at === ap25After.data?.updated_at, {
  qaBefore: qaBefore.data?.updated_at,
  qaAfter: qaAfter.data?.updated_at,
  audit089Before: audit089Before.count,
  audit089After: audit089After.count,
  ap25Before: ap25Before.data?.updated_at,
  ap25After: ap25After.data?.updated_at,
});

const failed = results.filter((row) => !row.pass).map((row) => row.id);
console.log(JSON.stringify({ failed, total: results.length }, null, 2));
if (failed.length) process.exit(1);
