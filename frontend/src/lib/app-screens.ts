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
    key: "operacional.agenda-veiculos",
    label: "Agenda da Frota",
    group: "Operacional",
    href: "/operacional/agenda-veiculos",
  },
  {
    key: "operacional.ordens-servico",
    label: "Ordem de Serviço — Transporte e Frete",
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
    key: "operacional.infracoes",
    label: "Infrações de Trânsito",
    group: "Operacional",
    href: "/operacional/infracoes",
  },
  {
    key: "operacional.documentos-a-vencer",
    label: "Documentos a vencer",
    group: "Operacional",
    href: "/operacional/documentos-a-vencer",
  },
  {
    key: "dre.lancamentos",
    label: "Lançamentos da Empresa",
    group: "DRE",
    href: "/dre/lancamentos",
  },
  {
    key: "dre.aprovacoes",
    label: "Aprovações de lançamentos",
    group: "DRE",
    href: "/dre/aprovacoes",
  },
  {
    key: "dre.despesas-motorista",
    label: "Despesas Motorista / Ajudante",
    group: "DRE",
    href: "/dre/despesas-motorista",
  },
  {
    key: "dre.despesas-veiculo",
    label: "Despesas do Veículo",
    group: "DRE",
    href: "/dre/despesas-veiculo",
  },
  {
    key: "dre.rateio-os",
    label: "Rateio por OS",
    group: "DRE",
    href: "/dre/rateio-os",
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
    key: "configuracoes.parametros-patio",
    label: "Parâmetros do Pátio",
    group: "Parâmetros",
    href: "/configuracoes/parametros-patio",
  },
  {
    key: "configuracoes.parametros-frete",
    label: "Parâmetros de Frete",
    group: "Parâmetros",
    href: "/configuracoes/parametros-frete",
  },
  {
    key: "configuracoes.documentos-licencas",
    label: "Documentos e licenças",
    group: "Parâmetros",
    href: "/configuracoes/documentos-licencas",
  },
  {
    key: "configuracoes.parametros",
    label: "Senha Máster - Concessão de Acessos",
    group: "Parâmetros",
    href: "/configuracoes/parametros",
  },
  {
    key: "configuracoes.historico-exclusoes",
    label: "Histórico de Exclusões",
    group: "Parâmetros",
    href: "/configuracoes/historico-exclusoes",
  },
  {
    key: "configuracoes.usuarios",
    label: "Usuários e acessos",
    group: "Configurações",
    href: "/configuracoes/usuarios",
  },
  {
    key: "configuracoes.empresa",
    label: "Empresa",
    group: "Configurações",
    href: "/configuracoes/empresa",
  },
  {
    key: "configuracoes.integracoes",
    label: "Integrações",
    group: "Configurações",
    href: "/configuracoes/integracoes",
  },
  {
    key: "configuracoes.mensalidade",
    label: "Renovação da Licença",
    group: "Configurações",
    href: "/configuracoes/mensalidade",
  },
];

export function screenKeyFromPath(pathname: string): string | null {
  const match = APP_SCREENS.find(
    (s) => pathname === s.href || pathname.startsWith(`${s.href}/`)
  );
  return match?.key ?? null;
}

/** Primeira tela liberada (ordem do menu), ou null se nenhuma. */
export function firstAllowedHref(canView: (screenKey: string) => boolean): string | null {
  for (const screen of APP_SCREENS) {
    if (
      screen.key === "configuracoes.parametros" ||
      screen.key === "configuracoes.historico-exclusoes" ||
      screen.key === "configuracoes.usuarios"
    ) {
      continue;
    }
    if (canView(screen.key)) return screen.href;
  }
  return null;
}

export const FULL_ACCESS: ScreenPermissionFlags = {
  can_view: true,
  can_edit: true,
  can_delete: true,
};
