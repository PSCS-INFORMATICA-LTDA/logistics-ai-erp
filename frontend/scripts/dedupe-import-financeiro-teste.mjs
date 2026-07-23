/**
 * Remove duplicatas dos imports financeiros de teste (GRX + Rafa/Malu/Sérgio).
 *
 * Critério: mesma data caixa + valor + conta DRE + parte + data serviço + COT +
 * descrição "livre" (sem tag/fonte/meta).
 *
 * Prioridade de retenção:
 *   1) import_historico_teste (Financeiro GRX)
 *   2) empate → created_at mais antigo
 *
 *   node scripts/dedupe-import-financeiro-teste.mjs           # dry-run
 *   node scripts/dedupe-import-financeiro-teste.mjs --confirm # apaga extras
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import {
  importFingerprint,
  parseImportDesc,
} from "./lib/import-financeiro-fingerprint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANY_ID = "4787a893-6b62-4d36-87ce-57c15338ea11";
const SOURCES = ["import_historico_teste", "import_historico_teste_parceiros"];
const OUT = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "importacao",
  "GRX_Relatorio_Dedupe_Financeiro_TESTE.xlsx"
);
const CONFIRM = process.argv.includes("--confirm");

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

function rankKeep(row) {
  const sourceRank = row.entry_source === "import_historico_teste" ? 0 : 1;
  return `${sourceRank}|${row.created_at || ""}|${row.id}`;
}

async function fetchAll(sb) {
  const all = [];
  const page = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("financial_transactions")
      .select(
        "id, transaction_date, amount, chart_of_account_id, description, entry_source, legacy_number, created_at"
      )
      .eq("company_id", COMPANY_ID)
      .in("entry_source", SOURCES)
      // id estável — created_at empatado quebra paginação e inventa "duplicata"
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return all;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = await fetchAll(sb);
  const groups = new Map();
  for (const row of rows) {
    const fp = importFingerprint(row);
    if (!groups.has(fp)) groups.set(fp, []);
    groups.get(fp).push(row);
  }

  const toDelete = [];
  for (const [, g] of groups) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => rankKeep(a).localeCompare(rankKeep(b)));
    const keep = sorted[0];
    for (const extra of sorted.slice(1)) {
      toDelete.push({
        ...extra,
        _keep_id: keep.id,
        _keep_fonte: parseImportDesc(keep.description).fonte,
        _drop_fonte: parseImportDesc(extra.description).fonte,
      });
    }
  }

  console.log({
    modo: CONFIRM ? "CONFIRM" : "DRY-RUN",
    total: rows.length,
    gruposDup: [...groups.values()].filter((g) => g.length > 1).length,
    aRemover: toDelete.length,
    porSourceRemover: {
      grx: toDelete.filter((r) => r.entry_source === "import_historico_teste").length,
      parceiros: toDelete.filter((r) => r.entry_source === "import_historico_teste_parceiros")
        .length,
    },
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("A remover");
  ws.columns = [
    { header: "id", key: "id", width: 38 },
    { header: "Fonte drop", key: "df", width: 22 },
    { header: "Source drop", key: "ds", width: 28 },
    { header: "Mantém id", key: "kid", width: 38 },
    { header: "Mantém fonte", key: "kf", width: 22 },
    { header: "Data", key: "d", width: 12 },
    { header: "Valor", key: "v", width: 12 },
    { header: "Parte", key: "p", width: 28 },
    { header: "Desc", key: "c", width: 50 },
  ];
  for (const r of toDelete) {
    const p = parseImportDesc(r.description);
    ws.addRow({
      id: r.id,
      df: r._drop_fonte,
      ds: r.entry_source,
      kid: r._keep_id,
      kf: r._keep_fonte,
      d: r.transaction_date,
      v: r.amount,
      p: p.party,
      c: p.core.slice(0, 80),
    });
  }
  ws.getRow(1).font = { bold: true };
  await wb.xlsx.writeFile(OUT);
  console.log("Relatório:", OUT);

  if (!CONFIRM) {
    console.log("Dry-run ok. Para apagar extras: --confirm");
    return;
  }

  let deleted = 0;
  const batchSize = 80;
  for (let i = 0; i < toDelete.length; i += batchSize) {
    const ids = toDelete.slice(i, i + batchSize).map((r) => r.id);
    const { error, data } = await sb
      .from("financial_transactions")
      .delete()
      .in("id", ids)
      .select("id");
    if (error) throw error;
    deleted += data?.length ?? 0;
    console.log(`Apagados ${deleted}/${toDelete.length}`);
  }
  console.log("Dedupe concluído. Removidos:", deleted);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
