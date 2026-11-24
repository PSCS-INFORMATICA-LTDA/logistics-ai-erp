"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccess } from "@/lib/access-context";
import { glassTabLink, glassTabsNav } from "@/lib/liquid-glass-styles";

const TABS = [
  { href: "/cadastros/motoristas", label: "Cadastro", exact: true },
  { href: "/cadastros/motoristas/pagamentos", label: "Acompanhamento de pagamentos", exact: false },
] as const;

export function MotoristasSubNav() {
  const pathname = usePathname();
  const { canViewScreen, loading } = useAccess();
  const tabs = TABS.filter((tab) => {
    if (tab.href !== "/cadastros/motoristas/pagamentos") return true;
    return !loading && canViewScreen("financeiro.pagamentos-motorista");
  });

  return (
    <nav className={glassTabsNav()}>
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={glassTabLink(active)}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
