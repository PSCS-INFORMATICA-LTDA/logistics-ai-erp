import { type NextRequest, NextResponse } from "next/server";
import { hasAuthSession, mapPasswordAuthError } from "@/lib/auth/password-login";
import { createRouteHandlerClient } from "@/lib/supabase/route";

export const dynamic = "force-dynamic";

type PasswordLoginBody = {
  email?: string;
  password?: string;
};

/**
 * Server-side password login — establishes Supabase auth cookies on the HTTP
 * response (same contract as PSCS One SSO via createRouteHandlerClient).
 */
export async function POST(request: NextRequest) {
  let body: PasswordLoginBody;
  try {
    body = (await request.json()) as PasswordLoginBody;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "E-mail e senha são obrigatórios." }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  const supabase = createRouteHandlerClient(request, response);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return NextResponse.json({ error: mapPasswordAuthError(error) }, { status: 401 });
  }

  const session = data?.session ?? (await supabase.auth.getSession()).data?.session;
  if (!hasAuthSession(session)) {
    return NextResponse.json(
      {
        error:
          "Não foi possível iniciar a sessão. Confirme seu e-mail ou tente novamente.",
      },
      { status: 401 },
    );
  }

  return response;
}
