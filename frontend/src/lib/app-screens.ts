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
    key: "operacional.estacionamento",
    label: "Estacionamento",
    group: "Operacional",
    href: "/operacional/estacionamento",
  },
  {
    key: "operacional.lava-rapido",
    label: "Lava-rápido",
    group: "Operacional",
    href: "/operacional/lava-rapido",
  },
  {
    key: "operacional.agenda-veiculos",
    label: "Agenda da frota",
    group: "Operacional",
    href: "/operacional/agenda-veiculos",
  },
  {
    key: "operacional.infracoes",
    label: "Infrações de Trânsito",
    group: "Operacional",
    href: "/operacional/infracoes",
  },
  {
    key: "dre.lancamentos",
    label: "Lançamentos da empresa",
    group: "DRE",
    href: "/dre/lancamentos",
  },
  {
    key: "dre.despesas-motorista",
    label: "Despesas motorista / ajudante",
    group: "DRE",
    href: "/dre/despesas-motorista",
  },
  {
    key: "dre.despesas-veiculo",
    label: "Despesas do veículo",
    group: "DRE",
    href: "/dre/despesas-veiculo",
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
    key: "configuracoes.parametros-frete",
    label: "Parâmetros de frete",
    group: "Configurações",
    href: "/configuracoes/parametros-frete",
  },
  {
    key: "configuracoes.parametros-patio",
    label: "Parâmetros do pátio",
    group: "Configurações",
    href: "/configuracoes/parametros-patio",
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
