export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function normalizePlate(plate: string): string {
  return plate.replace(/[\s-]/g, "").toUpperCase();
}

export function generateCode(prefix: string, count: number): string {
  return `${prefix}${String(count + 1).padStart(3, "0")}`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

/** Exibe data ISO `YYYY-MM-DD` como `DD/MM/YYYY`. */
export function formatDateBR(value: string | null | undefined): string {
  if (!value) return "—";
  const datePart = String(value).slice(0, 10);
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d || y.length !== 4) return String(value);
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) {
    return String(value);
  }
  return `${d}/${m}/${y}`;
}

/** True se o valor parece data ISO (só data ou datetime). */
export function isIsoDateString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(s)) return true;
  return false;
}

/**
 * Formata valores de célula/lista para exibição BR.
 * Datas ISO → DD/MM/AAAA; demais valores inalterados.
 */
export function formatDisplayValueBR(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  const s = String(value);
  if (isIsoDateString(s)) {
    const dateLabel = formatDateBR(s);
    const timeMatch = s.match(/[T\s](\d{2}:\d{2})/);
    if (timeMatch && dateLabel !== "—") return `${dateLabel} ${timeMatch[1]}`;
    return dateLabel;
  }
  return s;
}

/** Data + hora: `14/07/2026 17:00`. */
export function formatDateTimeBR(
  date: string | null | undefined,
  time?: string | null
): string {
  const dateLabel = formatDateBR(date);
  if (dateLabel === "—") return "—";
  const timePart = time ? String(time).slice(0, 5) : "";
  return timePart ? `${dateLabel} ${timePart}` : dateLabel;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function isSimilarName(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return levenshtein(na, nb) <= 2;
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
    }
  }
  return matrix[b.length][a.length];
}
