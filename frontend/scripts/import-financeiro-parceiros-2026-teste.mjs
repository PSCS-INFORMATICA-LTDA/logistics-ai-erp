/**
 * Importação TESTE — financeiros Rafa / Malu / Sérgio (só 2026).
 * Lava e Financeiro GRX ficam de fora (GRX já tem script próprio).
 *
 *   node scripts/import-financeiro-parceiros-2026-teste.mjs           # dry-run
 *   node scripts/import-financeiro-parceiros-2026-teste.mjs --confirm # grava
 *   node scripts/import-financeiro-parceiros-2026-teste.mjs --delete-test
 *
 * Regras Rafael: data caixa (pag/rec) → transaction_date; data do serviço na descrição.
 * Tag: [IMPORTAÇÃO TESTE] · Fonte: … — apagar só este lote com --delete-test.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import {
  fingerprintFromParts,
  importFingerprint,
} from "./lib/import-financeiro-fingerprint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANY_ID = "4787a893-6b62-4d36-87ce-57c15338ea11";
const TAG = "[IMPORTAÇÃO TESTE]";
const ENTRY_SOURCE = "import_historico_teste_parceiros";
const SRC_DIR = path.join("d:", "OneDrive", "Área de Trabalho", "GRX");
const OUT_DIR = path.join(__dirname, "..", "..", "docs", "importacao");
const OUT_REPORT = path.join(
  OUT_DIR,
  "GRX_Relatorio_Import_Financeiro_Parceiros_2026_TESTE.xlsx"
);

const SOURCES = [
  { file: "Financeiro Rafa - SWU e QSX.xlsx", label: "Rafa SWU/QSX" },
  { file: "Financeiro Malu - STS, TJR, UFJ e MICRO.xlsx", label: "Malu STS/TJR/UFJ/MICRO" },
  { file: "Financeiro Malu - TKK5E68.xlsx", label: "Malu TKK5E68" },
  { file: "Financeiro - Sérgio.xlsx", label: "Sérgio" },
];

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
  if (r instanceof Date) {
    const y = r.getFullYear();
    const m = String(r.getMonth() + 1).padStart(2, "0");
    const d = String(r.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(r).trim();
}

function toIsoDate(v) {
  const r = cellRaw(v);
  if (r == null || r === "") return null;
  if (r instanceof Date && !Number.isNaN(r.getTime())) {
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
  const aliases = {
    "saldo inicial": "saldo inicial",
    "fornecimento de agua": "fornecimento de agua",
    "documentacao empresa": "documentacao vans",
    receitas: "receita van",
  };
  const alias = aliases[n];
  if (alias) {
    const hit = accounts.find((a) => normalizeText(a.name) === alias);
    if (hit) return hit;
  }
  return (
    accounts.find(
      (a) => normalizeText(a.name).includes(n) || n.includes(normalizeText(a.name))
    ) || null
  );
}

/** Resolve colunas por nome do cabeçalho (layouts diferem entre planilhas). */
function buildColMap(ws) {
  const map = {};
  for (let c = 1; c <= 25; c++) {
    const h = normalizeText(cellStr(ws.getRow(1).getCell(c).value));
    if (!h) continue;
    if (h === "data") map.cashDate = c;
    else if (h === "valor") map.amount = c;
    else if (h === "cliente/fornecedor" || h === "cliente" || h === "fornecedor") map.party = c;
    else if (h === "data do servico") map.serviceDate = c;
    else if (h === "cot") map.cot = c;
    else if (h === "motorista") map.driver = c;
    else if (h === "van" || h === "veiculo" || h === "placa") map.vehicle = c;
    else if (h === "descricao" || h === "parcela") {
      // Parcela no Sérgio é col 8; Descrição é col 9 — não sobrescrever descrição
      if (h === "descricao") map.desc = c;
      else if (h === "parcela") map.parcela = c;
    }
    else if (h === "conta dre") map.conta = c;
    else if (h === "classificacao") map.classification = c;
    else if (h === "tipo") map.tipo = c;
    else if (h === "rateio") map.rateio = c;
  }
  if (!map.cashDate || !map.amount || !map.conta) {
    throw new Error(
      `Cabeçalhos insuficientes na aba Controle financeiro: ${JSON.stringify(map)}`
    );
  }
  return map;
}

