/**
 * Importação TESTE — só histórico Financeiro - GRX.xlsx (2026).
 * Lava-rápido / OS / outras planilhas: fora deste escopo.
 *
 *   node scripts/import-financeiro-grx-2026-teste.mjs           # dry-run
 *   node scripts/import-financeiro-grx-2026-teste.mjs --confirm # grava
 *   node scripts/import-financeiro-grx-2026-teste.mjs --delete-test
 *
 * Regras Rafael: col A = caixa (pag/rec); col D = data do serviço.
 * Tag: [IMPORTAÇÃO TESTE] — fácil apagar com --delete-test.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANY_ID = "4787a893-6b62-4d36-87ce-57c15338ea11";
const TAG = "[IMPORTAÇÃO TESTE]";
/** Fora do unique index de company_ledger (mesmo dia+conta+valor ocorre no Excel). */
const ENTRY_SOURCE = "import_historico_teste";
const XLSX = path.join("d:", "OneDrive", "Área de Trabalho", "GRX", "Financeiro - GRX.xlsx");
const OUT_DIR = path.join(__dirname, "..", "..", "docs", "importacao");
const OUT_GAPS = path.join(OUT_DIR, "GRX_Gaps_Financeiro_GRX_2026_TESTE.xlsx");
const OUT_REPORT = path.join(OUT_DIR, "GRX_Relatorio_Import_Financeiro_GRX_2026_TESTE.xlsx");

const CONFIRM = process.argv.includes("--confirm");
const DELETE_TEST = process.argv.includes("--delete-test");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePlate(plate) {
  return String(plate ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
}

function cellRaw(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "object") {
    if (v.result != null) return cellRaw(v.result);
    if (v.text != null) return String(v.text).trim() || null;
    if (Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text).join("").trim() || null;
    }
  }
  return v;
}

function cellStr(v) {
  const r = cellRaw(v);
  if (r == null) return "";
  if (r instanceof Date) return r.toISOString().slice(0, 10);
  return String(r).trim();
}

