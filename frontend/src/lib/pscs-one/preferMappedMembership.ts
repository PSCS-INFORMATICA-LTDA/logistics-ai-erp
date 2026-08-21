export function pickMappedMembership<T extends { company_id: string }>(
  memberships: T[],
  mappedCompanyId: string | null | undefined,
): T | undefined {
  if (memberships.length === 0) return undefined;
  if (mappedCompanyId) {
    const mapped = memberships.find((row) => row.company_id === mappedCompanyId);
    if (mapped) return mapped;
  }
  return memberships[0];
}

export function mappedCompanyIdFromCookieHeader(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)pscs_one_mapped_company_id=([^;]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
