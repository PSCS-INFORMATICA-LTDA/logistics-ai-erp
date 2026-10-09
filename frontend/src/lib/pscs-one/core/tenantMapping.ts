import { PSCS_ONE_CORE_COMPANY_COOKIE } from "./config";
import { CoreArError } from "./errors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readCoreCompanyIdFromCookieHeader(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${PSCS_ONE_CORE_COMPANY_COOKIE}=([^;]+)`),
  );
  const value = match?.[1] ? decodeURIComponent(match[1].trim()) : null;
  return value && UUID_RE.test(value) ? value : null;
}

export function assertLogisticsCompanyMatchesMapping(input: {
  logisticsCompanyId: string;
  mappedLogisticsCompanyId: string | null;
}): void {
  if (!input.mappedLogisticsCompanyId) {
    throw new CoreArError(
      "tenant_mapping_missing",
      "PSCS One company mapping is missing. Sign in via PSCS One SSO.",
      409,
    );
  }
  if (input.mappedLogisticsCompanyId !== input.logisticsCompanyId) {
    throw new CoreArError(
      "tenant_mapping_missing",
      "Active company does not match the PSCS One mapped tenant.",
      409,
    );
  }
}
