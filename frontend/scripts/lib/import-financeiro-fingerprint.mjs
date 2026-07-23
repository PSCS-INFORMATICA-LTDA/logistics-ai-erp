/** Fingerprint estável para dedupe de import financeiro teste. */

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseImportDesc(description) {
  const d = String(description || "");
  const party = (d.match(/Parte:\s*([^·]+)/i) || [])[1]?.trim() || "";
  const service = (d.match(/Serviço:\s*(\d{4}-\d{2}-\d{2})/i) || [])[1] || "";
  const cot = (d.match(/COT:\s*([^·]+)/i) || [])[1]?.trim() || "";
  const fonte = (d.match(/Fonte:\s*([^·]+)/i) || [])[1]?.trim() || "GRX";
  const core = d
    .replace(/\[IMPORTAÇÃO TESTE\]/gi, "")
    .replace(/Fonte:\s*[^·]+/gi, "")
    .replace(/Parte:\s*[^·]+/gi, "")
    .replace(/Serviço:\s*[^·]+/gi, "")
    .replace(/COT:\s*[^·]+/gi, "")
    .replace(/Motorista:\s*[^·]+/gi, "")
    .replace(/Rateio:\s*[^·]+/gi, "")
    .replace(/GAPS:\s*[^·]+/gi, "")
    .replace(/·/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { party, service, cot, fonte, core: normalizeText(core).slice(0, 120) };
}

/** Chave de unicidade: data caixa + valor + conta + parte + serviço + COT + desc. */
export function importFingerprint(row) {
  const p = parseImportDesc(row.description);
  const cot = normalizeText(row.legacy_number || p.cot);
  return [
    row.transaction_date,
    Number(row.amount).toFixed(2),
    row.chart_of_account_id || "",
    normalizeText(p.party),
    p.service,
    cot,
    p.core,
  ].join("|");
}

/** Fingerprint a partir dos campos do Excel (antes do insert). */
export function fingerprintFromParts({
  cashDate,
  amount,
  accountId,
  party,
  serviceDate,
  cot,
  desc,
}) {
  return [
    cashDate,
    Number(amount).toFixed(2),
    accountId || "",
    normalizeText(party),
    serviceDate || "",
    normalizeText(cot),
    normalizeText(desc || "[SEM DADO: descrição]").slice(0, 120),
  ].join("|");
}
