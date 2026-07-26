"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccess } from "@/lib/access-context";
import { screenKeyFromPath } from "@/lib/app-screens";
import { glassTabLink, glassTabsNav } from "@/lib/liquid-glass-styles";

const TABS = [
  {
    href: "/dre/lancamentos",
    label: "Lançamentos da Empresa",
    shortLabel: "Lançamentos",
  },
  { href: "/dre/aprovacoes", label: "Aprovações", shortLabel: "Aprovações" },
  {
    href: "/dre/despesas-motorista",
    label: "Despesas Motorista / Ajudante",
    shortLabel: "Motorista / Ajudante",
  },
  {
    href: "/dre/despesas-veiculo",
    label: "Despesas do Veículo",
    shortLabel: "Veículo",
  },
  { href: "/dre/rateio-os", label: "Rateio por OS", shortLabel: "Rateio" },
] as const;

export function DreSubNav() {
  const pathname = usePathname();
  const { canViewScreen, loading } = useAccess();

  const tabs = TABS.filter((tab) => {
    if (loading) return false;
    const key = screenKeyFromPath(tab.href);
    return !key || canViewScreen(key);
  });

  if (tabs.length === 0) return null;

  return (
    <nav className={glassTabsNav()}>
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={glassTabLink(active)}
            title={tab.label}
          >
            <span className="sm:hidden">{tab.shortLabel}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
