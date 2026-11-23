import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { apiAuthorization, asCompanyMemberRole, canRoleViewScreen } from "../src/lib/app-screens.ts";
import {
  authorizeMemberInvite,
  authorizeMemberRoleCaller,
  knownMemberRole,
  persistMemberRoleChange,
  planMemberRoleChange,
  presentMemberRole,
  roleLabel,
  type MemberRoleRecord,
} from "../src/lib/member-role-plan.ts";

describe("exibição do papel gravado", () => {
  it("mostra admin, financeiro, operacional e sócio sem colapsar", () => {
    assert.deepEqual(presentMemberRole("admin"), {
      role: "admin",
      label: "Administrador",
      canApproveLaunches: true,
    });
    assert.deepEqual(presentMemberRole("financeiro"), {
      role: "financeiro",
      label: "Financeiro",
      canApproveLaunches: false,
    });
    assert.deepEqual(presentMemberRole("operacional"), {
      role: "operacional",
      label: "Operacional",
      canApproveLaunches: false,
    });
    assert.deepEqual(presentMemberRole("socio"), {
      role: "socio",
      label: "Sócio",
      canApproveLaunches: false,
    });
  });

  it("usa os mesmos papéis da matriz RBAC", () => {
    for (const role of ["admin", "financeiro", "operacional", "socio", "administrador", null]) {
      assert.equal(knownMemberRole(role), asCompanyMemberRole(role));
    }
  });

  it("não trata papel ausente ou desconhecido como operacional", () => {
    assert.equal(roleLabel("financeiro"), "Financeiro");
    assert.equal(roleLabel(null), "Papel desconhecido");
    assert.equal(presentMemberRole("administrador").role, null);
    assert.equal(presentMemberRole(undefined).label, "Papel desconhecido");
  });
});

describe("convite", () => {
  it("aceita financeiro explícito somente para administrador", () => {
    assert.deepEqual(authorizeMemberInvite("admin", "financeiro"), {
      ok: true,
      role: "financeiro",
    });
    assert.deepEqual(authorizeMemberInvite("admin", "operacional").ok, true);
    assert.deepEqual(authorizeMemberInvite("admin", "admin").ok, true);
  });

  it("recusa omissão, sócio e chamadas de quem não é administrador", () => {
    const missing = authorizeMemberInvite("admin", undefined);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 400);

    const socio = authorizeMemberInvite("admin", "socio");
    assert.equal(socio.ok, false);

    for (const caller of ["financeiro", "operacional", "socio", null]) {
      const decision = authorizeMemberInvite(caller, "admin");
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.status, 403);
    }
  });

  it("não reescreve o papel de quem já é membro", () => {
    const source = readFileSync(new URL("../src/app/api/company/members/invite/route.ts", import.meta.url), "utf8");
    assert.match(source, /authorizeMemberInvite/);
    assert.match(source, /already_member:\s*true/);
    assert.doesNotMatch(source, /role === "admin" \? "admin" : "operacional"/);
    assert.doesNotMatch(source, /\.update\(/);
  });
});

describe("alteração de papel", () => {
  it("promove e atribui financeiro sem alterar os demais papéis por omissão", () => {
    assert.deepEqual(
      planMemberRoleChange({
        currentRole: "operacional",
        requestedRole: "financeiro",
        adminCount: 1,
      }),
      { ok: true, role: "financeiro" },
    );
    assert.deepEqual(
      planMemberRoleChange({
        currentRole: "financeiro",
        requestedRole: "admin",
        adminCount: 1,
      }),
      { ok: true, role: "admin" },
    );
  });

  it("permite financeiro e operacional nos dois sentidos e recusa omissão ou sócio", () => {
    assert.deepEqual(
      planMemberRoleChange({
        currentRole: "financeiro",
        requestedRole: "operacional",
        adminCount: 2,
      }),
      { ok: true, role: "operacional" },
    );
    assert.deepEqual(
      planMemberRoleChange({
        currentRole: "operacional",
        requestedRole: "financeiro",
        adminCount: 2,
      }),
      { ok: true, role: "financeiro" },
    );

    const generic = planMemberRoleChange({
      currentRole: "financeiro",
      requestedRole: undefined,
      adminCount: 2,
    });
    assert.equal(generic.ok, false);

    const socio = planMemberRoleChange({
      currentRole: "socio",
      requestedRole: "operacional",
      adminCount: 2,
    });
    assert.equal(socio.ok, false);
  });

  it("impede remover o último administrador", () => {
    const blocked = planMemberRoleChange({
      currentRole: "admin",
      requestedRole: "operacional",
      adminCount: 1,
    });
    assert.equal(blocked.ok, false);

    const allowed = planMemberRoleChange({
      currentRole: "admin",
      requestedRole: "financeiro",
      adminCount: 2,
    });
    assert.deepEqual(allowed, { ok: true, role: "financeiro" });
  });

  it("a tela não oferece a ação genérica que colapsava financeiro", () => {
    const page = readFileSync(
      new URL("../src/app/(app)/configuracoes/usuarios/page.tsx", import.meta.url),
      "utf8",
    );
    assert.match(page, /value: "financeiro", label: "Financeiro"/);
    assert.match(page, /roleLabel\(row\.role\)/);
    assert.doesNotMatch(page, /Operacional \(financeiro\)/);
    assert.doesNotMatch(page, /toUiRole|ui_role/);
    assert.match(page, /\/api\/company\/members\/role/);
    assert.match(page, /row\.role === "financeiro"[\s\S]*"admin", "operacional"/);
    assert.match(page, /"admin", "financeiro"/);
  });
});

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

