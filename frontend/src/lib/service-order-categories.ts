/**
 * Natureza DRE na OS geral: só Frete e Transporte.
 * Estacionamento e Lava-rápido usam os módulos próprios (e contas DRE próprias).
 */

export const SERVICE_ORDER_CATEGORY_OPTIONS = [
  {
    value: "Transporte",
    label: "Transporte",
    dreAccountName: "Receita Van",
    hint: "Passageiros / van e micro-ônibus",
  },
  {
    value: "Frete",
    label: "Frete",
    dreAccountName: "Receita Caminhão",
    hint: "Carga e caminhões",
  },
] as const;

/** Labels para exibir naturezas legadas já salvas no banco. */
const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  Estacionamento: "Estacionamento",
  Lavagem: "Lavagem rápida",
  Outros: "Outros",
};

export type ServiceOrderCategory = (typeof SERVICE_ORDER_CATEGORY_OPTIONS)[number]["value"];

const DRE_PRIORITY: ServiceOrderCategory[] = ["Frete", "Transporte"];

export function toggleServiceCategory(categories: string[], value: string): string[] {
  const set = new Set(categories);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return SERVICE_ORDER_CATEGORY_OPTIONS.map((o) => o.value).filter((v) => set.has(v));
}

export function formatServiceCategories(categories: string[]): string {
  const labels = categories
    .map((value) => {
      const opt = SERVICE_ORDER_CATEGORY_OPTIONS.find((o) => o.value === value);
      if (opt) return opt.label;
      return LEGACY_CATEGORY_LABELS[value] ?? value;
    })
    .filter(Boolean);
  return labels.join(", ");
}

export function resolveDreAccountName(categories: string[]): string | null {
  for (const key of DRE_PRIORITY) {
    if (categories.includes(key)) {
      return (
        SERVICE_ORDER_CATEGORY_OPTIONS.find((o) => o.value === key)?.dreAccountName ?? null
      );
    }
  }
  return null;
}

export function getCategoryHint(categories: string[]): string | null {
  const selected = SERVICE_ORDER_CATEGORY_OPTIONS.filter((o) => categories.includes(o.value));
  if (selected.length === 0) return null;
  return selected.map((o) => `${o.label}: ${o.hint}`).join(" · ");
}

const SERVICE_TYPE_TO_CATEGORY: Record<string, ServiceOrderCategory> = {
  Frete: "Frete",
  Transporte: "Transporte",
};

export function categoriesForServiceType(serviceType: string): string[] {
  const category = SERVICE_TYPE_TO_CATEGORY[serviceType];
  return category ? [category] : [];
}
