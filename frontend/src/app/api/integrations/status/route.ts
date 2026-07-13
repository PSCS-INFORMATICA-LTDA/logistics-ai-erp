import { NextResponse } from "next/server";
import {
  INTEGRATION_MODULES,
  isQualpConfigured,
  resolveIntegrationStatus,
} from "@/lib/integrations";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function envConfigured(key: string): boolean {
  const value = process.env[key]?.trim();
  return Boolean(value && value !== "your-qualp-access-token" && !value.startsWith("your-"));
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const configured = {
    QUALP_API_TOKEN: envConfigured("QUALP_API_TOKEN"),
    CIOT_ONLINE_API_TOKEN: envConfigured("CIOT_ONLINE_API_TOKEN"),
    GOOGLE_VISION_API_KEY: envConfigured("GOOGLE_VISION_API_KEY"),
    ASAAS_API_KEY: envConfigured("ASAAS_API_KEY"),
  };

  const modules = INTEGRATION_MODULES.map((module) => ({
    ...module,
    status: resolveIntegrationStatus(module, configured),
    configured: module.envVar ? configured[module.envVar as keyof typeof configured] ?? false : true,
  }));

  return NextResponse.json({
    plan: isQualpConfigured(configured) ? "paid_qualp" : "free",
    planLabel: isQualpConfigured(configured) ? "Com QualP (pedágios automáticos)" : "Gratuito",
    modules,
    setupHint:
      "Para ativar o plano pago, adicione QUALP_API_TOKEN no .env.local do servidor e reinicie o npm run dev.",
  });
}
