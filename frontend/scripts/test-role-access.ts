import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  apiAuthorization,
  canRoleDeleteScreen,
  canRoleEditScreen,
  canRoleViewScreen,
  screenKeyFromPath,
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
      canRoleViewScreen({
        ...base,
        role: "operacional",
        screenKey: "financeiro.pagamentos-motorista",
      }),
      false,
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
      canRoleViewScreen({
        ...base,
        role: "financeiro",
        screenKey: "financeiro.pagamentos-motorista",
      }),
      true,
    );
    assert.equal(
      canRoleEditScreen({
        ...base,
        role: "financeiro",
        screenKey: "financeiro.pagamentos-motorista",
      }),
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

describe("rota de pagamento do motorista", () => {
  it("não herda a permissão do cadastro de motoristas", () => {
    assert.equal(
      screenKeyFromPath("/cadastros/motoristas"),
      "cadastros.motoristas",
    );
    assert.equal(
      screenKeyFromPath("/cadastros/motoristas/pagamentos"),
      "financeiro.pagamentos-motorista",
    );
    assert.equal(
      canRoleViewScreen({
        ...base,
        role: "operacional",
        screenKey: screenKeyFromPath("/cadastros/motoristas/pagamentos") ?? "",
      }),
      false,
    );
    assert.equal(
      canRoleViewScreen({
        ...base,
        role: "admin",
        screenKey: "financeiro.pagamentos-motorista",
      }),
      true,
    );
  });

  it("a migration 087 exige papel financeiro na baixa e revoga anon", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/087_driver_payment_and_finance_rpc_guards.sql", import.meta.url),
      "utf8",
    );
    assert.match(sql, /auth_user_can_access_company_finance/);
    assert.match(sql, /Sem acesso financeiro à empresa/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.mark_driver_payment_paid\(uuid\) FROM anon/);
    assert.match(sql, /seed_dashboard_demo_impl/);
    assert.match(sql, /_ap_post_competence_impl/);
    assert.doesNotMatch(sql, /APPLY MIGRATION/);
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
