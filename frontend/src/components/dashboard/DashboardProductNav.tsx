"use client";

import { cn } from "@/lib/utils";

export type DashboardProductTab =
  | "geral"
  | "frete"
  | "estacionamento"
  | "lava";

const TABS: { id: DashboardProductTab; label: string; hint: string }[] = [
  { id: "geral", label: "Geral", hint: "Participação dos produtos" },
  { id: "frete", label: "Frete / Transporte", hint: "Frota" },
  { id: "estacionamento", label: "Estacionamento", hint: "Pátio" },
  { id: "lava", label: "Lava-rápido", hint: "Lavagem" },
];

type Props = {
  value: DashboardProductTab;
  onChange: (tab: DashboardProductTab) => void;
};

/** Navegação por produto (subpastas do Dashboard). */
export function DashboardProductNav({ value, onChange }: Props) {
  return (
    <nav
      aria-label="Produtos do dashboard"
      className="flex flex-wrap gap-2 border-b border-slate-200/80 pb-3"
    >
      {TABS.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "rounded-xl px-3.5 py-2 text-left transition",
              active
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-white/70 text-slate-700 ring-1 ring-slate-200/80 hover:bg-slate-50"
            )}
          >
            <span className="block text-sm font-semibold">{tab.label}</span>
            <span
              className={cn(
                "block text-[11px]",
                active ? "text-white/80" : "text-slate-500"
              )}
            >
              {tab.hint}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
