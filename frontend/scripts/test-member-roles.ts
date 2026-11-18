import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asCompanyMemberRole } from "../src/lib/app-screens.ts";
import {
  authorizeMemberInvite,
  knownMemberRole,
  planMemberRoleChange,
  presentMemberRole,
  roleLabel,
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

  it("impede rebaixar financeiro para operacional e reescrever sócio", () => {
    const demotion = planMemberRoleChange({
      currentRole: "financeiro",
      requestedRole: "operacional",
      adminCount: 2,
    });
    assert.equal(demotion.ok, false);

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
  });
});
