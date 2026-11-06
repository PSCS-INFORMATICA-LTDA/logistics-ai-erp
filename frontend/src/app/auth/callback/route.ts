import { NextResponse } from "next/server";
import {
  PASSWORD_RECOVERY_NEXT_PATH,
  RECOVERY_GRANT_COOKIE,
  resolveRecoveryCallback,
} from "@/lib/auth/recovery-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Callback do Supabase Auth (confirmação de e-mail e link de recuperação).
 * Troca o ?code= pela sessão na mesma origem e não devolve o código na URL seguinte.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  let exchangeError: { message?: string; code?: string } | null = null;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      exchangeError = { code: error.code, message: error.message };
    }
  }

  const decision = resolveRecoveryCallback({
    requestUrl: request.url,
    exchangeError,
  });
  const response = NextResponse.redirect(decision.location);
  if (decision.setRecoveryGrant) {
    response.cookies.set(RECOVERY_GRANT_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: PASSWORD_RECOVERY_NEXT_PATH,
      maxAge: 60 * 10,
    });
  }
  return response;
}
