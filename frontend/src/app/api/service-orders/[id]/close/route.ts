import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CoreArError } from "@/lib/pscs-one/core/errors";
import { requireCoreArSession } from "@/lib/pscs-one/core/requestAuth";
import {
  closeServiceOrderWithCoreReceivable,
  createSupabaseLogisticsCloseStore,
} from "@/lib/pscs-one/core/closeServiceOrder";

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
    {
      ok: false,
      error: {
        code: "core_unavailable",
        message: "Não foi possível registrar o recebível. A OS não foi concluída.",
      },
    },
    { status: 502 },
  );
}

export async function POST(
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
    const result = await closeServiceOrderWithCoreReceivable({
      authUserId: user.id,
      serviceOrderId,
      cookieHeader: request.headers.get("cookie"),
      coreSession,
      store: createSupabaseLogisticsCloseStore(supabase),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
