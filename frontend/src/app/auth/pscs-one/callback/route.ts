import { NextRequest, NextResponse } from "next/server";
import { PscsOneCompanyService } from "@/lib/pscs-one/companyService";
import {
  executePscsOneCallback,
  logPscsOneSsoCallback,
} from "@/lib/pscs-one/callbackFlow";
import { pscsOneCallbackUri } from "@/lib/pscs-one/config";
import { evaluateLogisticsSsoSupabase } from "@/lib/pscs-one/devSupabaseGuard";
import { PscsOneIdentityService } from "@/lib/pscs-one/identityService";
import { PscsOneSessionAdapter } from "@/lib/pscs-one/sessionAdapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function loginDenied(request: NextRequest, reason: string) {
  const url = new URL("/login", request.nextUrl.origin);
  url.searchParams.set("error", "SSO One negado");
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const correlation_id = crypto.randomUUID();
  const ssoGate = evaluateLogisticsSsoSupabase(process.env);
  if (!ssoGate.ok) {
    logPscsOneSsoCallback({
      correlation_id,
      stage: "callback_params",
      result: "failure",
      reason: ssoGate.reason,
    });
    return loginDenied(request, ssoGate.reason);
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.nextUrl.origin));

  const result = await executePscsOneCallback(
    {
      code: request.nextUrl.searchParams.get("code"),
      origin: request.nextUrl.origin,
    },
    {
      exchangeAuthorizationCode: (code) => PscsOneIdentityService.exchangeAuthorizationCode(code),
      ensureLocalUser: (identity) => PscsOneSessionAdapter.ensureLocalUser(identity),
      ensureMembership: (authUserId, companyId) =>
        PscsOneCompanyService.ensureMembership(authUserId, companyId),
      verifySession: async (tokenHash) =>
        PscsOneSessionAdapter.attachSessionCookie(request, response, tokenHash),
      writeCookies: (cookies) => {
        for (const cookie of cookies) {
          response.cookies.set(cookie.name, cookie.value, {
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            secure: cookie.secure,
            path: cookie.path,
            maxAge: cookie.maxAge,
          });
        }
      },
    },
  );

  logPscsOneSsoCallback({
    correlation_id,
    stage: result.stage,
    result: result.ok ? "success" : "failure",
    reason: result.ok ? undefined : result.reason,
  });

  if (!result.ok) {
    return loginDenied(request, result.reason);
  }

  return response;
}

export async function POST() {
  return NextResponse.json(
    { error: "method_not_allowed", redirect_uri: pscsOneCallbackUri() },
    { status: 405 },
  );
}
