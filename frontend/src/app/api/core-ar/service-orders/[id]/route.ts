import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CoreArError } from "@/lib/pscs-one/core/errors";
import { requireCoreArSession } from "@/lib/pscs-one/core/requestAuth";
import { loadServiceOrderCoreArView } from "@/lib/pscs-one/core/serviceOrderAr";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof CoreArError) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { ok: false, error: { code: "core_unavailable", message: "Unexpected Core AR error." } },
    { status: 502 },
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: serviceOrderId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: { code: "core_unauthenticated", message: "Authentication required." } },
      { status: 401 },
    );
  }

  try {
    const coreSession = requireCoreArSession(request.headers.get("cookie"));
    const view = await loadServiceOrderCoreArView({
      supabase,
      authUserId: user.id,
      serviceOrderId,
      cookieHeader: request.headers.get("cookie"),
      coreSession,
    });
    return NextResponse.json({ ok: true, ...view });
  } catch (error) {
    return errorResponse(error);
  }
}
