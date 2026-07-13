/** Validação e formatação de documentos brasileiros (CPF, CNPJ, RG). */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** CPF (11) ou CNPJ (14) — formata conforme o tamanho digitado. */
export function formatCpfCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  return d.length > 11 ? formatCnpj(d) : formatCpf(d);
}

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const nums = cpf.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += nums[i] * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== nums[9]) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += nums[i] * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === nums[10];
}

export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const nums = cnpj.split("").map(Number);
  const calc = (base: number[], weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + base[i] * w, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(nums, w1);
  if (d1 !== nums[12]) return false;
  const d2 = calc(nums, w2);
  return d2 === nums[13];
}

/** RG: alfanumérico, 5–14 caracteres após limpar pontuação (padrão prático BR). */
export function normalizeRg(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function formatRg(value: string): string {
  return normalizeRg(value).slice(0, 14);
}

export function isValidRg(value: string): boolean {
  const rg = normalizeRg(value);
  if (rg.length < 5 || rg.length > 14) return false;
  return /^[A-Z0-9]+$/.test(rg);
}

export type PartnerDocumentKind = "cpf" | "cnpj";

export function documentKindForPartnerType(partnerType: string): PartnerDocumentKind {
  return partnerType === "Empresa" ? "cnpj" : "cpf";
}

/** Valida CPF/CNPJ conforme o tipo do sócio. Vazio = ok (campo opcional na gravação). */
export function validatePartnerDocument(
  partnerType: string,
  raw: string
): string | null {
  const digits = onlyDigits(raw);
  if (!digits) return null;

  if (documentKindForPartnerType(partnerType) === "cnpj") {
    if (digits.length !== 14) return "CNPJ deve ter 14 dígitos.";
    if (!isValidCnpj(digits)) return "CNPJ inválido — confira os dígitos verificadores.";
    return null;
  }

  if (digits.length !== 11) return "CPF deve ter 11 dígitos.";
  if (!isValidCpf(digits)) return "CPF inválido — confira os dígitos verificadores.";
  return null;
}

export function validatePartnerRg(partnerType: string, raw: string): string | null {
  if (partnerType === "Empresa") return null;
  const value = raw.trim();
  if (!value) return null;
  if (!isValidRg(value)) {
    return "RG inválido — use 5 a 14 caracteres alfanuméricos (sem espaços).";
  }
  return null;
}
