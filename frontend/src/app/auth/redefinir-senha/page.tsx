import { cookies } from "next/headers";
import { RECOVERY_GRANT_COOKIE } from "@/lib/auth/recovery-redirect";
import { RedefinirSenhaForm } from "./redefinir-senha-form";

export default async function RedefinirSenhaPage() {
  const jar = await cookies();
  const recoveryGrant = jar.get(RECOVERY_GRANT_COOKIE)?.value === "1";
  return <RedefinirSenhaForm recoveryGrant={recoveryGrant} />;
}
