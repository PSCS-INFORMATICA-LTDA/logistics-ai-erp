"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { useAccess } from "@/lib/access-context";
import { screenKeyFromPath } from "@/lib/app-screens";
import { cn } from "@/lib/utils";

type NavChild = { href: string; label: string };
type NavItem =
  | { href: string; label: string; icon?: string; children?: undefined }
  | { label: string; href?: undefined; icon?: undefined; children: NavChild[] };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  {
    label: "Operacional",
    children: [
      { href: "/operacional/ordens-servico", label: "Ordens de Serviço" },
      { href: "/operacional/infracoes", label: "Infrações de Trânsito" },
    ],
  },
  {
    label: "DRE",
    children: [{ href: "/dre/despesas-motorista", label: "Despesas motorista / ajudante" }],
  },
  {
    label: "Cadastros",
    children: [
      { href: "/cadastros/socios", label: "Sócios" },
      { href: "/cadastros/veiculos", label: "Veículos" },
      { href: "/cadastros/participacoes", label: "Participações" },
      { href: "/cadastros/contas-dre", label: "Contas DRE" },
      { href: "/cadastros/motoristas", label: "Motoristas" },
      { href: "/cadastros/clientes", label: "Clientes" },
      { href: "/cadastros/fornecedores", label: "Fornecedores" },
    ],
  },
  {
    label: "Configurações",
    children: [
      { href: "/configuracoes/integracoes", label: "Integrações" },
      { href: "/configuracoes/parametros", label: "Parâmetros" },
    ],
  },
];

function SidebarNavLink({
  href,
  label,
  icon,
  child,
}: {
  href: string;
  label: string;
  icon?: string;
  child?: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={cn(
        "sidebar-nav-btn",
        child && "sidebar-nav-btn--child",
        active && "sidebar-nav-btn--active"
      )}
    >
      {icon ? <span className="text-base leading-none">{icon}</span> : null}
      {label}
    </Link>
  );
}

export function Sidebar() {
  const { canViewScreen, loading } = useAccess();

  const visibleNav = NAV.map((item) => {
    if (item.href) {
      const key = screenKeyFromPath(item.href);
      if (key && !canViewScreen(key) && !loading) return null;
      return item;
    }
    const children = (item.children ?? []).filter((child) => {
      const key = screenKeyFromPath(child.href);
      if (!key) return true;
      return loading || canViewScreen(key);
    });
    if (children.length === 0) return null;
    return { ...item, children };
  }).filter(Boolean) as NavItem[];

  return (
    <aside className="sidebar-shell flex w-64 flex-col border-r border-white/10 text-white">
      <div className="sidebar-brand-zone">
        <Link href="/dashboard" className="brand-logo-link">
          <BrandLogo variant="mark" size="sm" className="brand-logo-mark--sidebar" />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {visibleNav.map((item) =>
          item.href ? (
            <SidebarNavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
            />
          ) : (
            <div key={item.label} className="sidebar-nav-group" aria-label={item.label}>
              {item.children?.map((child) => (
                <SidebarNavLink
                  key={child.href}
                  href={child.href}
                  label={child.label}
                  child
                />
              ))}
            </div>
          )
        )}
      </nav>
      <footer className="sidebar-footer">
        <p className="sidebar-footer-note">PSCS Informática</p>
      </footer>
    </aside>
  );
}
