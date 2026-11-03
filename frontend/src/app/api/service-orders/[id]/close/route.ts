import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  closeServiceOrderOperationally,
  createSupabaseOperationalCloseStore,
  OperationalCloseError,
} from "@/lib/service-order-operational-close";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof OperationalCloseError) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "LOCAL_CLOSE_FAILED",
        message: "Não foi possível concluir a OS. Tente novamente.",
      },
    },
    { status: 503 },
  );
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: serviceOrderId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthenticated", message: "Authentication required." } },
      { status: 401 },
    );
  }

  try {
    const result = await closeServiceOrderOperationally({
      authUserId: user.id,
      serviceOrderId,
      store: createSupabaseOperationalCloseStore(supabase),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
