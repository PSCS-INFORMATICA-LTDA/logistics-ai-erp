/** Hash da senha master (SHA-256 + salt) — uso no browser / parâmetros. */

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
