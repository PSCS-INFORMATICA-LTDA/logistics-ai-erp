"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { useAccess } from "@/lib/access-context";
import { firstAllowedHref, screenKeyFromPath } from "@/lib/app-screens";
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
      { href: "/operacional/agenda-veiculos", label: "Agenda da Frota" },
      {
        href: "/operacional/ordens-servico",
        label: "Ordem de Serviço — Transporte e Frete",
      },
      { href: "/operacional/estacionamento", label: "Estacionamento" },
      { href: "/operacional/lava-rapido", label: "Lava-rápido" },
      { href: "/operacional/infracoes", label: "Infrações de Trânsito" },
    ],
  },
  {
    label: "DRE",
    children: [
      { href: "/dre/lancamentos", label: "Lançamentos da Empresa" },
      { href: "/dre/despesas-motorista", label: "Despesas Motorista / Ajudante" },
      { href: "/dre/despesas-veiculo", label: "Despesas do Veículo" },
    ],
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
    label: "Parâmetros",
    children: [
      { href: "/configuracoes/parametros-patio", label: "Parâmetros do pátio" },
      { href: "/configuracoes/parametros-frete", label: "Parâmetros de frete" },
      {
        href: "/configuracoes/parametros",
        label: "Senha Máster - Concessão de Acessos",
      },
      {
        href: "/configuracoes/historico-exclusoes",
        label: "Histórico de exclusões",
      },
    ],
  },
  {
    label: "Configurações",
    children: [
      { href: "/configuracoes/empresa", label: "Empresa" },
      { href: "/configuracoes/integracoes", label: "Integrações" },
      { href: "/configuracoes/mensalidade", label: "Renovação da licença" },
    ],
  },
];

function SidebarNavLink({
  href,
  label,
  icon,
  child,
  onNavigate,
}: {
  href: string;
  label: string;
  icon?: string;
  child?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={label}
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

type SidebarProps = {
  mobileOpen?: boolean;
  onClose?: () => void;
};

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const { canViewScreen, loading } = useAccess();
  const homeHref = firstAllowedHref(canViewScreen) ?? "/dashboard";

  const visibleNav = NAV.map((item) => {
    if (item.href) {
      const key = screenKeyFromPath(item.href);
      if (loading) return null;
      if (key && !canViewScreen(key)) return null;
      return item;
    }
    const children = (item.children ?? []).filter((child) => {
      const key = screenKeyFromPath(child.href);
      if (!key) return true;
      // Enquanto carrega permissões, não liberar menu inteiro (evita flash).
      if (loading) return false;
      return canViewScreen(key);
    });
    if (children.length === 0) return null;
    return { ...item, children };
  }).filter(Boolean) as NavItem[];

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[2px] transition-opacity lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        aria-hidden={!mobileOpen}
        onClick={onClose}
      />

      <aside
        className={cn(
          "sidebar-shell fixed inset-y-0 left-0 z-50 flex w-[min(20.5rem,92vw)] flex-col border-r border-white/10 text-white transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-80 lg:translate-x-0 lg:shrink-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        aria-label="Menu principal"
      >
        <div className="sidebar-brand-zone">
          <Link href={homeHref} className="brand-logo-link" onClick={onClose}>
            <BrandLogo variant="mark" size="sm" className="brand-logo-mark--sidebar" />
          </Link>
          <button
            type="button"
            className="sidebar-close-btn"
            aria-label="Fechar menu"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 [-webkit-overflow-scrolling:touch]">
          {visibleNav.map((item) =>
            item.href ? (
              <SidebarNavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                onNavigate={onClose}
              />
            ) : (
              <div key={item.label} className="sidebar-nav-group" aria-label={item.label}>
                <p className="sidebar-nav-group-label">{item.label}</p>
                {item.children?.map((child) => (
                  <SidebarNavLink
                    key={child.href}
                    href={child.href}
                    label={child.label}
                    child
                    onNavigate={onClose}
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
    </>
  );
}
