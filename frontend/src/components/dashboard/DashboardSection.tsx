"use client";

import type { ReactNode } from "react";
import { glassFilterPanel } from "@/lib/liquid-glass-styles";

type Props = {
  id: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

/** Seção recolhível do Dashboard (subpasta visual por gráfico). */
export function DashboardSection({
  id,
  title,
  subtitle,
  defaultOpen = true,
  children,
}: Props) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className={`group ${glassFilterPanel()} overflow-hidden`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 marker:content-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        <span
          aria-hidden
          className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="mt-4 border-t border-slate-100/80 pt-4">{children}</div>
    </details>
  );
}
