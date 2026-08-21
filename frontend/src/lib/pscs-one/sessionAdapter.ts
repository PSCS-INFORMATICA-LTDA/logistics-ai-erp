import type { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createRouteHandlerClient } from "@/lib/supabase/route";
import { pscsOneCallbackUri } from "./config";
import type { PscsOneIdentityV1 } from "./types";

async function findAuthUserIdByEmail(
  admin: NonNullable<ReturnType<typeof createServiceClient>>,
  email: string,
): Promise<string | null> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (profile?.id) return String(profile.id);

  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listed.error) throw new Error(listed.error.message);
  const match = listed.data?.users?.find(
    (user) => user.email?.toLowerCase() === email.toLowerCase(),
  );
  return match?.id ?? null;
}

export class PscsOneSessionAdapter {
  static async ensureLocalUser(identity: PscsOneIdentityV1): Promise<{
    authUserId: string;
    email: string;
    tokenHash: string;
  }> {
    const admin = createServiceClient();
    if (!admin) {
      throw new Error("sso_admin_unconfigured");
    }

    const email = identity.email?.trim().toLowerCase();
    if (!email) {
      throw new Error("identity_email_missing");
    }

    const linked = await admin
      .from("profiles")
      .select("id, email, pscs_one_user_id")
      .eq("pscs_one_user_id", identity.user_id)
      .maybeSingle();
    if (linked.error) throw new Error(linked.error.message);

    let authUserId = linked.data?.id ? String(linked.data.id) : null;
    if (!authUserId) {
      authUserId = await findAuthUserIdByEmail(admin, email);
    }

    if (!authUserId) {
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (created.error || !created.data.user?.id) {
        throw new Error(created.error?.message || "create_user_failed");
      }
      authUserId = created.data.user.id;
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, email, pscs_one_user_id")
      .eq("id", authUserId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);

    if (profile?.pscs_one_user_id && profile.pscs_one_user_id !== identity.user_id) {
      throw new Error("identity_conflict");
    }

    if (profile) {
      const { error } = await admin
        .from("profiles")
        .update({
          pscs_one_user_id: identity.user_id,
          email,
        })
        .eq("id", authUserId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("profiles").insert({
        id: authUserId,
        email,
        full_name: email.split("@")[0] || "User",
        pscs_one_user_id: identity.user_id,
      });
      if (error) throw new Error(error.message);
    }

    const redirectTo = `${new URL(pscsOneCallbackUri()).origin}/dashboard`;
    const link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    const tokenHash = link.data.properties?.hashed_token;
    if (link.error || !tokenHash) {
      throw new Error(link.error?.message || "session_link_failed");
    }

    return { authUserId, email, tokenHash };
  }

  static async attachSessionCookie(
    request: NextRequest,
    response: NextResponse,
    tokenHash: string,
  ): Promise<{ accessTokenPresent: boolean; refreshTokenPresent: boolean }> {
    const supabase = createRouteHandlerClient(request, response);
    const verified = await supabase.auth.verifyOtp({
      type: "email",
      token_hash: tokenHash,
    });
    if (verified.error) {
      throw new Error(verified.error.message);
    }
    return {
      accessTokenPresent: Boolean(verified.data.session?.access_token),
      refreshTokenPresent: Boolean(verified.data.session?.refresh_token),
    };
  }
}