function toIsoDate(v) {
  const r = cellRaw(v);
  if (r == null || r === "") return null;
  if (r instanceof Date && !Number.isNaN(r.getTime())) {
    // Excel/JS local date — usar UTC date parts do valor serializado local
    const y = r.getFullYear();
    const m = String(r.getMonth() + 1).padStart(2, "0");
    const d = String(r.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(r).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const br = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (br) {
    return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  return null;
}

function toAmount(v) {
  const r = cellRaw(v);
  if (r == null || r === "") return null;
  if (typeof r === "number" && Number.isFinite(r)) return Math.round(r * 100) / 100;
  const s = String(r)
    .replace(/R\$\s?/gi, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function isLavaRow(conta, rateio, desc) {
  const t = normalizeText(`${conta} ${rateio} ${desc}`);
  return t.includes("lava");
}

function looksLikePlate(value) {
  const p = normalizePlate(value);
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p) || /^[A-Z]{3}\d{4}$/.test(p);
}

function matchAccount(accounts, name) {
  const n = normalizeText(name);
  if (!n) return null;
  const exact = accounts.find((a) => normalizeText(a.name) === n);
  if (exact) return exact;
  // aliases comuns da planilha
  const aliases = {
    "saldo inicial": "saldo inicial",
    "fornecimento de agua": "fornecimento de agua",
    "documentacao empresa": "documentacao vans",
  };
  const alias = aliases[n];
  if (alias) {
    const hit = accounts.find((a) => normalizeText(a.name) === alias);
    if (hit) return hit;
  }
  const partial = accounts.find(
    (a) => normalizeText(a.name).includes(n) || n.includes(normalizeText(a.name))
  );
  return partial || null;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (DELETE_TEST) {
    const { data: byTag, error: e1 } = await sb
      .from("financial_transactions")
      .delete()
      .eq("company_id", COMPANY_ID)
      .ilike("description", `%${TAG}%`)
      .select("id");
    if (e1) throw e1;
    const { data: bySource, error: e2 } = await sb
      .from("financial_transactions")
      .delete()
      .eq("company_id", COMPANY_ID)
      .eq("entry_source", ENTRY_SOURCE)
      .select("id");
    if (e2) throw e2;
    console.log(
      `Apagados teste: tag=${byTag?.length ?? 0} source=${bySource?.length ?? 0}`
    );
    return;
  }

  if (!fs.existsSync(XLSX)) {
    console.error("Planilha não encontrada:", XLSX);
    process.exit(1);
  }

  const { data: accounts, error: accErr } = await sb
    .from("chart_of_accounts")
    .select("id, name, transaction_type, classification")
    .eq("company_id", COMPANY_ID);
  if (accErr) throw accErr;

  const { data: vehicles, error: vehErr } = await sb
    .from("vehicles")
    .select("id, plate")
    .eq("company_id", COMPANY_ID);
  if (vehErr) throw vehErr;

  const plateToId = new Map(
    (vehicles || []).map((v) => [normalizePlate(v.plate), v.id])
  );

  console.log("Lendo", XLSX);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  const ws = wb.getWorksheet("Controle financeiro");
  if (!ws) throw new Error("Aba Controle financeiro não encontrada");

  const gaps = [];
  const ready = [];
  let skippedLava = 0;
  let skippedNot2026 = 0;
  let skippedInvalid = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cashDate = toIsoDate(row.getCell(1).value);
    if (!cashDate) {
      // fim típico da planilha gigante
      if (r > 30000) break;
      continue;
    }
    if (!cashDate.startsWith("2026")) {
      skippedNot2026++;
      continue;
    }

    const amount = toAmount(row.getCell(2).value);
    const party = cellStr(row.getCell(3).value);
    const serviceDate = toIsoDate(row.getCell(4).value);
    const cot = cellStr(row.getCell(5).value);
    const driver = cellStr(row.getCell(6).value);
    const vehicleCol = cellStr(row.getCell(7).value);
    const desc = cellStr(row.getCell(8).value);
    const contaName = cellStr(row.getCell(9).value);
    const classificationSheet = cellStr(row.getCell(10).value);
    const rateio = cellStr(row.getCell(12).value);

    if (amount == null || amount === 0) {
      skippedInvalid++;
      gaps.push({
        linha: r,
        motivo: "Valor inválido ou zero",
        data_caixa: cashDate,
        conta: contaName,
        descricao: desc,
      });
      continue;
    }

    if (isLavaRow(contaName, rateio, desc)) {
      skippedLava++;
      continue;
    }

    const account = matchAccount(accounts || [], contaName);
    const missing = [];
    if (!contaName) missing.push("Conta DRE");
    if (!account) missing.push(`Conta DRE não cadastrada: ${contaName || "(vazia)"}`);
    if (!party) missing.push("Cliente/Fornecedor");

    const plateCandidate = looksLikePlate(vehicleCol)
      ? normalizePlate(vehicleCol)
      : looksLikePlate(rateio)
        ? normalizePlate(rateio)
        : "";
    const vehicleId = plateCandidate ? plateToId.get(plateCandidate) || null : null;
    if (plateCandidate && !vehicleId) {
      missing.push(`Veículo sem cadastro: ${plateCandidate}`);
    }

    const parts = [
      TAG,
      desc || "[SEM DADO: descrição]",
      party ? `Parte: ${party}` : "[SEM DADO: cliente/fornecedor]",
      serviceDate ? `Serviço: ${serviceDate}` : null,
      cot ? `COT: ${cot}` : null,
      driver ? `Motorista: ${driver}` : null,
      rateio ? `Rateio: ${rateio}` : null,
      missing.length ? `GAPS: ${missing.join("; ")}` : null,
    ].filter(Boolean);

    const payload = {
      company_id: COMPANY_ID,
      transaction_date: cashDate,
      amount: Math.abs(amount),
      chart_of_account_id: account?.id ?? null,
      classification:
        (account?.classification) ||
        classificationSheet ||
        "Administrativo",
      transaction_type: account?.transaction_type || "Despesa",
      description: parts.join(" · ").slice(0, 1800),
      entry_source: ENTRY_SOURCE,
      allocation_vehicle_id: vehicleId,
      approval_status: "approved",
      submitted_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
      review_note: "Importação teste histórico Financeiro GRX 2026",
      _meta: {
        linha: r,
        conta_planilha: contaName,
        service_date: serviceDate,
        plate: plateCandidate || null,
        missing,
        skip: !account,
      },
    };

    if (!account) {
      gaps.push({
        linha: r,
        motivo: "Conta DRE não encontrada no sistema",
        data_caixa: cashDate,
        data_servico: serviceDate || "",
        valor: amount,
        conta: contaName,
        rateio,
        descricao: desc,
        parte: party,
      });
      skippedInvalid++;
      continue;
    }

    if (missing.length) {
      gaps.push({
        linha: r,
        motivo: missing.join("; "),
        data_caixa: cashDate,
        data_servico: serviceDate || "",
        valor: amount,
        conta: contaName,
        rateio,
        descricao: desc,
        parte: party,
        acao: "Importa com placeholder na descrição",
      });
    }

    ready.push(payload);
  }

  console.log({
    modo: CONFIRM ? "CONFIRM (grava)" : "DRY-RUN",
    prontos: ready.length,
    gaps: gaps.length,
    skippedLava,
    skippedNot2026,
    skippedInvalid,
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = new ExcelJS.Workbook();
  const gws = report.addWorksheet("Gaps");
  gws.columns = [
    { header: "Linha Excel", key: "linha", width: 12 },
    { header: "Motivo / faltante", key: "motivo", width: 48 },
    { header: "Data caixa (A)", key: "data_caixa", width: 14 },
    { header: "Data serviço (D)", key: "data_servico", width: 16 },
    { header: "Valor", key: "valor", width: 12 },
    { header: "Conta DRE", key: "conta", width: 28 },
    { header: "Rateio", key: "rateio", width: 18 },
    { header: "Parte", key: "parte", width: 28 },
    { header: "Descrição", key: "descricao", width: 40 },
    { header: "Ação", key: "acao", width: 36 },
  ];
  for (const g of gaps) gws.addRow(g);
  gws.getRow(1).font = { bold: true };

  const sws = report.addWorksheet("A importar");
  sws.columns = [
    { header: "Linha", key: "linha", width: 10 },
    { header: "Data caixa", key: "d", width: 12 },
    { header: "Valor", key: "v", width: 12 },
    { header: "Tipo", key: "t", width: 10 },
    { header: "Conta", key: "c", width: 28 },
    { header: "Placa", key: "p", width: 12 },
    { header: "Gaps", key: "g", width: 40 },
    { header: "Descrição (início)", key: "desc", width: 50 },
  ];
  for (const p of ready.slice(0, 5000)) {
    sws.addRow({
      linha: p._meta.linha,
      d: p.transaction_date,
      v: p.amount,
      t: p.transaction_type,
      c: p._meta.conta_planilha,
      p: p._meta.plate || "",
      g: p._meta.missing.join("; "),
      desc: p.description.slice(0, 80),
    });
  }
  sws.getRow(1).font = { bold: true };

  const sum = report.addWorksheet("Resumo");
  sum.addRow(["Escopo", "Financeiro - GRX.xlsx / Controle financeiro / só 2026"]);
  sum.addRow(["Lava", "Excluído deste teste (deixado para depois)"]);
  sum.addRow(["OS / outras planilhas", "Não entram neste teste"]);
  sum.addRow(["Tag", TAG]);
  sum.addRow(["Coluna A", "Data pagamento/recebimento → transaction_date"]);
  sum.addRow(["Coluna D", "Data do serviço → texto na descrição"]);
  sum.addRow(["Prontos", ready.length]);
  sum.addRow(["Gaps (com ou sem bloqueio)", gaps.length]);
  sum.addRow(["Pulados Lava", skippedLava]);
  sum.addRow(["Modo", CONFIRM ? "CONFIRM" : "DRY-RUN"]);
  sum.addRow(["Obs", "Histórico incompleto de propósito — teste inicial (sobe/apaga)"]);

  await report.xlsx.writeFile(OUT_REPORT);
  await report.xlsx.writeFile(OUT_GAPS);
  console.log("Relatório:", OUT_REPORT);

  if (!CONFIRM) {
    console.log("Dry-run ok. Para gravar: --confirm | Para limpar depois: --delete-test");
    return;
  }

  // insert batches
  let inserted = 0;
  const batchSize = 80;
  for (let i = 0; i < ready.length; i += batchSize) {
    const chunk = ready.slice(i, i + batchSize).map((p) => {
      const { _meta, ...row } = p;
      return row;
    });
    const { error } = await sb.from("financial_transactions").insert(chunk);
    if (error) {
      console.error("Erro no lote", i, error.message);
      throw error;
    }
    inserted += chunk.length;
    console.log(`Inseridos ${inserted}/${ready.length}`);
  }
  console.log("Carga teste concluída:", inserted);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
