"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { glassTabLink, glassTabsNav } from "@/lib/liquid-glass-styles";

const TABS = [
  { href: "/dre/lancamentos", label: "Lançamentos da empresa" },
  { href: "/dre/despesas-motorista", label: "Despesas motorista / ajudante" },
  { href: "/dre/despesas-veiculo", label: "Despesas do veículo" },
] as const;

export function DreSubNav() {
  const pathname = usePathname();

  return (
    <nav className={glassTabsNav()}>
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link key={tab.href} href={tab.href} className={glassTabLink(active)}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
