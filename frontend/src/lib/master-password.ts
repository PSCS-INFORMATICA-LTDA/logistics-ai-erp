/** Hash da senha master e frase de recuperação (SHA-256 + salt). */

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createSalt(length = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return bytesToHex(bytes.buffer);
}

export async function hashMasterPassword(password: string, salt: string): Promise<string> {
  const payload = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return bytesToHex(digest);
}

export async function verifyMasterPassword(
  password: string,
  salt: string,
  expectedHash: string
): Promise<boolean> {
  const hash = await hashMasterPassword(password, salt);
  return hash === expectedHash;
}

/** Normaliza frase: minúsculas, sem acento, só letras/números/espaços. */
export function normalizeRecoveryPhrase(phrase: string): string {
  return phrase
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateRecoveryPhrase(phrase: string): string | null {
  const normalized = normalizeRecoveryPhrase(phrase);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 3) {
    return "A frase de recuperação precisa ter pelo menos 3 palavras.";
  }
  if (normalized.length < 12) {
    return "A frase de recuperação é muito curta — use algo que só você lembre.";
  }
  return null;
}

export async function hashRecoveryPhrase(phrase: string, salt: string): Promise<string> {
  return hashMasterPassword(normalizeRecoveryPhrase(phrase), salt);
}

export async function verifyRecoveryPhrase(
  phrase: string,
  salt: string,
  expectedHash: string
): Promise<boolean> {
  const hash = await hashRecoveryPhrase(phrase, salt);
  return hash === expectedHash;
}

const SESSION_KEY = "grx_master_unlocked";

export function isMasterSessionUnlocked(companyId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as { companyId?: string; at?: number };
    return data.companyId === companyId;
  } catch {
    return false;
  }
}

export function setMasterSessionUnlocked(companyId: string) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ companyId, at: Date.now() }));
}

export function clearMasterSession() {
  sessionStorage.removeItem(SESSION_KEY);
}
