/** Password login helpers — shared by UI and tests. */

export function sanitizeAuthNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/dashboard";
  const trimmed = next.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/dashboard";
  return trimmed;
}

export function mapPasswordAuthError(
  error: { message?: string; code?: string } | null | undefined,
): string {
  if (!error) {
    return "Não foi possível entrar. Tente novamente.";
  }

  const code = error.code?.toLowerCase() ?? "";
  const message = error.message?.toLowerCase() ?? "";

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos.";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }
  if (code === "too_many_requests" || message.includes("too many requests")) {
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }
  if (message.includes("network") || message.includes("fetch")) {
    return "Falha de conexão. Verifique sua internet e tente novamente.";
  }

  const raw = error.message?.trim();
  return raw || "Não foi possível entrar. Tente novamente.";
}

export function hasAuthSession(session: unknown): boolean {
  return Boolean(session && typeof session === "object" && "access_token" in session);
}

export type PasswordLoginResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/** Browser → server password login; cookies are set by the route handler. */
export async function submitPasswordLogin(
  email: string,
  password: string,
): Promise<PasswordLoginResult> {
  const res = await fetch("/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email, password }),
  });

  let payload: { error?: string; ok?: boolean } = {};
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    payload = {};
  }

  if (!res.ok) {
    return {
      ok: false,
      error:
        typeof payload.error === "string" ? payload.error : mapPasswordAuthError(null),
      status: res.status,
    };
  }

  return { ok: true };
}