function cellAt(row, col) {
  if (!col) return null;
  return row.getCell(col).value;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (DELETE_TEST) {
    const { data, error } = await sb
      .from("financial_transactions")
      .delete()
      .eq("company_id", COMPANY_ID)
      .eq("entry_source", ENTRY_SOURCE)
      .select("id");
    if (error) throw error;
    console.log(`Apagados parceiros (entry_source=${ENTRY_SOURCE}): ${data?.length ?? 0}`);
    return;
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

  // Fingerprints já no banco (GRX + parceiros) para não recriar duplicata
  const seenFp = new Set();
  {
    const page = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("financial_transactions")
        .select(
          "transaction_date, amount, chart_of_account_id, description, legacy_number"
        )
        .eq("company_id", COMPANY_ID)
        .in("entry_source", [
          "import_historico_teste",
          "import_historico_teste_parceiros",
        ])
        .order("id", { ascending: true })
        .range(from, from + page - 1);
      if (error) throw error;
      if (!data?.length) break;
      for (const row of data) seenFp.add(importFingerprint(row));
      if (data.length < page) break;
      from += page;
    }
    console.log("Fingerprints já existentes (banco):", seenFp.size);
  }

  const gaps = [];
  const ready = [];
  const perFile = [];
  let skippedLava = 0;
  let skippedNot2026 = 0;
  let skippedInvalid = 0;
  let skippedDup = 0;

  for (const src of SOURCES) {
    const full = path.join(SRC_DIR, src.file);
    if (!fs.existsSync(full)) {
      console.error("Planilha não encontrada:", full);
      process.exit(1);
    }
    console.log("Lendo", src.file);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(full);
    const ws = wb.getWorksheet("Controle financeiro");
    if (!ws) throw new Error(`${src.file}: aba Controle financeiro não encontrada`);
    const col = buildColMap(ws);
    console.log("  colunas:", col);

    let fileReady = 0;
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cashDate = toIsoDate(cellAt(row, col.cashDate));
      if (!cashDate) {
        if (r > 30000) break;
        continue;
      }
      if (!cashDate.startsWith("2026")) {
        skippedNot2026++;
        continue;
      }

      const amount = toAmount(cellAt(row, col.amount));
      const party = cellStr(cellAt(row, col.party));
      const serviceDate = toIsoDate(cellAt(row, col.serviceDate));
      const cot = cellStr(cellAt(row, col.cot));
      const driver = cellStr(cellAt(row, col.driver));
      const vehicleCol = cellStr(cellAt(row, col.vehicle));
      const desc = cellStr(cellAt(row, col.desc));
      const contaName = cellStr(cellAt(row, col.conta));
      const classificationSheet = cellStr(cellAt(row, col.classification));
      const rateio = cellStr(cellAt(row, col.rateio));

      if (amount == null || amount === 0) {
        skippedInvalid++;
        gaps.push({
          fonte: src.label,
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
        `Fonte: ${src.label}`,
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
          account?.classification || classificationSheet || "Administrativo",
        transaction_type: account?.transaction_type || "Despesa",
        description: parts.join(" · ").slice(0, 1800),
        entry_source: ENTRY_SOURCE,
        allocation_vehicle_id: vehicleId,
        legacy_number: cot || null,
        approval_status: "approved",
        submitted_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString(),
        review_note: `Importação teste histórico ${src.label} 2026`,
        _meta: {
          fonte: src.label,
          arquivo: src.file,
          linha: r,
          conta_planilha: contaName,
          service_date: serviceDate,
          plate: plateCandidate || null,
          missing,
        },
      };

      if (!account) {
        gaps.push({
          fonte: src.label,
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

      const fp = fingerprintFromParts({
        cashDate,
        amount: Math.abs(amount),
        accountId: account.id,
        party,
        serviceDate,
        cot,
        desc,
      });
      if (seenFp.has(fp)) {
        skippedDup++;
        gaps.push({
          fonte: src.label,
          linha: r,
          motivo: "Duplicata (já existe GRX/outra planilha/lote)",
          data_caixa: cashDate,
          data_servico: serviceDate || "",
          valor: amount,
          conta: contaName,
          rateio,
          descricao: desc,
          parte: party,
          acao: "Excluído do import",
        });
        continue;
      }
      seenFp.add(fp);

      if (missing.length) {
        gaps.push({
          fonte: src.label,
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
      fileReady++;
    }
    perFile.push({ fonte: src.label, prontos: fileReady });
    console.log(`  prontos nesta planilha: ${fileReady}`);
  }

  console.log({
    modo: CONFIRM ? "CONFIRM (grava)" : "DRY-RUN",
    prontos: ready.length,
    porArquivo: perFile,
    gaps: gaps.length,
    skippedLava,
    skippedNot2026,
    skippedInvalid,
    skippedDup,
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = new ExcelJS.Workbook();
  const gws = report.addWorksheet("Gaps");
  gws.columns = [
    { header: "Fonte", key: "fonte", width: 22 },
    { header: "Linha Excel", key: "linha", width: 12 },
    { header: "Motivo / faltante", key: "motivo", width: 48 },
    { header: "Data caixa (A)", key: "data_caixa", width: 14 },
    { header: "Data serviço", key: "data_servico", width: 14 },
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
    { header: "Fonte", key: "f", width: 22 },
    { header: "Linha", key: "linha", width: 10 },
    { header: "Data caixa", key: "d", width: 12 },
    { header: "Valor", key: "v", width: 12 },
    { header: "Tipo", key: "t", width: 10 },
    { header: "Conta", key: "c", width: 28 },
    { header: "Placa", key: "p", width: 12 },
    { header: "Gaps", key: "g", width: 40 },
    { header: "Descrição (início)", key: "desc", width: 50 },
  ];
  for (const p of ready.slice(0, 8000)) {
    sws.addRow({
      f: p._meta.fonte,
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
  sum.addRow(["Escopo", "Rafa + Malu (2x) + Sérgio / Controle financeiro / só 2026"]);
  sum.addRow(["Lava / GRX empresa", "Fora deste lote"]);
  sum.addRow(["Tag", TAG]);
  sum.addRow(["entry_source", ENTRY_SOURCE]);
  sum.addRow(["Data caixa", "→ transaction_date"]);
  sum.addRow(["Data serviço", "→ texto na descrição"]);
  for (const p of perFile) sum.addRow([`Prontos ${p.fonte}`, p.prontos]);
  sum.addRow(["Prontos total", ready.length]);
  sum.addRow(["Gaps", gaps.length]);
  sum.addRow(["Pulados Lava", skippedLava]);
  sum.addRow(["Pulados duplicata", skippedDup]);
  sum.addRow(["Modo", CONFIRM ? "CONFIRM" : "DRY-RUN"]);
  sum.addRow([
    "Obs",
    "Duplicatas vs GRX / entre planilhas são excluídas no import; apagar lote: --delete-test",
  ]);

  await report.xlsx.writeFile(OUT_REPORT);
  console.log("Relatório:", OUT_REPORT);

  if (!CONFIRM) {
    console.log("Dry-run ok. Para gravar: --confirm | Para limpar depois: --delete-test");
    return;
  }

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
  console.log("Carga teste parceiros concluída:", inserted);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
