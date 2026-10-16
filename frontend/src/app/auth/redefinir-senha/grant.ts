"use server";

import { cookies } from "next/headers";
import { RECOVERY_GRANT_COOKIE } from "@/lib/auth/recovery-redirect";

export async function clearRecoveryGrant() {
  const jar = await cookies();
  jar.delete(RECOVERY_GRANT_COOKIE);
}
