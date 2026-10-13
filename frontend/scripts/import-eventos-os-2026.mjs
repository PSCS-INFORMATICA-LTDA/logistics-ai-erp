/**
 * Importa EVENTOS - OS - 2026 → service_orders (Transporte/Frete)
 *
 *   node scripts/import-eventos-os-2026.mjs            # dry-run
 *   node scripts/import-eventos-os-2026.mjs --confirm  # grava
 *   node scripts/import-eventos-os-2026.mjs --delete-test
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANY_ID = "4787a893-6b62-4d36-87ce-57c15338ea11";
const TAG = "[IMPORTAÇÃO TESTE OS]";
const XLSX = path.join(
  "d:",
  "OneDrive",
  "Área de Trabalho",
  "GRX",
  "EVENTOS - OS - 2026 - 2° SEMESTRE.xlsx"
);
const OUT_DIR = path.join(__dirname, "..", "..", "docs", "importacao");
const OUT_REPORT = path.join(OUT_DIR, "GRX_Relatorio_Import_EVENTOS_OS_2026.xlsx");

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

function normalizePlate(plate) {
  return String(plate ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
}

function extractPlate(text) {
  const s = String(text ?? "").toUpperCase();
  const m =
    s.match(/\b([A-Z]{3}\d[A-Z0-9]\d{2})\b/) || s.match(/\b([A-Z]{3}\d{4})\b/);
  return m ? normalizePlate(m[1]) : "";
}

function parseSheetDate(name) {
  const m = String(name).trim().match(/^(\d{2})[.](\d{2})[.](\d{2})\s*$/);
  if (!m) return null;
  const dd = m[1];
  const mm = m[2];
  let yy = Number(m[3]);
  const yyyy = yy < 100 ? 2000 + yy : yy;
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateTime(text) {
  const s = String(text ?? "").trim();
  const m = s.match(
    /(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\s*[-–]?\s*(\d{1,2})[:hH](\d{2})?/
  );
  if (m) {
    const d = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const t = `${m[4].padStart(2, "0")}:${(m[5] || "00").padStart(2, "0")}:00`;
    return { date: d, time: t };
  }
  const dOnly = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (dOnly) {
    return {
      date: `${dOnly[3]}-${dOnly[2].padStart(2, "0")}-${dOnly[1].padStart(2, "0")}`,
      time: null,
    };
  }
  return { date: null, time: null };
}

function isBlockHeader(a) {
  const t = String(a ?? "").toUpperCase();
  return (
    t.startsWith("EVENTO DIA") ||
    t.startsWith("TRANSFER") ||
    t.startsWith("SHUTTLE") ||
    t.startsWith("DISPOSI") ||
    t.startsWith("FRETE")
  );
}

function isFieldLabel(a) {
  const t = String(a ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    t.startsWith("endereco de encontro") ||
    t.startsWith("endereco de destino") ||
    t.startsWith("endereco de parada") ||
    t.startsWith("data - horario") ||
    t.startsWith("data - horário") ||
    t.startsWith("veiculo / placa") ||
    t.startsWith("veículo / placa") ||
    t === "motorista" ||
    t === "telefone" ||
    t === "cpf" ||
    t === "ajudante"
  );
}

function guessServiceType(header, vehicleType, plateLine) {
  const t = `${header} ${vehicleType} ${plateLine}`.toLowerCase();
  if (t.includes("caminh") || t.includes("frete") || t.includes("carga")) {
    return "Frete";
  }
  return "Transporte";
}

function extractLegacy(client, header, sheetDate, seq) {
  const fromClient = String(client ?? "").match(/\b(EVT\d{4,})\b/i);
  if (fromClient) return fromClient[1].toUpperCase();
  const fromHeader = String(header ?? "").match(/\b(EVT\d{4,})\b/i);
  if (fromHeader) return fromHeader[1].toUpperCase();
  const d = (sheetDate || "20260101").replace(/-/g, "");
  return `EVT-${d}-${String(seq).padStart(3, "0")}`;
}

function nextNumericCodes(existingCodes, count) {
  let max = 0;
  for (const raw of existingCodes) {
    const s = String(raw ?? "").trim();
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const out = [];
  for (let i = 1; i <= count; i++) {
    out.push(String(max + i).padStart(8, "0"));
  }
  return out;
}

function parseSheetBlocks(ws, sheetDate) {
  const rows = [];
  const maxR = Math.min(ws.rowCount || 0, 800);
  for (let r = 1; r <= maxR; r++) {
    const a = cellStr(ws.getRow(r).getCell(1).value);
    const b = cellStr(ws.getRow(r).getCell(2).value);
    const d = cellRaw(ws.getRow(r).getCell(4).value);
    rows.push({ r, a, b, d });
  }

  const encontroIdx = [];
  for (let i = 0; i < rows.length; i++) {
    const lab = rows[i].a
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (lab.startsWith("endereco de encontro")) encontroIdx.push(i);
  }

  const blocks = [];
  for (let ei = 0; ei < encontroIdx.length; ei++) {
    const start = encontroIdx[ei];
    const end = ei + 1 < encontroIdx.length ? encontroIdx[ei + 1] : rows.length;
    const slice = rows.slice(Math.max(0, start - 12), end);

    let header = "";
    let client = "";
    for (let i = start - 1; i >= Math.max(0, start - 12); i--) {
      const a = rows[i].a;
      if (!a) continue;
      if (isBlockHeader(a)) {
        header = a;
        break;
      }
      if (!isFieldLabel(a) && !client && a.length > 1 && a !== bDup(rows[i])) {
        client = a;
      }
    }
    // client often immediately above encontro
    for (let i = start - 1; i >= Math.max(0, start - 4); i--) {
      const a = rows[i].a;
      if (!a || isFieldLabel(a) || isBlockHeader(a)) continue;
      client = a;
      break;
    }

    const fields = {
      origin: "",
      destination: "",
      stops: [],
      startRaw: "",
      endRaw: "",
      plateRaw: "",
      vehicleType: "",
      driver: "",
      phone: "",
      amount: null,
      extras: [],
    };

    for (const row of rows.slice(start, end)) {
      const lab = row.a
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      const val = row.b || row.a;
      if (typeof row.d === "number" && Number.isFinite(row.d) && row.d > 0) {
        fields.amount = Math.round(row.d * 100) / 100;
      } else if (typeof row.d === "string" && /^\d+([.,]\d+)?$/.test(row.d.trim())) {
        fields.amount = Number(String(row.d).replace(",", "."));
      }

      if (lab.startsWith("endereco de encontro")) fields.origin = row.b;
      else if (lab.startsWith("endereco de destino")) fields.destination = row.b;
      else if (lab.startsWith("endereco de parada")) fields.stops.push(row.b);
      else if (lab.startsWith("data - horario de inicio") || lab.startsWith("data - horário de inicio"))
        fields.startRaw = row.b;
      else if (
        lab.startsWith("data - horario de retorno") ||
        lab.startsWith("data - horário de retorno")
      )
        fields.endRaw = row.b;
      else if (lab.startsWith("veiculo / placa") || lab.startsWith("veículo / placa"))
        fields.plateRaw = row.b;
      else if (lab === "motorista") fields.driver = row.b;
      else if (lab === "telefone") fields.phone = row.b;
      else if (
        !isFieldLabel(row.a) &&
        !isBlockHeader(row.a) &&
        row.a &&
        /van|caminh|byd|sprinter|micro|onibus|ônibus|iveco|truck/i.test(row.a) &&
        !fields.vehicleType
      ) {
        fields.vehicleType = row.a;
      }

      if (row.d && typeof row.d === "string" && /lan[cç]ado|lista|nf/i.test(row.d)) {
        fields.extras.push(String(row.d));
      }
    }

    blocks.push({
      sheet: ws.name,
      sheetDate,
      header,
      client,
      ...fields,
      excelRow: rows[start].r,
    });
  }
  return blocks;
}

function bDup(row) {
  return row.b;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (DELETE_TEST) {
    const { data, error } = await sb
      .from("service_orders")
      .delete()
      .eq("company_id", COMPANY_ID)
      .ilike("notes", `%${TAG}%`)
      .select("id");
    if (error) throw error;
    console.log(`OS teste apagadas: ${data?.length ?? 0}`);
    return;
  }

  if (!fs.existsSync(XLSX)) {
    console.error("Arquivo não encontrado:", XLSX);
    process.exit(1);
  }

  const [{ data: vehicles }, { data: drivers }, { data: existing }, { data: clients }] = await Promise.all([
    sb.from("vehicles").select("id, plate").eq("company_id", COMPANY_ID),
    sb.from("drivers").select("id, name, document").eq("company_id", COMPANY_ID),
    sb.from("service_orders").select("code").eq("company_id", COMPANY_ID),
    sb.from("clients").select("id, name, trade_name, status, deleted_at").eq("company_id", COMPANY_ID),
  ]);

  const plateToId = new Map(
    (vehicles || []).map((v) => [normalizePlate(v.plate), v.id])
  );
  const driverByName = new Map(
    (drivers || []).map((d) => [
      String(d.name || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim(),
      d.id,
    ])
  );
  const clientMatchKey = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const clientsByKey = new Map();
  for (const client of clients || []) {
    if (client.deleted_at || client.status !== "Ativo") continue;
    for (const raw of [client.name, client.trade_name]) {
      const key = clientMatchKey(raw);
      if (!key) continue;
      const bucket = clientsByKey.get(key) ?? new Set();
      bucket.add(client.id);
      clientsByKey.set(key, bucket);
    }
  }
  const resolveImportClientId = (rawName) => {
    const key = clientMatchKey(rawName);
    if (!key) return { clientId: null, reason: null };
    const bucket = clientsByKey.get(key);
    if (!bucket || bucket.size === 0) return { clientId: null, reason: "cliente sem cadastro único" };
    if (bucket.size > 1) return { clientId: null, reason: "cliente ambíguo no cadastro" };
    return { clientId: [...bucket][0], reason: null };
  };

  console.log("Lendo", XLSX);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);

  const allBlocks = [];
  for (const ws of wb.worksheets) {
    const sheetDate = parseSheetDate(ws.name);
    if (!sheetDate || !sheetDate.startsWith("2026")) continue;
    allBlocks.push(...parseSheetBlocks(ws, sheetDate));
  }

  const codes = nextNumericCodes(
    (existing || []).map((r) => r.code),
    allBlocks.length
  );

  const gaps = [];
  const ready = [];
  let seq = 0;

  for (const block of allBlocks) {
    seq++;
    const code = codes[seq - 1];
    const start = parseDateTime(block.startRaw);
    const end = parseDateTime(block.endRaw);
    const serviceDate = start.date || block.sheetDate;
    const entryDate = start.date || block.sheetDate;
    const exitDate = end.date || start.date || block.sheetDate;
    const plate = extractPlate(block.plateRaw) || extractPlate(block.vehicleType);
    const vehicleId = plate ? plateToId.get(plate) || null : null;
    const serviceType = guessServiceType(block.header, block.vehicleType, block.plateRaw);
    const legacy = extractLegacy(block.client, block.header, block.sheetDate, seq);

    const driverKey = String(block.driver || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    const driverId = driverByName.get(driverKey) || null;

    const missing = [];
    if (!plate) missing.push("placa");
    if (plate && !vehicleId) missing.push(`veículo sem cadastro (${plate})`);
    const clientLink = resolveImportClientId(block.client);
    if (!block.client) missing.push("cliente");
    else if (clientLink.reason) missing.push(clientLink.reason);
    if (!block.origin) missing.push("origem");
    if (!block.destination) missing.push("destino");
    if (!block.driver) missing.push("motorista");
    if (block.driver && !driverId) missing.push(`motorista sem cadastro (${block.driver})`);
    if (!block.amount) missing.push("valor");

    const notes = [
      TAG,
      block.header || null,
      block.vehicleType ? `Tipo veículo planilha: ${block.vehicleType}` : null,
      block.stops.length ? `Paradas: ${block.stops.join(" | ")}` : null,
      block.extras.length ? `Obs planilha: ${block.extras.join(" | ")}` : null,
      missing.length ? `GAPS: ${missing.join("; ")}` : null,
      "Importado de EVENTOS - OS - 2026 (teste inicial).",
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 1800);

    const serviceName =
      block.header ||
      (serviceType === "Frete" ? "Frete / Evento" : "Transporte / Evento");

    const payload = {
      company_id: COMPANY_ID,
      code,
      legacy_number: legacy,
      service_type: serviceType,
      service_date: serviceDate,
      plate: plate || "SEM-PLACA",
      vehicle_id: vehicleId,
      vehicle_type: block.vehicleType || null,
      driver_id: driverId,
      proposed_driver_id: driverId,
      // Sem fluxo WhatsApp: já entra como motorista confirmado (botões/DRE)
      driver_assignment_response: driverId ? "accepted" : "pending",
      proposal_response: "accepted",
      proposal_accepted_at: serviceDate ? `${serviceDate}T12:00:00.000Z` : new Date().toISOString(),
      client_id: clientLink.clientId,
      client_name: block.client || "[SEM DADO: cliente]",
      phone: block.phone || null,
      service_name: serviceName.slice(0, 200),
      service_categories: [serviceType],
      service_amount: block.amount,
      freight_agreed_amount: block.amount,
      status: "Concluido",
      entry_date: entryDate,
      entry_time: start.time,
      exit_date: exitDate,
      exit_time: end.time,
      freight_origin_address: block.origin || null,
      freight_destination_address: block.destination || null,
      notes,
      _meta: {
        sheet: block.sheet,
        excelRow: block.excelRow,
        missing,
        plateRaw: block.plateRaw,
      },
    };

    if (missing.length) {
      gaps.push({
        aba: block.sheet,
        linha: block.excelRow,
        cliente: block.client,
        legado: legacy,
        codigo: code,
        faltantes: missing.join("; "),
        placa: plate || block.plateRaw,
        valor: block.amount ?? "",
      });
    }

    ready.push(payload);
  }

  console.log({
    modo: CONFIRM ? "CONFIRM" : "DRY-RUN",
    blocos: allBlocks.length,
    prontos: ready.length,
    gaps: gaps.length,
    clientes_vinculados: ready.filter((row) => row.client_id).length,
    clientes_sem_vinculo: ready.filter((row) => !row.client_id).length,
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = new ExcelJS.Workbook();
  const sum = report.addWorksheet("Resumo");
  sum.addRow(["Fonte", "EVENTOS - OS - 2026 - 2° SEMESTRE.xlsx"]);
  sum.addRow(["Destino", "Operacional → Ordem de Serviço — Transporte e Frete"]);
  sum.addRow(["Tag", TAG]);
  sum.addRow(["Status importado", "Concluido (para aparecer no filtro Concluído)"]);
  sum.addRow(["Código", "8 dígitos internos"]);
  sum.addRow(["Nº legado", "EVT… da planilha ou EVT-YYYYMMDD-NNN"]);
  sum.addRow(["Prontos", ready.length]);
  sum.addRow(["Com gaps (ainda importados)", gaps.length]);
  sum.addRow(["Modo", CONFIRM ? "CONFIRM" : "DRY-RUN"]);

  const gws = report.addWorksheet("Gaps");
  gws.columns = [
    { header: "Aba", key: "aba", width: 14 },
    { header: "Linha", key: "linha", width: 10 },
    { header: "Cliente", key: "cliente", width: 28 },
    { header: "Nº legado", key: "legado", width: 18 },
    { header: "Código", key: "codigo", width: 12 },
    { header: "Faltantes", key: "faltantes", width: 48 },
    { header: "Placa", key: "placa", width: 16 },
    { header: "Valor", key: "valor", width: 12 },
  ];
  for (const g of gaps) gws.addRow(g);
  gws.getRow(1).font = { bold: true };

  const aws = report.addWorksheet("A importar");
  aws.columns = [
    { header: "Código", key: "code", width: 12 },
    { header: "Legado", key: "legacy", width: 18 },
    { header: "Data", key: "date", width: 12 },
    { header: "Tipo", key: "type", width: 12 },
    { header: "Cliente", key: "client", width: 28 },
    { header: "Placa", key: "plate", width: 12 },
    { header: "Valor", key: "amount", width: 12 },
    { header: "Aba", key: "sheet", width: 14 },
  ];
  for (const p of ready) {
    aws.addRow({
      code: p.code,
      legacy: p.legacy_number,
      date: p.service_date,
      type: p.service_type,
      client: p.client_name,
      plate: p.plate,
      amount: p.service_amount ?? "",
      sheet: p._meta.sheet,
    });
  }
  aws.getRow(1).font = { bold: true };
  await report.xlsx.writeFile(OUT_REPORT);
  console.log("Relatório:", OUT_REPORT);

  if (!CONFIRM) {
    console.log("Dry-run ok. Grave com --confirm | limpe com --delete-test");
    return;
  }

  let inserted = 0;
  const batchSize = 40;
  for (let i = 0; i < ready.length; i += batchSize) {
    const chunk = ready.slice(i, i + batchSize).map((p) => {
      const { _meta, ...row } = p;
      return row;
    });
    const { error } = await sb.from("service_orders").insert(chunk);
    if (error) {
      console.error("Erro lote", i, error.message);
      throw error;
    }
    inserted += chunk.length;
    console.log(`Inseridos ${inserted}/${ready.length}`);
  }
  console.log("Carga OS concluída:", inserted);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
