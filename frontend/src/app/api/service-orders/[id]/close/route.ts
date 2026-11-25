import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  closeServiceOrderOperationally,
  createSupabaseOperationalCloseStore,
  OperationalCloseError,
} from "@/lib/service-order-operational-close";
import {
  closeServiceOrderWithCoreReceivable,
  createSupabaseLogisticsCloseStore,
  resolveServiceOrderCloseMode,
} from "@/lib/pscs-one/core/closeServiceOrder";
import { createSupabaseArIdentityLoader } from "@/lib/pscs-one/core/arIdentity";
import { CoreArError } from "@/lib/pscs-one/core/errors";
import { decideSharedIdentity } from "@/lib/pscs-one/identityGate";
import { requireCoreArSession } from "@/lib/pscs-one/core/requestAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof OperationalCloseError || error instanceof CoreArError) {
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
      { ok: false, error: { code: "unauthenticated", message: "Authentication required." } },
      { status: 401 },
    );
  }

  try {
    if (resolveServiceOrderCloseMode() === "operational") {
      const result = await closeServiceOrderOperationally({
        authUserId: user.id,
        serviceOrderId,
        store: createSupabaseOperationalCloseStore(supabase),
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const cookieHeader = request.headers.get("cookie");
    const coreSession = requireCoreArSession(cookieHeader);
    const loadIdentity = createSupabaseArIdentityLoader(supabase, coreSession, user.id);
    const result = await closeServiceOrderWithCoreReceivable({
      authUserId: user.id,
      serviceOrderId,
      cookieHeader,
      coreSession,
      store: createSupabaseLogisticsCloseStore(supabase),
      loadIdentity: async (context) => {
        const actor = await loadIdentity(context);
        const decision = decideSharedIdentity(actor);
        if (!decision.arWrite) {
          throw new CoreArError("core_unauthorized", "A sessão não autoriza o recebível. A OS não foi concluída.", 403);
        }
        return actor;
      },
    });
    return NextResponse.json({
      ok: true,
      order: result.order,
      receivable_created: result.receivable_created,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