function homologMembers(): MemberRoleRecord[] {
  return [
    { id: "admin-a", companyId: COMPANY_A, role: "admin" },
    { id: "bia", companyId: COMPANY_A, role: "financeiro" },
    { id: "ops-a", companyId: COMPANY_A, role: "operacional" },
    { id: "socio-a", companyId: COMPANY_A, role: "socio" },
    { id: "admin-b", companyId: COMPANY_B, role: "admin" },
    { id: "fin-b", companyId: COMPANY_B, role: "financeiro" },
  ];
}

function rolesOf(members: readonly MemberRoleRecord[]): string[] {
  return members.map((member) => `${member.companyId}:${member.id}:${member.role}`);
}

describe("persistência da transição", () => {
  it("grava financeiro para operacional e a volta, sem mexer nos demais vínculos", () => {
    const started = homologMembers();
    const toOperational = persistMemberRoleChange({
      members: started,
      memberId: "bia",
      companyId: COMPANY_A,
      requestedRole: "operacional",
      adminCount: 1,
      callerRole: "admin",
    });
    assert.equal(toOperational.ok, true);
    if (!toOperational.ok) return;
    assert.equal(toOperational.role, "operacional");
    assert.deepEqual(rolesOf(toOperational.members), [
      `${COMPANY_A}:admin-a:admin`,
      `${COMPANY_A}:bia:operacional`,
      `${COMPANY_A}:ops-a:operacional`,
      `${COMPANY_A}:socio-a:socio`,
      `${COMPANY_B}:admin-b:admin`,
      `${COMPANY_B}:fin-b:financeiro`,
    ]);
    assert.deepEqual(rolesOf(started), rolesOf(homologMembers()));

    const back = persistMemberRoleChange({
      members: toOperational.members,
      memberId: "bia",
      companyId: COMPANY_A,
      requestedRole: "financeiro",
      adminCount: 1,
      callerRole: "admin",
    });
    assert.equal(back.ok, true);
    if (!back.ok) return;
    assert.equal(back.members.find((member) => member.id === "bia")?.role, "financeiro");
    assert.equal(back.members.find((member) => member.id === "ops-a")?.role, "operacional");
    assert.equal(back.members.find((member) => member.id === "fin-b")?.role, "financeiro");
  });

  it("mantém aprovação só no administrador e a matriz de cada papel", () => {
    const changed = persistMemberRoleChange({
      members: homologMembers(),
      memberId: "bia",
      companyId: COMPANY_A,
      requestedRole: "operacional",
      adminCount: 1,
      callerRole: "admin",
    });
    assert.equal(changed.ok, true);
    if (!changed.ok) return;

    const bia = changed.members.find((member) => member.id === "bia");
    const admin = changed.members.find((member) => member.id === "admin-a");
    assert.equal(presentMemberRole(bia?.role).canApproveLaunches, false);
    assert.equal(presentMemberRole(admin?.role).canApproveLaunches, true);
    assert.equal(presentMemberRole("financeiro").canApproveLaunches, false);

    assert.equal(
      canRoleViewScreen({ role: "operacional", partnerId: null, screenKey: "operacional.ordens-servico" }),
      true,
    );
    assert.equal(
      canRoleViewScreen({ role: "operacional", partnerId: null, screenKey: "financeiro.contas" }),
      false,
    );
    assert.equal(
      canRoleViewScreen({ role: "financeiro", partnerId: null, screenKey: "financeiro.contas" }),
      true,
    );
    assert.equal(
      canRoleViewScreen({ role: "financeiro", partnerId: null, screenKey: "operacional.ordens-servico" }),
      false,
    );
    assert.equal(
      canRoleViewScreen({ role: "financeiro", partnerId: null, screenKey: "configuracoes.usuarios" }),
      false,
    );
    assert.equal(apiAuthorization("financeiro", "/api/company/members/role"), "deny");
    assert.equal(apiAuthorization("operacional", "/api/company/members/role"), "deny");
    assert.equal(apiAuthorization("admin", "/api/company/members/role"), "allow");
  });

  it("recusa quem não é administrador da empresa do alvo e não grava nada", () => {
    const started = homologMembers();
    for (const callerRole of ["financeiro", "operacional", "socio", null]) {
      const decision = authorizeMemberRoleCaller(callerRole);
      assert.equal(decision.ok, false);
      const persisted = persistMemberRoleChange({
        members: started,
        memberId: "bia",
        companyId: COMPANY_A,
        requestedRole: "operacional",
        adminCount: 1,
        callerRole,
      });
      assert.equal(persisted.ok, false);
      if (!persisted.ok) assert.equal(persisted.status, 403);
      assert.deepEqual(rolesOf(persisted.members), rolesOf(started));
    }

    const otherCompany = persistMemberRoleChange({
      members: started,
      memberId: "fin-b",
      companyId: COMPANY_A,
      requestedRole: "operacional",
      adminCount: 1,
      callerRole: "admin",
    });
    assert.equal(otherCompany.ok, false);
    if (!otherCompany.ok) assert.equal(otherCompany.status, 404);
    assert.equal(otherCompany.members.find((member) => member.id === "fin-b")?.role, "financeiro");
  });

  it("a rota usa a autorização do administrador e filtra id e empresa", () => {
    const source = readFileSync(
      new URL("../src/app/api/company/members/role/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /authorizeMemberRoleCaller\(caller\?\.role\)/);
    assert.match(source, /\.eq\("company_id", target\.company_id\)/);
    assert.match(source, /\.eq\("user_id", auth\.user\.id\)/);
    assert.match(source, /\.eq\("id", target\.id\)/);
    assert.match(source, /\.eq\("company_id", target\.company_id\)/);
    const planSource = readFileSync(new URL("../src/lib/member-role-plan.ts", import.meta.url), "utf8");
    assert.doesNotMatch(planSource, /não pode ser substituído por operacional/);
  });
});
