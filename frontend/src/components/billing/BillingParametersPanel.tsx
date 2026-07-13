"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  const [payerName, setPayerName] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [payerCpf, setPayerCpf] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [status, setStatus] = useState("inactive");
  const [cardLast4, setCardLast4] = useState<string | null>(null);

  const applySettings = useCallback((settings: CompanyBillingSettings, payload?: StatusPayload) => {
    setChargeMode(settings.charge_mode);
    setTestAmount(String(settings.test_amount ?? 1));
    setMonthlyAmount(String(settings.monthly_amount ?? 800));
    setBillingDay(String(settings.billing_day ?? 10));
    setPayerName(settings.payer_name ?? "");
    setPayerEmail(settings.payer_email ?? "");
    setPayerCpf(settings.payer_cpf_cnpj ?? "");
    setPayerPhone(settings.payer_phone ?? "");
    setPostalCode(settings.payer_postal_code ?? "");
    setAddressNumber(settings.payer_address_number ?? "");
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
          payer_name: payerName,
          payer_email: payerEmail,
          payer_cpf_cnpj: payerCpf,
          payer_phone: payerPhone,
          payer_postal_code: postalCode,
          payer_address_number: addressNumber,
          sync_subscription_value: syncSubscriptionValue,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao salvar.");
      if (payload.settings) applySettings(payload.settings as CompanyBillingSettings);
      setMsg(
        payload.syncNote ||
          payload.warning ||
          "Parâmetros de mensalidade salvos. Use a tela Mensalidade para cadastrar o cartão."
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
        title="Mensalidade (cartão)"
        description="Defina valor de teste (Felipe) e valor de produção (Rafael). O cartão é cadastrado em Configurações → Mensalidade. Número e CVV nunca ficam gravados no GRX."
      />
      <CardBody className="space-y-4">
        {loading ? <p className="text-sm text-slate-500">Carregando…</p> : null}
        {error ? <Alert variant="error">{error}</Alert> : null}
        {msg ? <Alert variant="info">{msg}</Alert> : null}

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
              <option value="test">Teste (valor irrisório)</option>
              <option value="production">Produção (mensalidade Rafael)</option>
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
            <span className="text-sm font-medium text-slate-700">Mensalidade produção (R$)</span>
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

        <h4 className="text-sm font-semibold text-slate-800">Dados do pagador (titular)</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Nome</span>
            <input className={glassField()} value={payerName} onChange={(e) => setPayerName(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">E-mail</span>
            <input
              type="email"
              className={glassField()}
              value={payerEmail}
              onChange={(e) => setPayerEmail(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">CPF/CNPJ</span>
            <input className={glassField()} value={payerCpf} onChange={(e) => setPayerCpf(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Telefone</span>
            <input className={glassField()} value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">CEP</span>
            <input className={glassField()} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Nº endereço</span>
            <input
              className={glassField()}
              value={addressNumber}
              onChange={(e) => setAddressNumber(e.target.value)}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void save(false)} disabled={saving || loading}>
            {saving ? "Salvando…" : "Salvar parâmetros"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void save(true)}
            disabled={saving || loading}
          >
            Salvar e sincronizar valor no Asaas
          </Button>
          <Link
            href="/configuracoes/mensalidade"
            className="inline-flex items-center text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
          >
            Ir para cadastro do cartão →
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
