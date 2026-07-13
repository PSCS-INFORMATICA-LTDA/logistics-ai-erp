/** Catálogo de telas do GRX para permissões de acesso. */

export type ScreenPermissionFlags = {
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

export type AppScreen = {
  key: string;
  label: string;
  group: string;
  href: string;
};

export const APP_SCREENS: AppScreen[] = [
  { key: "dashboard", label: "Dashboard", group: "Geral", href: "/dashboard" },
  {
    key: "operacional.ordens-servico",
    label: "Ordens de Serviço",
    group: "Operacional",
    href: "/operacional/ordens-servico",
  },
  {
    key: "operacional.infracoes",
    label: "Infrações de Trânsito",
    group: "Operacional",
    href: "/operacional/infracoes",
  },
  {
    key: "dre.despesas-motorista",
    label: "Despesas motorista / ajudante",
    group: "DRE",
    href: "/dre/despesas-motorista",
  },
  { key: "cadastros.socios", label: "Sócios", group: "Cadastros", href: "/cadastros/socios" },
  { key: "cadastros.veiculos", label: "Veículos", group: "Cadastros", href: "/cadastros/veiculos" },
  {
    key: "cadastros.participacoes",
    label: "Participações",
    group: "Cadastros",
    href: "/cadastros/participacoes",
  },
  {
    key: "cadastros.contas-dre",
    label: "Contas DRE",
    group: "Cadastros",
    href: "/cadastros/contas-dre",
  },
  {
    key: "cadastros.motoristas",
    label: "Motoristas",
    group: "Cadastros",
    href: "/cadastros/motoristas",
  },
  { key: "cadastros.clientes", label: "Clientes", group: "Cadastros", href: "/cadastros/clientes" },
  {
    key: "cadastros.fornecedores",
    label: "Fornecedores",
    group: "Cadastros",
    href: "/cadastros/fornecedores",
  },
  {
    key: "configuracoes.integracoes",
    label: "Integrações",
    group: "Configurações",
    href: "/configuracoes/integracoes",
  },
  {
    key: "configuracoes.mensalidade",
    label: "Mensalidade",
    group: "Configurações",
    href: "/configuracoes/mensalidade",
  },
  {
    key: "configuracoes.parametros",
    label: "Parâmetros (acesso master)",
    group: "Configurações",
    href: "/configuracoes/parametros",
  },
];

export function screenKeyFromPath(pathname: string): string | null {
  const match = APP_SCREENS.find(
    (s) => pathname === s.href || pathname.startsWith(`${s.href}/`)
  );
  return match?.key ?? null;
}

export const FULL_ACCESS: ScreenPermissionFlags = {
  can_view: true,
  can_edit: true,
  can_delete: true,
};
