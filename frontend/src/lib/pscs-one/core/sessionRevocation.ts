import { PSCS_ONE_MAPPED_COMPANY_COOKIE } from "../config";
import { PSCS_ONE_CORE_COMPANY_COOKIE, PSCS_ONE_CORE_SESSION_COOKIE } from "./config";

export type RevokedSessionCookie = {
  name: string;
  value: string;
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: 0;
};

export function revokedPscsOneSessionCookies(): RevokedSessionCookie[] {
  return [PSCS_ONE_CORE_SESSION_COOKIE, PSCS_ONE_CORE_COMPANY_COOKIE, PSCS_ONE_MAPPED_COMPANY_COOKIE].map(
    (name) => ({
      name,
      value: "",
      httpOnly: name !== PSCS_ONE_MAPPED_COMPANY_COOKIE,
      sameSite: "lax" as const,
      secure: true,
      path: "/" as const,
      maxAge: 0 as const,
    }),
  );
}
