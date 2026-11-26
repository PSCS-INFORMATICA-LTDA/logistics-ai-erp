import type { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createRouteHandlerClient } from "@/lib/supabase/route";
import { pscsOneCallbackUri } from "./config";
import type { PscsOneIdentityV1 } from "./types";

const AUTH_PAGE_SIZE = 200;
const AUTH_PAGE_LIMIT = 50;

type SsoAdmin = NonNullable<ReturnType<typeof createServiceClient>>;

type ProfileLink = {
  id: string;
  email: string | null;
  pscs_one_user_id: string | null;
};

type AuthUserRecord = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
};

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function confirmedAuthEmail(user: AuthUserRecord | null | undefined): string | null {
  const email = normalizeEmail(user?.email);
  if (!email || !user?.email_confirmed_at) return null;
  return email;
}

async function findConfirmedAuthUserByEmail(admin: SsoAdmin, email: string): Promise<AuthUserRecord | null> {
  const matches: AuthUserRecord[] = [];
  let unverified = false;

  for (let page = 1; page <= AUTH_PAGE_LIMIT; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
    if (listed.error) throw new Error(listed.error.message);
    const users = (listed.data?.users ?? []) as AuthUserRecord[];
    for (const user of users) {
      if (normalizeEmail(user.email) !== email) continue;
      const confirmed = confirmedAuthEmail(user);
      if (!confirmed) {
        unverified = true;
        continue;
      }
      matches.push(user);
    }
    if (users.length < AUTH_PAGE_SIZE) break;
    if (page === AUTH_PAGE_LIMIT) throw new Error("auth_directory_unbounded");
  }

  if (matches.length > 1) throw new Error("duplicate_auth_email");
  if (matches.length === 1) return matches[0];
  if (unverified) throw new Error("auth_email_unverified");
  return null;
}

async function readProfile(admin: SsoAdmin, column: "id" | "pscs_one_user_id", value: string): Promise<ProfileLink | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, pscs_one_user_id")
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProfileLink | null) ?? null;
}

function isDuplicateWrite(error: { message?: string } | null | undefined): boolean {
  const text = error?.message?.toLowerCase() ?? "";
  return /already been registered|already registered|already exists|duplicate key|duplicate/.test(text);
}

async function updateOwnedEmail(
  admin: SsoAdmin,
  profileId: string,
  identityUserId: string,
  email: string,
): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({ email })
    .eq("id", profileId)
    .eq("pscs_one_user_id", identityUserId);
  if (error) throw new Error(error.message);
}

async function claimProfileLink(
  admin: SsoAdmin,
  authUserId: string,
  identityUserId: string,
  trustedEmail: string,
): Promise<void> {
  const profile = await readProfile(admin, "id", authUserId);
  if (profile?.pscs_one_user_id && profile.pscs_one_user_id !== identityUserId) {
    throw new Error("identity_conflict");
  }
  if (profile?.pscs_one_user_id === identityUserId) {
    if (normalizeEmail(profile.email) !== trustedEmail) {
      await updateOwnedEmail(admin, authUserId, identityUserId, trustedEmail);
    }
    return;
  }

  if (profile) {
    const claimed = await admin
      .from("profiles")
      .update({ pscs_one_user_id: identityUserId, email: trustedEmail })
      .eq("id", authUserId)
      .is("pscs_one_user_id", null)
      .select("id, pscs_one_user_id");
    if (claimed.error) throw new Error(claimed.error.message);
    if (claimed.data?.[0]?.pscs_one_user_id === identityUserId) return;
    const current = await readProfile(admin, "id", authUserId);
    if (current?.pscs_one_user_id === identityUserId) return;
    throw new Error("identity_conflict");
  }

  const inserted = await admin.from("profiles").insert({
    id: authUserId,
    email: trustedEmail,
    full_name: trustedEmail.split("@")[0] || "User",
    pscs_one_user_id: identityUserId,
  });
  if (!inserted.error) return;
  if (!isDuplicateWrite(inserted.error)) throw new Error(inserted.error.message);

  const owner = await readProfile(admin, "pscs_one_user_id", identityUserId);
  if (owner && owner.id !== authUserId) throw new Error("identity_conflict");
  const current = await readProfile(admin, "id", authUserId);
  if (current?.pscs_one_user_id === identityUserId) return;
  if (current?.pscs_one_user_id) throw new Error("identity_conflict");
  if (!current) throw new Error("identity_conflict");

  const retried = await admin
    .from("profiles")
    .update({ pscs_one_user_id: identityUserId, email: trustedEmail })
    .eq("id", authUserId)
    .is("pscs_one_user_id", null)
    .select("id, pscs_one_user_id");
  if (retried.error) throw new Error(retried.error.message);
  if (retried.data?.[0]?.pscs_one_user_id === identityUserId) return;
  const after = await readProfile(admin, "id", authUserId);
  if (after?.pscs_one_user_id === identityUserId) return;
  throw new Error("identity_conflict");
}

