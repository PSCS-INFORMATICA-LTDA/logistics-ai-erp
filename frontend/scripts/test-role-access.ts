import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  apiAuthorization,
  canRoleDeleteScreen,
  canRoleEditScreen,
  canRoleViewScreen,
} from "../src/lib/app-screens.ts";

const base = {
  partnerId: null as string | null,
  partnerCanView: false,
};

describe("matriz de papéis sem partner_id", () => {
  it("admin vê financeiro e configurações", () => {
    assert.equal(
      canRoleViewScreen({ ...base, role: "admin", screenKey: "financeiro.contas-a-pagar" }),
      true,
    );
    assert.equal(
      canRoleViewScreen({ ...base, role: "admin", screenKey: "configuracoes.usuarios" }),
      true,
    );
  });

  it("operacional executa OS e motorista e não vê financeiro nem configurações", () => {
    assert.equal(
      canRoleViewScreen({ ...base, role: "operacional", screenKey: "operacional.ordens-servico" }),
      true,
    );
    assert.equal(
      canRoleViewScreen({ ...base, role: "operacional", screenKey: "cadastros.motoristas" }),
      true,
    );
    assert.equal(
      canRoleViewScreen({ ...base, role: "operacional", screenKey: "financeiro.contas" }),
      false,
    );
    assert.equal(
      canRoleViewScreen({ ...base, role: "operacional", screenKey: "financeiro.contas-a-pagar" }),
      false,
    );
    assert.equal(
      canRoleViewScreen({ ...base, role: "operacional", screenKey: "dre.lancamentos" }),
      false,
    );
    assert.equal(
      canRoleViewScreen({ ...base, role: "operacional", screenKey: "configuracoes.empresa" }),
      false,
    );
    assert.equal(
      canRoleEditScreen({ ...base, role: "operacional", screenKey: "operacional.ordens-servico" }),
      true,
    );
    assert.equal(
      canRoleDeleteScreen({ ...base, role: "operacional", screenKey: "cadastros.motoristas" }),
      false,
    );
  });

  it("financeiro acessa só as telas financeiras, sem administração", () => {
    assert.equal(
      canRoleViewScreen({ ...base, role: "financeiro", screenKey: "financeiro.contas-a-pagar" }),
      true,
    );
    assert.equal(
      canRoleViewScreen({ ...base, role: "financeiro", screenKey: "financeiro.contas" }),
      true,
    );
    assert.equal(
      canRoleEditScreen({ ...base, role: "financeiro", screenKey: "financeiro.contas" }),
      true,
    );
    assert.equal(
      canRoleViewScreen({ ...base, role: "financeiro", screenKey: "configuracoes.usuarios" }),
      false,
    );
    assert.equal(
      canRoleViewScreen({ ...base, role: "financeiro", screenKey: "dre.lancamentos" }),
      false,
    );
    assert.equal(
      canRoleViewScreen({ ...base, role: "financeiro", screenKey: "operacional.ordens-servico" }),
      false,
    );
  });

  it("partner_id não devolve financeiro ao operacional nem configurações ao financeiro", () => {
    assert.equal(
      canRoleViewScreen({
        role: "operacional",
        partnerId: "partner-1",
        screenKey: "financeiro.contas-a-pagar",
        partnerCanView: true,
      }),
      false,
    );
    assert.equal(
      canRoleViewScreen({
        role: "operacional",
        partnerId: "partner-1",
        screenKey: "operacional.ordens-servico",
        partnerCanView: true,
      }),
      true,
    );
    assert.equal(
      canRoleViewScreen({
        role: "financeiro",
        partnerId: "partner-1",
        screenKey: "configuracoes.empresa",
        partnerCanView: true,
      }),
      false,
    );
    assert.equal(
      canRoleViewScreen({
        role: "financeiro",
        partnerId: "partner-1",
        screenKey: "financeiro.contas",
        partnerCanView: false,
      }),
      true,
    );
  });
});

describe("APIs autenticadas", () => {
  it("operacional recebe negação no recebível e segue no fechamento", () => {
    assert.equal(
      apiAuthorization("operacional", "/api/service-orders/abc/receivable"),
      "deny",
    );
    assert.equal(apiAuthorization("operacional", "/api/service-orders/abc/close"), "allow");
    assert.equal(apiAuthorization("operacional", "/api/billing/settings"), "deny");
    assert.equal(apiAuthorization("operacional", "/api/company/members/invite"), "deny");
    assert.equal(apiAuthorization("financeiro", "/api/service-orders/abc/receivable"), "allow");
    assert.equal(apiAuthorization("financeiro", "/api/configuracoes"), "allow");
    assert.equal(apiAuthorization("admin", "/api/integrations/status"), "allow");
    assert.equal(apiAuthorization("financeiro", "/api/integrations/status"), "deny");
  });
});
