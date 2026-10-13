export type ServiceOrderClientLinkStatus = "LINKED" | "LEGACY_UNLINKED";

/** OS pronta para um faturamento futuro só quando o cliente do cadastro está vinculado. */
export function serviceOrderClientLinkStatus(row: {
  client_id?: string | null;
}): ServiceOrderClientLinkStatus {
  return row.client_id ? "LINKED" : "LEGACY_UNLINKED";
}

export function normalizeClientMatchKey(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export type ClientMatchRow = {
  id: string;
  name?: string | null;
  trade_name?: string | null;
  status?: string | null;
  deleted_at?: string | null;
};

/**
 * Um único cliente ativo da lista, pelo nome ou nome fantasia normalizado.
 * Zero ou mais de um resultado não escolhe ninguém.
 */
export function resolveUniqueClientId(
  clients: ClientMatchRow[],
  rawName: string | null | undefined,
): { clientId: string | null; reason: "missing" | "unmatched" | "ambiguous" | null } {
  const key = normalizeClientMatchKey(rawName);
  if (!key) return { clientId: null, reason: "missing" };

  const ids = new Set<string>();
  for (const client of clients) {
    if (client.deleted_at) continue;
    if (client.status && client.status !== "Ativo") continue;
    const nameKey = normalizeClientMatchKey(client.name);
    const tradeKey = normalizeClientMatchKey(client.trade_name);
    if (nameKey === key || (tradeKey !== "" && tradeKey === key)) {
      ids.add(client.id);
    }
  }

  if (ids.size === 1) return { clientId: [...ids][0], reason: null };
  if (ids.size === 0) return { clientId: null, reason: "unmatched" };
  return { clientId: null, reason: "ambiguous" };
}