export function assertAuthenticatedUser(actual: string | null | undefined, expected: string): void {
  if (!actual || actual !== expected) throw new Error("session_user_mismatch");
}

export class PscsOneSessionAdapter {
  static async ensureLocalUser(
    identity: PscsOneIdentityV1,
    adminOverride?: SsoAdmin,
  ): Promise<{
    authUserId: string;
    email: string;
    tokenHash: string;
  }> {
    const admin = adminOverride ?? createServiceClient();
    if (!admin) {
      throw new Error("sso_admin_unconfigured");
    }

    const email = normalizeEmail(identity.email);
    if (!email) {
      throw new Error("identity_email_missing");
    }

    const linked = await readProfile(admin, "pscs_one_user_id", identity.user_id);
    let authUserId: string;
    let trustedEmail: string;

    if (linked) {
      const authUser = await admin.auth.admin.getUserById(linked.id);
      if (authUser.error || !authUser.data.user) throw new Error("auth_user_missing");
      const confirmed = confirmedAuthEmail(authUser.data.user as AuthUserRecord);
      if (confirmed !== email) throw new Error("identity_conflict");
      authUserId = linked.id;
      trustedEmail = confirmed;
      if (normalizeEmail(linked.email) !== trustedEmail) {
        await updateOwnedEmail(admin, linked.id, identity.user_id, trustedEmail);
      }
    } else {
      let authUser = await findConfirmedAuthUserByEmail(admin, email);
      if (!authUser) {
        const created = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
        });
        if (created.error || !created.data.user?.id) {
          if (!isDuplicateWrite(created.error)) {
            throw new Error(created.error?.message || "create_user_failed");
          }
          authUser = await findConfirmedAuthUserByEmail(admin, email);
          if (!authUser) throw new Error("create_user_failed");
        } else {
          const reread = await admin.auth.admin.getUserById(created.data.user.id);
          if (reread.error || !reread.data.user) throw new Error("auth_user_missing");
          const confirmed = confirmedAuthEmail(reread.data.user as AuthUserRecord);
          if (confirmed !== email) throw new Error("auth_email_unverified");
          authUser = reread.data.user as AuthUserRecord;
        }
      }

      const confirmed = confirmedAuthEmail(authUser);
      if (!confirmed) throw new Error("auth_email_unverified");
      authUserId = authUser.id;
      trustedEmail = confirmed;
      await claimProfileLink(admin, authUserId, identity.user_id, trustedEmail);
    }

    const redirectTo = `${new URL(pscsOneCallbackUri()).origin}/dashboard`;
    const link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: trustedEmail,
      options: { redirectTo },
    });
    const tokenHash = link.data.properties?.hashed_token;
    if (link.error || !tokenHash) {
      throw new Error(link.error?.message || "session_link_failed");
    }

    return { authUserId, email: trustedEmail, tokenHash };
  }

  static async attachSessionCookie(
    request: NextRequest,
    response: NextResponse,
    tokenHash: string,
    expectedAuthUserId: string,
  ): Promise<{ accessTokenPresent: boolean; refreshTokenPresent: boolean }> {
    const supabase = createRouteHandlerClient(request, response);
    const verified = await supabase.auth.verifyOtp({
      type: "email",
      token_hash: tokenHash,
    });
    if (verified.error) {
      throw new Error(verified.error.message);
    }
    const sessionUserId = verified.data.user?.id ?? verified.data.session?.user?.id;
    assertAuthenticatedUser(sessionUserId, expectedAuthUserId);
    return {
      accessTokenPresent: Boolean(verified.data.session?.access_token),
      refreshTokenPresent: Boolean(verified.data.session?.refresh_token),
    };
  }
}
