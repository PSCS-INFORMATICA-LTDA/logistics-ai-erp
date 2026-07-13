import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthPage = request.nextUrl.pathname.startsWith("/login");
  const isAuthFlowPage =
    request.nextUrl.pathname.startsWith("/auth/callback") ||
    request.nextUrl.pathname.startsWith("/auth/redefinir-senha");
  const isSetupPage = request.nextUrl.pathname.startsWith("/setup");
  const isPublicProposal = request.nextUrl.pathname.startsWith("/proposta/");
  const isPublicDriverAssignment = request.nextUrl.pathname.startsWith("/designacao/");

  if (
    !user &&
    !isAuthPage &&
    !isAuthFlowPage &&
    !isPublicProposal &&
    !isPublicDriverAssignment
  ) {
    const url = request.nextUrl.clone();
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const next = request.nextUrl.searchParams.get("next");
    if (next?.startsWith("/")) {
      return NextResponse.redirect(new URL(next, request.nextUrl.origin));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Em /auth/redefinir-senha o usuário chega autenticado pelo link de e-mail — não redirecionar.
  if (user && !isSetupPage && !isAuthPage && !isAuthFlowPage) {
    const { count } = await supabase
      .from("company_members")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (count === 0) {
      const url = request.nextUrl.clone();
      url.pathname = "/setup";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
