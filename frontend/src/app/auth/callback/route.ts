import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Callback do Supabase Auth (confirmação de e-mail e link de recuperação).
 * Troca o ?code= pela sessão e redireciona para `next`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextRaw = url.searchParams.get("next") || "/dashboard";
  const next = nextRaw.startsWith("/") ? nextRaw : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const login = new URL("/login", url.origin);
      login.searchParams.set("error", "Não foi possível confirmar o link. Tente novamente.");
      return NextResponse.redirect(login);
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
