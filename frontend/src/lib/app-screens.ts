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
  {
    key: "financeiro.contas-a-pagar",
    label: "Contas a Pagar",
    group: "Financeiro",
    href: "/financeiro/contas-a-pagar",
  },
  {
    key: "financeiro.contas",
    label: "Contas Financeiras",
    group: "Financeiro",
    href: "/financeiro/contas",
  },
  {
    key: "financeiro.pagamentos-motorista",
    label: "Pagamentos de motorista",
    group: "Financeiro",
    href: "/cadastros/motoristas/pagamentos",
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
  const matches = APP_SCREENS.filter(
    (s) => pathname === s.href || pathname.startsWith(`${s.href}/`),
  );
  matches.sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.key ?? null;
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

export type CompanyMemberRole = "admin" | "financeiro" | "operacional" | "socio";

/**
 * Matriz explícita. Acesso total só para admin da própria empresa (o isolamento
 * entre empresas fica no RLS). Ausência de partner_id não amplia permissão.
 *
 * Decisões de menor privilégio, porque o papel não tinha lista comprovada:
 * - operacional e socio sem partner_id: OS (proposta, follow-up, fechamento e
 *   designação na mesma tela) e cadastro de motoristas. Sem financeiro, DRE,
 *   pátio ou configurações.
 * - financeiro sem partner_id: Contas a Pagar, Contas Financeiras e a baixa
 *   de pagamento do motorista. Sem DRE, sem configurações e sem administração.
 * - /cadastros/motoristas/pagamentos não herda o cadastro de motoristas.
 * - DRE permanece só com admin até haver regra de negócio explícita.
 * - Com partner_id, a matriz partner_screen_permissions continua valendo, mas
 *   não devolve financeiro a operacional/socio nem configurações a quem não é admin.
 * - Financeiro com partner_id mantém as telas financeiras mesmo se a matriz
 *   não as marcar. Isso não cria administração.
 */
export const OPERATIONAL_SCREEN_KEYS = [
  "operacional.ordens-servico",
  "cadastros.motoristas",
] as const;

export const FINANCE_ROLE_SCREEN_KEYS = [
  "financeiro.contas-a-pagar",
  "financeiro.contas",
  "financeiro.pagamentos-motorista",
] as const;

const OPERATIONAL_SCREEN_SET = new Set<string>(OPERATIONAL_SCREEN_KEYS);
const FINANCE_ROLE_SCREEN_SET = new Set<string>(FINANCE_ROLE_SCREEN_KEYS);

export function asCompanyMemberRole(role: string | null | undefined): CompanyMemberRole | null {
  if (
    role === "admin" ||
    role === "financeiro" ||
    role === "operacional" ||
    role === "socio"
  ) {
    return role;
  }
  return null;
}

export function isSettingsScreen(screenKey: string): boolean {
  return screenKey.startsWith("configuracoes.");
}

export function isDirectFinanceScreen(screenKey: string): boolean {
  return screenKey.startsWith("financeiro.") || screenKey.startsWith("dre.");
}

export function canRoleViewScreen(input: {
  role: CompanyMemberRole | null;
  partnerId: string | null;
  screenKey: string;
  partnerCanView?: boolean;
}): boolean {
  const { role, partnerId, screenKey } = input;
  if (role === "admin") return true;
  if (!role) return false;
  if (isSettingsScreen(screenKey)) return false;
  if (isDirectFinanceScreen(screenKey) && role !== "financeiro") return false;
  if (role === "financeiro" && FINANCE_ROLE_SCREEN_SET.has(screenKey)) return true;
  if (partnerId) return Boolean(input.partnerCanView);
  if (role === "financeiro") return FINANCE_ROLE_SCREEN_SET.has(screenKey);
  if (role === "operacional" || role === "socio") return OPERATIONAL_SCREEN_SET.has(screenKey);
  return false;
}

/** Edit segue a visão, exceto na matriz de sócio, que tem flag própria. */
export function canRoleEditScreen(input: {
  role: CompanyMemberRole | null;
  partnerId: string | null;
  screenKey: string;
  partnerCanView?: boolean;
  partnerCanEdit?: boolean;
}): boolean {
  if (!canRoleViewScreen(input)) return false;
  if (input.role === "admin") return true;
  if (
    input.role === "financeiro" &&
    FINANCE_ROLE_SCREEN_SET.has(input.screenKey)
  ) {
    return true;
  }
  if (input.partnerId) return Boolean(input.partnerCanEdit);
  return true;
}

/** Exclusão de cadastro não faz parte da allowlist operacional. */
export function canRoleDeleteScreen(input: {
  role: CompanyMemberRole | null;
  partnerId: string | null;
  screenKey: string;
  partnerCanView?: boolean;
  partnerCanDelete?: boolean;
}): boolean {
  if (!canRoleViewScreen(input)) return false;
  if (input.role === "admin") return true;
  if (
    input.role === "financeiro" &&
    FINANCE_ROLE_SCREEN_SET.has(input.screenKey)
  ) {
    return true;
  }
  if (input.partnerId) return Boolean(input.partnerCanDelete);
  return false;
}

/**
 * Autorização das rotas /api já autenticadas.
 * Fechamento, frete e OCR continuam no fluxo operacional.
 * Recebível, Core AR, billing mutável, integrações, convite e auditoria não.
 */
export function apiAuthorization(
  role: CompanyMemberRole | null,
  pathname: string,
): "allow" | "deny" {
  if (pathname.startsWith("/api/freight/") || pathname.startsWith("/api/ocr/")) {
    return "allow";
  }
  if (/^\/api\/service-orders\/[^/]+\/close\/?$/.test(pathname)) return "allow";
  if (/^\/api\/service-orders\/[^/]+\/receivable\/?$/.test(pathname)) {
    return role === "admin" || role === "financeiro" ? "allow" : "deny";
  }
  if (pathname.startsWith("/api/core-ar/")) {
    return role === "admin" || role === "financeiro" ? "allow" : "deny";
  }
  if (pathname === "/api/billing/status" || pathname.startsWith("/api/billing/status/")) {
    return "allow";
  }
  if (
    pathname.startsWith("/api/billing/") ||
    pathname.startsWith("/api/integrations/") ||
    pathname.startsWith("/api/company/members/") ||
    pathname.startsWith("/api/audit/")
  ) {
    return role === "admin" ? "allow" : "deny";
  }
  return "allow";
}
