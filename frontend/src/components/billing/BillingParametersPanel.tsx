"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { glassField } from "@/lib/liquid-glass-styles";
import { formatBRL, SUBSCRIPTION_STATUS_LABELS } from "@/lib/billing";
import type { CompanyBillingSettings } from "@/types/database";

type StatusPayload = {
  settings: CompanyBillingSettings;
  chargeAmount: number;
  chargeAmountLabel: string;
  statusLabel: string;
  asaas: { configured: boolean; env: string };
};

export function BillingParametersPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [asaasConfigured, setAsaasConfigured] = useState(false);
  const [asaasEnv, setAsaasEnv] = useState("sandbox");

  const [chargeMode, setChargeMode] = useState<"test" | "production">("test");
  const [testAmount, setTestAmount] = useState("1.00");
  const [monthlyAmount, setMonthlyAmount] = useState("800.00");
  const [billingDay, setBillingDay] = useState("10");
  const [status, setStatus] = useState("inactive");
  const [cardLast4, setCardLast4] = useState<string | null>(null);

  const applySettings = useCallback((settings: CompanyBillingSettings, payload?: StatusPayload) => {
    setChargeMode(settings.charge_mode);
    setTestAmount(String(settings.test_amount ?? 1));
    setMonthlyAmount(String(settings.monthly_amount ?? 800));
    setBillingDay(String(settings.billing_day ?? 10));
    setStatus(settings.subscription_status);
    setCardLast4(settings.card_last4);
    if (payload) {
      setAsaasConfigured(payload.asaas.configured);
      setAsaasEnv(payload.asaas.env);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/status");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Erro ao carregar cobrança.");
      applySettings(payload.settings as CompanyBillingSettings, payload as StatusPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar cobrança.");
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (syncSubscriptionValue = false) => {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const response = await fetch("/api/billing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          charge_mode: chargeMode,
          test_amount: Number(testAmount),
          monthly_amount: Number(monthlyAmount),
          billing_day: Number(billingDay),
          sync_subscription_value: syncSubscriptionValue,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao salvar.");
      if (payload.settings) applySettings(payload.settings as CompanyBillingSettings);
      setMsg(
        payload.syncNote ||
          payload.warning ||
          "Parâmetros PSCS salvos (modo/valor/dia). O cliente usa o termo e o cartão abaixo."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const chargePreview =
    chargeMode === "production" ? Number(monthlyAmount || 0) : Number(testAmount || 0);

  return (
    <Card>
      <CardHeader
        title="Parâmetros PSCS (somente operador)"
        description="Exclusivo da equipe PSCS (login operador). A Senha Máster do cliente NÃO libera este bloco — ela só controla acessos dos sócios."
      />
      <CardBody className="space-y-4">
        {loading ? <p className="text-sm text-slate-500">Carregando…</p> : null}
        {error ? <Alert variant="error">{error}</Alert> : null}
        {msg ? <Alert variant="info">{msg}</Alert> : null}

        <Alert variant="info">
          Visível só para e-mail operador PSCS. O cliente comprador vê apenas termo, aceite e cartão
          abaixo.
        </Alert>

        {!asaasConfigured ? (
          <Alert variant="warning">
            Asaas ainda sem chave no servidor. Cadastre <code>ASAAS_API_KEY</code> (sandbox para
            teste) e opcionalmente <code>ASAAS_ENV=sandbox</code> na Vercel / .env.local.
          </Alert>
        ) : (
          <Alert variant="info">
            Asaas ativo em modo <strong>{asaasEnv}</strong>. Cobrança atual:{" "}
            {formatBRL(Number.isFinite(chargePreview) ? chargePreview : 0)} (
            {chargeMode === "test" ? "teste" : "produção"}).
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">Modo de cobrança</span>
            <select
              className={glassField()}
              value={chargeMode}
              onChange={(e) => setChargeMode(e.target.value as "test" | "production")}
            >
              <option value="test">Teste (valor irrisório — Felipe)</option>
              <option value="production">Produção (licença Rafael)</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Valor de teste (R$)</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              className={glassField()}
              value={testAmount}
              onChange={(e) => setTestAmount(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Licença produção (R$)</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              className={glassField()}
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(e.target.value)}
            />
            <span className="text-xs text-slate-500">Piso sugerido: R$ 800,00 / mês.</span>
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Dia de vencimento</span>
            <input
              type="number"
              min="1"
              max="28"
              className={glassField()}
              value={billingDay}
              onChange={(e) => setBillingDay(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Status da assinatura</span>
            <input
              className={glassField()}
              readOnly
              value={`${SUBSCRIPTION_STATUS_LABELS[status] ?? status}${
                cardLast4 ? ` · **** ${cardLast4}` : ""
              }`}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void save(false)} disabled={saving || loading}>
            {saving ? "Salvando…" : "Salvar parâmetros PSCS"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void save(true)}
            disabled={saving || loading}
          >
            Salvar e sincronizar valor no Asaas
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
