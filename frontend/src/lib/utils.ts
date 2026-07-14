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
  if (!y || !m || !d) return String(value);
  return `${d}/${m}/${y}`;
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
