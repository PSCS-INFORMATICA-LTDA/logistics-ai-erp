import { createClient } from "@/lib/supabase/client";
import { generateCode } from "@/lib/utils";

export async function nextCode(
  table: string,
  companyId: string,
  prefix: string
): Promise<string> {
  const supabase = createClient();
  const { count } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId);
  return generateCode(prefix, count ?? 0);
}

/**
 * Próximo código numérico sequencial (ex.: 00000001).
 * Campo fica editável no formulário — o usuário pode trocar o número.
 */
export async function nextNumericCode(
  table: string,
  companyId: string,
  digits = 8
): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.from(table).select("code").eq("company_id", companyId);

  let max = 0;
  for (const row of data ?? []) {
    const raw = String((row as { code?: string }).code ?? "").trim();
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }

  const next = max + 1;
  if (next >= 10 ** digits) return String(next);
  return String(next).padStart(digits, "0");
}

/** Só dígitos; no máximo `digits` posições; completa com zeros à esquerda. */
export function normalizeNumericCode(value: unknown, digits = 8): string {
  const digitsOnly = String(value ?? "").replace(/\D/g, "").slice(0, digits);
  if (!digitsOnly) return "";
  return digitsOnly.padStart(digits, "0");
}

export function isValidNumericCode(value: unknown, digits = 8): boolean {
  const normalized = normalizeNumericCode(value, digits);
  return normalized.length === digits && /^\d+$/.test(normalized);
}

/**
 * Normaliza código numérico novo; na edição, preserva código legado (ex.: VEI001)
 * se o usuário não alterou o valor.
 */
export function resolveEntityNumericCode(
  value: unknown,
  options?: { existingCode?: string | null; digits?: number }
): { ok: true; code: string } | { ok: false } {
  const digits = options?.digits ?? 8;
  const raw = String(value ?? "").trim();
  const normalized = normalizeNumericCode(raw, digits);
  if (isValidNumericCode(normalized, digits)) {
    return { ok: true, code: normalized };
  }
  const existing = String(options?.existingCode ?? "").trim();
  if (existing && raw === existing) {
    return { ok: true, code: existing };
  }
  return { ok: false };
}

/** True se já existe outro registro com o mesmo código na empresa. */
export async function isEntityCodeTaken(
  table: string,
  companyId: string,
  code: string,
  excludeId?: string | null
): Promise<{ taken: boolean; error?: string }> {
  const supabase = createClient();
  let query = supabase
    .from(table)
    .select("id")
    .eq("company_id", companyId)
    .eq("code", code)
    .limit(1);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query;
  if (error) return { taken: false, error: error.message };
  return { taken: (data?.length ?? 0) > 0 };
}

export function formatDuplicateCodeError(code: string): string {
  return `Já existe um cadastro com o código ${code} nesta empresa. Escolha outro número.`;
}

export function isUniqueConstraintError(message: string | null | undefined): boolean {
  const text = String(message ?? "").toLowerCase();
  return (
    text.includes("duplicate key") ||
    text.includes("unique constraint") ||
    text.includes("23505")
  );
}
