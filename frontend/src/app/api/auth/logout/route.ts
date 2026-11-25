import { NextResponse } from "next/server";
import { revokedPscsOneSessionCookies } from "@/lib/pscs-one/core/sessionRevocation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    response.headers.set("x-logistics-signout", "failed");
  }
  for (const cookie of revokedPscsOneSessionCookies()) {
    response.cookies.set(cookie.name, cookie.value, {
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
      path: cookie.path,
      maxAge: cookie.maxAge,
    });
  }
  return response;
}
