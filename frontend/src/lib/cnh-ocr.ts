import { CNH_CATEGORIES, isValidCnh, normalizeCnh, sortCnhCategories, type CnhCategory } from "@/lib/cnh";

export type CnhOcrResult = {
  name: string | null;
  document: string | null;
  cnh_number: string | null;
  cnh_expiry_date: string | null;
  cnh_categories: string[];
  rawText: string;
  filledFields: string[];
  sources?: string[];
};

export type OcrEngine = "google-vision" | "tesseract";

const CATEGORY_VALUES = new Set(CNH_CATEGORIES.map((item) => item.value));
const SECTION_HEADERS =
  /^(NOME|DOC\.?|DOCUMENTO|IDENTIDADE|CPF|REGISTRO|N[°º]|VALIDADE|CAT\.?|CATEGORIA|HABILIT|NASCIMENTO|FILIA|OBS)/i;

function normalizeOcrText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\r/g, "\n")
    .toUpperCase();
}

function formatCpf(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  if (clean.length !== 11) return clean;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9)}`;
}

function parseDateToIso(value: string): string | null {
  const match = /(\d{2})[\/\-.](\d{2})[\/\-.](\d{2,4})/.exec(value);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += year >= 50 ? 1900 : 2000;

  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!check) return null;
  return iso;
}

function extractCpf(text: string): string | null {
  const labeled = text.match(/(?:CPF|DOC\.?\s*IDENTIDADE)[^\d]{0,20}(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i);
  if (labeled) return formatCpf(labeled[1]);

  const generic = text.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/);
  return generic ? formatCpf(generic[1]) : null;
}

function extractCnhNumber(text: string): string | null {
  const labeled = text.match(/(?:REGISTRO|N[°º]\s*REGISTRO)[^\d]{0,20}(\d{11})/i);
  const candidates = labeled
    ? [labeled[1]]
    : [...text.matchAll(/\b(\d{11})\b/g)].map((match) => match[1]);

  for (const candidate of candidates) {
    if (isValidCnh(candidate)) return candidate;
  }

  return candidates[0] ?? null;
}

function extractExpiryDate(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!/VALIDADE|4A\s*DATA|HABILITACAO/i.test(lines[i])) continue;
    for (let j = i; j < Math.min(i + 4, lines.length); j++) {
      const parsed = parseDateToIso(lines[j]);
      if (parsed) return parsed;
    }
  }

  const dates = lines
    .map((line) => parseDateToIso(line))
    .filter((value): value is string => Boolean(value));

  return dates.length > 0 ? dates[dates.length - 1] : null;
}

function extractCategories(text: string, lines: string[]): string[] {
  const found = new Set<string>();

  for (const line of lines) {
    if (!/(CAT\.?|CATEGORIA|HABILIT)/i.test(line)) continue;
    for (const category of CNH_CATEGORIES) {
      const pattern = new RegExp(`\\b${category.value}\\b`);
      if (pattern.test(line)) found.add(category.value);
    }
  }

  const compact = text.replace(/[^A-Z]/g, "");
  for (const category of ["AE", "AD", "AC", "AB", "A", "B", "C", "D", "E"] as CnhCategory[]) {
    if (compact.includes(category) && CATEGORY_VALUES.has(category)) {
      found.add(category);
    }
  }

  return sortCnhCategories([...found]).slice(0, 4);
}

function extractName(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!/^NOME\b/i.test(lines[i])) continue;

    const inline = lines[i].replace(/^NOME\s*/i, "").trim();
    if (inline.length >= 3 && !SECTION_HEADERS.test(inline)) {
      return titleCase(inline);
    }

    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const candidate = lines[j].trim();
      if (candidate.length < 3 || SECTION_HEADERS.test(candidate) || /\d{5,}/.test(candidate)) {
        continue;
      }
      return titleCase(candidate);
    }
  }

  return null;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildFilledFields(result: Omit<CnhOcrResult, "filledFields" | "rawText">): string[] {
  const filledFields: string[] = [];
  if (result.name) filledFields.push("nome");
  if (result.document) filledFields.push("CPF");
  if (result.cnh_number) filledFields.push("CNH");
  if (result.cnh_expiry_date) filledFields.push("vencimento");
  if (result.cnh_categories.length) filledFields.push("categorias");
  return filledFields;
}

export function parseCnhOcrText(rawText: string, source = "ocr"): CnhOcrResult {
  const normalized = normalizeOcrText(rawText);
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const name = extractName(lines);
  const document = extractCpf(normalized);
  const cnh_number = extractCnhNumber(normalized);
  const cnh_expiry_date = extractExpiryDate(lines);
  const cnh_categories = extractCategories(normalized, lines);

  const filledFields = buildFilledFields({
    name,
    document,
    cnh_number,
    cnh_expiry_date,
    cnh_categories,
    sources: [source],
  });

  return {
    name,
    document,
    cnh_number,
    cnh_expiry_date,
    cnh_categories,
    rawText,
    filledFields,
    sources: [source],
  };
}

export function mergeCnhOcrResults(results: CnhOcrResult[]): CnhOcrResult {
  if (results.length === 0) {
    return {
      name: null,
      document: null,
      cnh_number: null,
      cnh_expiry_date: null,
      cnh_categories: [],
      rawText: "",
      filledFields: [],
      sources: [],
    };
  }

  const merged = {
    name: null as string | null,
    document: null as string | null,
    cnh_number: null as string | null,
    cnh_expiry_date: null as string | null,
    cnh_categories: [] as string[],
    sources: [] as string[],
  };

  for (const result of results) {
    if (!merged.name && result.name) merged.name = result.name;
    if (!merged.document && result.document) merged.document = result.document;
    if (!merged.cnh_number && result.cnh_number) merged.cnh_number = result.cnh_number;
    if (!merged.cnh_expiry_date && result.cnh_expiry_date) {
      merged.cnh_expiry_date = result.cnh_expiry_date;
    }
    merged.cnh_categories = sortCnhCategories([
      ...new Set([...merged.cnh_categories, ...result.cnh_categories]),
    ]);
    merged.sources.push(...(result.sources ?? []));
  }

  const rawText = results.map((item) => item.rawText).filter(Boolean).join("\n---\n");
  const filledFields = buildFilledFields(merged);

  return {
    ...merged,
    rawText,
    filledFields,
  };
}

async function recognizeWithLocalTesseract(file: File): Promise<CnhOcrResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por");
  try {
    const { data } = await worker.recognize(file);
    return parseCnhOcrText(data.text ?? "", "tesseract-local");
  } finally {
    await worker.terminate();
  }
}

export async function recognizeCnhImage(
  file: File
): Promise<{ result: CnhOcrResult; engine: OcrEngine }> {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/ocr/cnh", {
      method: "POST",
      body: formData,
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        result: CnhOcrResult;
        engine: OcrEngine;
      };
      return {
        result: {
          ...payload.result,
          sources: [payload.engine],
        },
        engine: payload.engine,
      };
    }
  } catch {
    // fallback local
  }

  const result = await recognizeWithLocalTesseract(file);
  return { result, engine: "tesseract" };
}

export async function recognizeCnhImages(
  files: File[],
  onProgress?: (message: string) => void
): Promise<{ result: CnhOcrResult; engine: OcrEngine; engines: OcrEngine[] }> {
  const partials: CnhOcrResult[] = [];
  const engines: OcrEngine[] = [];

  for (let index = 0; index < files.length; index++) {
    onProgress?.(`Lendo documento ${index + 1} de ${files.length}...`);
    const { result, engine } = await recognizeCnhImage(files[index]);
    partials.push(result);
    engines.push(engine);
  }

  return {
    result: mergeCnhOcrResults(partials),
    engine: engines.includes("google-vision") ? "google-vision" : "tesseract",
    engines,
  };
}

export type ApplyCnhOcrOptions = {
  /**
   * Renovação / nova CNH: sobrescreve número, validade e categorias quando o OCR ler.
   * Nome e CPF continuam só preenchendo campos vazios.
   */
  renewCnh?: boolean;
};

function formatCnhNumberForForm(value: string): string {
  const formatted = normalizeCnh(value);
  return `${formatted.slice(0, 3)}.${formatted.slice(3, 6)}.${formatted.slice(6, 9)}-${formatted.slice(9)}`;
}

/** Aplica OCR no formulário. Em renovação, a nova validade substitui a antiga (limpa alerta). */
export function applyCnhOcrToForm(
  current: Record<string, unknown>,
  result: CnhOcrResult,
  options?: ApplyCnhOcrOptions
): Record<string, unknown> {
  const renewCnh = options?.renewCnh !== false;
  const next = { ...current };

  if (result.name && !String(current.name ?? "").trim()) next.name = result.name;
  if (result.document && !String(current.document ?? "").trim()) next.document = result.document;

  if (result.cnh_number) {
    const formatted = formatCnhNumberForForm(result.cnh_number);
    if (renewCnh || !String(current.cnh_number ?? "").trim()) {
      next.cnh_number = formatted;
    }
  }

  if (result.cnh_expiry_date) {
    const currentExpiry = String(current.cnh_expiry_date ?? "").trim();
    if (renewCnh || !currentExpiry) {
      next.cnh_expiry_date = result.cnh_expiry_date;
    }
  }

  if (result.cnh_categories.length) {
    if (renewCnh) {
      next.cnh_categories = sortCnhCategories(result.cnh_categories);
    } else {
      const currentCategories = Array.isArray(current.cnh_categories)
        ? (current.cnh_categories as string[])
        : [];
      next.cnh_categories = sortCnhCategories([
        ...new Set([...currentCategories, ...result.cnh_categories]),
      ]);
    }
  }

  return next;
}

/** Campos de CNH que mudaram (para mensagem de alerta limpo). */
export function cnhFieldsUpdatedByOcr(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  const changed: string[] = [];
  if (String(before.cnh_number ?? "") !== String(after.cnh_number ?? "")) {
    changed.push("número");
  }
  if (String(before.cnh_expiry_date ?? "") !== String(after.cnh_expiry_date ?? "")) {
    changed.push("vencimento");
  }
  const beforeCats = Array.isArray(before.cnh_categories)
    ? (before.cnh_categories as string[]).join(",")
    : "";
  const afterCats = Array.isArray(after.cnh_categories)
    ? (after.cnh_categories as string[]).join(",")
    : "";
  if (beforeCats !== afterCats) changed.push("categorias");
  return changed;
}
