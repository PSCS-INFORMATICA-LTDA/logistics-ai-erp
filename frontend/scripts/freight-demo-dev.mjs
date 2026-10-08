/**
 * Fixture DEV da jornada de frete PSCS_LOGISTICS_FREIGHT_DEMO_001.
 * Fail-closed fora de jmbajdpkvlrslirwzyze. Não imprime senha, chave ou token.
 *
 * A OS fica na company Logistics já mapeada no PSCS One DEV.
 * O ator é o admin dessa company. A company de isolamento não entra na jornada.
 *
 * Rollback somente desta fixture, no DEV, não executado por este script:
 *   update public.service_orders
 *     set driver_payment_driver_transaction_id = null,
 *         driver_payment_assistant_transaction_id = null,
 *         driver_payment_paid_at = null
 *     where code = 'PSCS-FREIGHT-DEMO-001'
 *       and notes = 'PSCS_LOGISTICS_FREIGHT_DEMO_001';
 *   delete from public.financial_transactions
 *     where service_order_id in (
 *       select id from public.service_orders
 *       where code = 'PSCS-FREIGHT-DEMO-001'
 *         and notes = 'PSCS_LOGISTICS_FREIGHT_DEMO_001'
 *     );
 *   delete from public.service_orders
 *     where code = 'PSCS-FREIGHT-DEMO-001'
 *       and notes = 'PSCS_LOGISTICS_FREIGHT_DEMO_001';
 *
 * Uso (cwd=frontend):
 *   node scripts/freight-demo-dev.mjs seed
 *   node scripts/freight-demo-dev.mjs verify
 *
 * Exige NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e
 * DEV_SEED_PASSWORD no ambiente ou em .env.local. Não versionar esses valores.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const OFFICIAL_DEV_REF = "jmbajdpkvlrslirwzyze";
export const PROD_REF = "tqeenmswotxqainkyyct";
export const MARKER = "PSCS_LOGISTICS_FREIGHT_DEMO_001";
export const ORDER_CODE = "PSCS-FREIGHT-DEMO-001";
export const TARGET_COMPANY_ID = "bcd3c6c9-0e4a-4356-addd-4af925725576";
export const TARGET_CLIENT_ID = "8583bec2-0faa-4576-96dc-04ff0cf6d48e";
export const DEMO_EMAIL = "dev.ap.b.admin@pscs.local";
export const PROPOSAL_AMOUNT = 800;
export const DRIVER_EXPENSE_AMOUNT = 150;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function refFromUrl(url) {
  const match = String(url || "").trim().match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  return match?.[1] ?? null;
}

export function assertDevTarget(url) {
  const ref = refFromUrl(url);
  if (ref === PROD_REF) {
    throw new Error("freight demo aborted: production supabase is forbidden");
  }
  if (ref !== OFFICIAL_DEV_REF) {
    throw new Error("freight demo aborted: target is not Logistics DEV");
  }
  return ref;
}

function fail(message) {
  console.error("freight-demo-dev FALHOU:", message);
  process.exit(1);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

function readConfig() {
  const fileEnv = loadEnvFile(path.join(__dirname, "..", ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const password = process.env.DEV_SEED_PASSWORD || fileEnv.DEV_SEED_PASSWORD;
  assertDevTarget(url);
  if (!anon) fail("NEXT_PUBLIC_SUPABASE_ANON_KEY ausente");
  if (!password) fail("DEV_SEED_PASSWORD ausente");
  return { url, anon, password };
}

async function signIn(config) {
  const supabase = createClient(config.url, config.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: config.password,
  });
  if (error) fail("login da fixture DEV");
  return supabase;
}

async function demoContext(supabase) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) fail("sessão da fixture DEV");

  const { data: membership, error: memberError } = await supabase
    .from("company_members")
    .select("company_id, role, user_id")
    .eq("company_id", TARGET_COMPANY_ID)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (memberError || !membership || membership.company_id !== TARGET_COMPANY_ID) {
    fail("sessão sem membership na company mapeada");
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name, company_id, status")
    .eq("id", TARGET_CLIENT_ID)
    .eq("company_id", TARGET_COMPANY_ID)
    .eq("status", "Ativo")
    .maybeSingle();
  if (clientError || !client || client.id !== TARGET_CLIENT_ID) {
    fail("cliente mapeado ausente na company alvo");
  }

  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("id")
    .eq("company_id", TARGET_COMPANY_ID)
    .eq("status", "Ativo")
    .is("deleted_at", null)
    .order("code")
    .limit(1)
    .maybeSingle();
  if (driverError || !driver) fail("motorista DEV da company");

  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .select("id, plate")
    .eq("company_id", TARGET_COMPANY_ID)
    .eq("status", "Ativo")
    .is("deleted_at", null)
    .order("code")
    .limit(1)
    .maybeSingle();
  if (vehicleError || !vehicle) fail("veículo DEV da company");

  const { data: account } = await supabase
    .from("chart_of_accounts")
    .select("id")
    .eq("company_id", TARGET_COMPANY_ID)
    .eq("name", "Receita Caminhão")
    .eq("status", "Ativo")
    .limit(1)
    .maybeSingle();

  return { companyId: TARGET_COMPANY_ID, client, driver, vehicle, chartOfAccountId: account?.id ?? null };
}

async function findOrder(supabase) {
  const { data, error } = await supabase
    .from("service_orders")
    .select(
      "id, company_id, code, service_type, status, vehicle_id, driver_id, client_name, service_amount, freight_agreed_amount, proposal_response, proposal_token, driver_assignment_response, notes"
    )
    .eq("company_id", TARGET_COMPANY_ID)
    .eq("code", ORDER_CODE)
    .eq("notes", MARKER)
    .maybeSingle();
  if (error) fail(error.message);
  return data;
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

async function driverExpense(supabase, orderId) {
  const { data, error } = await supabase
    .from("financial_transactions")
    .select("id, transaction_type, amount, service_order_id")
    .eq("service_order_id", orderId)
    .eq("company_id", TARGET_COMPANY_ID)
    .eq("transaction_type", "Despesa");
  if (error) fail(error.message);
  return data ?? [];
}

function printSummary(order, expense) {
  console.log(JSON.stringify({
    marker: MARKER,
    order_id: order.id,
    company_id: order.company_id,
    client_id: TARGET_CLIENT_ID,
    service_type: order.service_type,
    status: order.status,
    proposal_amount: money(order.freight_agreed_amount),
    proposal_response: order.proposal_response,
    proposal_token_present: Boolean(order.proposal_token && order.proposal_token.length >= 32),
    driver_assigned: Boolean(order.driver_id),
    vehicle_assigned: Boolean(order.vehicle_id),
    assignment_response: order.driver_assignment_response,
    financial_transaction_type: expense?.transaction_type ?? null,
    financial_transaction_amount: expense ? money(expense.amount) : null,
    financial_transaction_linked_to_os: expense?.service_order_id === order.id,
  }));
}

async function assertJourney(supabase, ctx, order) {
  if (!order) fail("fixture ausente");
  if (order.company_id !== TARGET_COMPANY_ID) fail("OS fora da company mapeada");
  if (order.client_name !== ctx.client.name) fail("cliente da OS não é o cliente mapeado");
  if (order.service_type !== "Frete") fail("tipo diferente de Frete");
  if (order.status !== "Concluido") fail("OS não concluída");
  if (money(order.freight_agreed_amount) !== PROPOSAL_AMOUNT) fail("proposta diferente de 800");
  if (money(order.service_amount) !== PROPOSAL_AMOUNT) fail("valor do serviço diferente de 800");
  if (order.proposal_response !== "accepted") fail("proposta não aceita");
  if (!order.proposal_token) fail("token de proposta ausente");
  if (!order.driver_id || order.driver_assignment_response !== "accepted") fail("motorista não confirmado");
  if (!order.vehicle_id) fail("veículo não associado");
  const expenses = await driverExpense(supabase, order.id);
  const expense = expenses.find((row) => money(row.amount) === DRIVER_EXPENSE_AMOUNT);
  if (!expense || expense.service_order_id !== order.id) fail("lançamento de despesa do motorista ausente");
  printSummary(order, expense);
}

export async function runSeed(supabase) {
  const ctx = await demoContext(supabase);
  const existing = await findOrder(supabase);
  if (existing) {
    console.log("reused=YES");
    await assertJourney(supabase, ctx, existing);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: created, error: insertError } = await supabase
    .from("service_orders")
    .insert({
      company_id: TARGET_COMPANY_ID,
      code: ORDER_CODE,
      service_type: "Frete",
      service_date: today,
      plate: ctx.vehicle.plate,
      client_name: ctx.client.name,
      service_name: "Frete",
      service_categories: ["Frete"],
      chart_of_account_id: ctx.chartOfAccountId,
      service_amount: PROPOSAL_AMOUNT,
      status: "Aberto",
      vehicle_id: ctx.vehicle.id,
      notes: MARKER,
      attendant: MARKER,
      monitoring_contact: MARKER,
      entry_date: today,
      entry_time: "08:00",
      exit_date: today,
      exit_time: "18:00",
      freight_origin_address: "Origem DEMO",
      freight_destination_address: "Destino DEMO",
      freight_toll_amount: 0,
      freight_agreed_amount: PROPOSAL_AMOUNT,
      legacy_number: MARKER,
    })
    .select("id, status, service_type, company_id")
    .single();
  if (insertError || !created) fail(insertError?.message || "insert da OS");
  if (created.company_id !== TARGET_COMPANY_ID) fail("OS criada fora da company mapeada");
  if (created.service_type !== "Frete" || created.status !== "Aberto") fail("estado inicial da OS");
  console.log("SERVICE_ORDER_INITIAL_STATUS=Aberto");

  const orderId = created.id;
  const { data: proposal, error: proposalError } = await supabase.rpc("mark_proposal_sent", {
    p_order_id: orderId,
  });
  if (proposalError) fail(proposalError.message);
  const proposalToken = proposal?.token;
  if (!proposalToken) fail("token de proposta ausente");

  const { error: acceptError } = await supabase.rpc("respond_to_proposal", {
    p_token: proposalToken,
    p_action: "accept",
  });
  if (acceptError) fail(acceptError.message);

  const { data: assignment, error: assignError } = await supabase.rpc("send_driver_assignment", {
    p_order_id: orderId,
    p_driver_id: ctx.driver.id,
    p_driver_pay_amount: DRIVER_EXPENSE_AMOUNT,
    p_assistant_pay_amount: null,
  });
  if (assignError) fail(assignError.message);
  const assignmentToken = assignment?.token;
  if (!assignmentToken) fail("token de designação ausente");

  const { error: driverError } = await supabase.rpc("respond_to_driver_assignment", {
    p_token: assignmentToken,
    p_action: "accept",
  });
  if (driverError) fail(driverError.message);

  const { error: completeError } = await supabase.rpc("complete_service_order", {
    p_order_id: orderId,
  });
  if (completeError) fail(completeError.message);

  const { error: paidError } = await supabase.rpc("mark_driver_payment_paid", {
    p_order_id: orderId,
  });
  if (paidError) fail(paidError.message);

  const order = await findOrder(supabase);
  console.log("reused=NO");
  await assertJourney(supabase, ctx, order);
}

export async function runVerify(supabase) {
  const ctx = await demoContext(supabase);
  const order = await findOrder(supabase);
  await assertJourney(supabase, ctx, order);
}

async function seed() {
  await runSeed(await signIn(readConfig()));
}

async function verify() {
  await runVerify(await signIn(readConfig()));
}

async function main() {
  const command = process.argv[2];
  if (command === "seed") await seed();
  else if (command === "verify") await verify();
  else fail("use seed ou verify");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => fail(error instanceof Error ? error.message : "erro"));
}
