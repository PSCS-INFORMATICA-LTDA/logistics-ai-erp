import { NextResponse } from "next/server";
import { hasAuthSession, mapPasswordAuthError } from "@/lib/auth/password-login";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PasswordLoginBody = {
  email?: string;
  password?: string;
};

/**
 * Server-side password login — establishes the same Supabase auth cookies that
 * middleware and Server Components expect (parity with /auth/callback and SSO).
 */
export async function POST(request: Request) {
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

  const supabase = await createClient();
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

  return NextResponse.json({ ok: true });
}
