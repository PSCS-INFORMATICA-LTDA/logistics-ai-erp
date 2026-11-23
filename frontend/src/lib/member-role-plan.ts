/** Papéis que o administrador pode atribuir nesta tela. Sócio permanece no vínculo existente. */
export const ASSIGNABLE_ROLES = ["admin", "financeiro", "operacional"] as const;

export const KNOWN_MEMBER_ROLES = ["admin", "financeiro", "operacional", "socio"] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export type KnownMemberRole = (typeof KNOWN_MEMBER_ROLES)[number];

export function knownMemberRole(role: string | null | undefined): KnownMemberRole | null {
  if (role === "admin" || role === "financeiro" || role === "operacional" || role === "socio") {
    return role;
  }
  return null;
}

export function parseAssignableRole(value: unknown): AssignableRole | null {
  if (typeof value !== "string") return null;
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value) ? (value as AssignableRole) : null;
}

export function roleLabel(role: string | null | undefined): string {
  if (role === "admin") return "Administrador";
  if (role === "financeiro") return "Financeiro";
  if (role === "operacional") return "Operacional";
  if (role === "socio") return "Sócio";
  return "Papel desconhecido";
}

/** Lê o papel gravado sem reduzi-lo a operacional. */
export function presentMemberRole(role: string | null | undefined): {
  role: KnownMemberRole | null;
  label: string;
  canApproveLaunches: boolean;
} {
  const parsed = knownMemberRole(role);
  return {
    role: parsed,
    label: roleLabel(parsed),
    canApproveLaunches: parsed === "admin",
  };
}

/**
 * Convite: somente administrador, e somente com papel explícito.
 * Valor ausente ou desconhecido não vira operacional.
 */
export function authorizeMemberInvite(
  callerRole: string | null | undefined,
  requestedRole: unknown,
):
  | { ok: true; role: AssignableRole }
  | { ok: false; status: 403 | 400; error: string } {
  if (callerRole !== "admin") {
    return {
      ok: false,
      status: 403,
      error: "Somente administrador pode convidar usuários.",
    };
  }
  const role = parseAssignableRole(requestedRole);
  if (!role) {
    return {
      ok: false,
      status: 400,
      error: "Papel inválido. Escolha administrador, financeiro ou operacional.",
    };
  }
  return { ok: true, role };
}

/**
 * Quem pode gravar a troca: administrador do vínculo da empresa do alvo.
 * Financeiro, operacional, sócio e quem não pertence a essa empresa não alteram papéis.
 */
export function authorizeMemberRoleCaller(
  callerRoleInTargetCompany: string | null | undefined,
): { ok: true } | { ok: false; status: 403; error: string } {
  if (callerRoleInTargetCompany !== "admin") {
    return {
      ok: false,
      status: 403,
      error: "Somente administrador pode alterar papéis.",
    };
  }
  return { ok: true };
}

/**
 * Troca explícita entre administrador, financeiro e operacional.
 * Papel omitido ou desconhecido não vira operacional, e sócio não é reescrito.
 */
export function planMemberRoleChange(input: {
  currentRole: string | null | undefined;
  requestedRole: unknown;
  adminCount: number;
}): { ok: true; role: AssignableRole } | { ok: false; error: string } {
  const current = knownMemberRole(input.currentRole);
  const requested = parseAssignableRole(input.requestedRole);
  if (!current) {
    return { ok: false, error: "Papel atual desconhecido. Nenhuma alteração aplicada." };
  }
  if (!requested) {
    return {
      ok: false,
      error: "Papel inválido. Escolha administrador, financeiro ou operacional.",
    };
  }
  if (current === "socio") {
    return { ok: false, error: "O papel de sócio não é alterado por esta ação." };
  }
  if (current === "admin" && requested !== "admin" && input.adminCount <= 1) {
    return {
      ok: false,
      error: "Não é possível remover o último administrador. Promova outra pessoa a Admin antes.",
    };
  }
  return { ok: true, role: requested };
}

export type MemberRoleRecord = {
  id: string;
  companyId: string;
  role: string;
};

/**
 * Aplica a troca só na linha cujo id e empresa coincidem.
 * As demais linhas, inclusive de outra empresa, permanecem como estavam.
 */
export function persistMemberRoleChange(input: {
  members: readonly MemberRoleRecord[];
  memberId: string;
  companyId: string;
  requestedRole: unknown;
  adminCount: number;
  callerRole: string | null | undefined;
}):
  | { ok: true; role: AssignableRole; members: MemberRoleRecord[] }
  | { ok: false; status: 403 | 404 | 409; error: string; members: MemberRoleRecord[] } {
  const members = input.members.map((member) => ({ ...member }));
  const caller = authorizeMemberRoleCaller(input.callerRole);
  if (!caller.ok) {
    return { ok: false, status: caller.status, error: caller.error, members };
  }

  const index = members.findIndex(
    (member) => member.id === input.memberId && member.companyId === input.companyId,
  );
  if (index < 0) {
    return {
      ok: false,
      status: 404,
      error: "Usuário não encontrado nesta empresa.",
      members,
    };
  }

  const plan = planMemberRoleChange({
    currentRole: members[index].role,
    requestedRole: input.requestedRole,
    adminCount: input.adminCount,
  });
  if (!plan.ok) {
    return { ok: false, status: 409, error: plan.error, members };
  }

  members[index] = { ...members[index], role: plan.role };
  return { ok: true, role: plan.role, members };
}
