"use client";

import { useCallback, useEffect, useState } from "react";
import { BillingParametersPanel } from "@/components/billing/BillingParametersPanel";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { glassField } from "@/lib/liquid-glass-styles";
import { formatBRL, SUBSCRIPTION_STATUS_LABELS } from "@/lib/billing";
import {
  formatTermsAcceptedAt,
  LICENSE_TERMS_PARAGRAPHS,
  LICENSE_TERMS_TITLE,
  LICENSE_TERMS_VERSION,
} from "@/lib/license-terms";
import type { CompanyBillingSettings } from "@/types/database";

type StatusPayload = {
  settings: CompanyBillingSettings;
  chargeAmount: number;
  chargeAmountLabel: string;
  statusLabel: string;
  canManagePscsPricing?: boolean;
  asaas: { configured: boolean; env: string };
};

export default function MensalidadePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [payload, setPayload] = useState<StatusPayload | null>(null);
  const [termsChecked, setTermsChecked] = useState(false);

  const [holderName, setHolderName] = useState("");
  const [number, setNumber] = useState("");
  const [expiryMonth, setExpiryMonth] = useState("");
  const [expiryYear, setExpiryYear] = useState("");
  const [ccv, setCcv] = useState("");

  const [payerName, setPayerName] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [payerCpf, setPayerCpf] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [addressNumber, setAddressNumber] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/status");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao carregar.");
      const status = data as StatusPayload;
      setPayload(status);
      setPayerName(status.settings.payer_name ?? "");
      setPayerEmail(status.settings.payer_email ?? "");
      setPayerCpf(status.settings.payer_cpf_cnpj ?? "");
      setPayerPhone(status.settings.payer_phone ?? "");
      setPostalCode(status.settings.payer_postal_code ?? "");
      setAddressNumber(status.settings.payer_address_number ?? "");
      setHolderName(status.settings.card_holder_name ?? status.settings.payer_name ?? "");
      const alreadyAccepted =
        status.settings.terms_version === LICENSE_TERMS_VERSION &&
        Boolean(status.settings.terms_accepted_at);
      setTermsChecked(alreadyAccepted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const termsRegistered =
    payload?.settings?.terms_version === LICENSE_TERMS_VERSION &&
    Boolean(payload?.settings?.terms_accepted_at);

  const isPscsOperator = Boolean(payload?.canManagePscsPricing);

  const registerAcceptance = async () => {
    if (!termsChecked) {
      setError("Marque “Li e concordo com o termo” para registrar o aceite.");
      return;
    }
    setAccepting(true);
    setError(null);
    setMsg(null);
    try {
      const response = await fetch("/api/billing/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accepted: true,
          termsVersion: LICENSE_TERMS_VERSION,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao registrar aceite.");
      setMsg(data.message ?? "Aceite registrado.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar aceite.");
    } finally {
      setAccepting(false);
    }
  };

  const subscribe = async () => {
    if (!termsRegistered) {
      setError("Registre o aceite do termo antes de cadastrar o cartão.");
      return;
    }
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const response = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termsAccepted: true,
          termsVersion: LICENSE_TERMS_VERSION,
          card: {
            holderName,
            number,
            expiryMonth,
            expiryYear,
            ccv,
          },
          payer: {
            name: payerName,
            email: payerEmail,
            cpfCnpj: payerCpf,
            phone: payerPhone,
            postalCode,
            addressNumber,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao cadastrar cartão.");
      setMsg(data.message ?? "Assinatura criada.");
      setNumber("");
      setCcv("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cadastrar cartão.");
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (!window.confirm("Cancelar a assinatura mensal desta empresa?")) return;
    setCanceling(true);
    setError(null);
    setMsg(null);
    try {
      const response = await fetch("/api/billing/settings", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao cancelar.");
      setMsg("Assinatura cancelada.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar.");
    } finally {
      setCanceling(false);
    }
  };

  if (loading && !payload) return <Loading />;

  const settings = payload?.settings;
  const active =
    settings && ["active", "pending", "overdue"].includes(settings.subscription_status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <div className="border-b border-slate-100 px-6 py-4">
          <h1 className="text-2xl font-bold text-slate-900">Renovação da licença</h1>
          <p className="mt-1 text-sm text-slate-500">
            Termo de responsabilidade, aceite e cartão para renovação mensal da licença. A Senha
            Máster do cliente serve só para conceder acessos aos sócios — não abre os preços da
            PSCS.
          </p>
        </div>
      </Card>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? <Alert variant="info">{msg}</Alert> : null}

      {isPscsOperator ? <BillingParametersPanel /> : null}

      <Card>
        <CardHeader
          title={LICENSE_TERMS_TITLE}
          description={`Versão ${LICENSE_TERMS_VERSION} · renovação mensal · reajuste IGPM após 12 meses`}
        />
        <CardBody className="space-y-4">
          <div className="max-h-72 space-y-3.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm leading-7 text-slate-700 text-justify hyphens-auto [text-justify:inter-word]">
            {LICENSE_TERMS_PARAGRAPHS.map((paragraph, index) => (
              <p key={`terms-p-${index}`} lang="pt-BR">
                {paragraph}
              </p>
            ))}
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-brand-700"
              checked={termsChecked}
              onChange={(e) => setTermsChecked(e.target.checked)}
            />
            <span className="text-justify [text-justify:inter-word]">
              Li e concordo com o termo de responsabilidade e com a renovação mensal da licença
              (versão {LICENSE_TERMS_VERSION}).
            </span>
          </label>

          {termsRegistered ? (
            <Alert variant="info">
              Aceite registrado em{" "}
              <strong>{formatTermsAcceptedAt(settings?.terms_accepted_at)}</strong>
              {settings?.terms_version ? ` · ${settings.terms_version}` : ""}. Você já pode
              cadastrar o cartão abaixo.
            </Alert>
          ) : (
            <Button
              type="button"
              disabled={accepting || !termsChecked}
              onClick={() => void registerAcceptance()}
            >
              {accepting ? "Registrando aceite…" : "Registrar aceite e liberar cartão"}
            </Button>
          )}
        </CardBody>
      </Card>

      <div id="cadastro-cartao">
        <Card>
          <CardHeader
            title="Situação"
            description={
              payload
                ? `Cobrança atual: ${payload.chargeAmountLabel} · modo ${
                    settings?.charge_mode === "test" ? "teste" : "produção"
                  } · Asaas ${payload.asaas.configured ? payload.asaas.env : "não configurado"}`
                : undefined
            }
          />
          <CardBody className="space-y-2 text-sm text-slate-700">
            <p>
              Status:{" "}
              <strong>
                {settings
                  ? SUBSCRIPTION_STATUS_LABELS[settings.subscription_status] ??
                    settings.subscription_status
                  : "—"}
              </strong>
            </p>
            {settings?.card_last4 ? (
              <p>
                Cartão: {settings.card_brand || "Cartão"} **** {settings.card_last4}
                {settings.card_holder_name ? ` · ${settings.card_holder_name}` : ""}
              </p>
            ) : (
              <p>Nenhum cartão ativo.</p>
            )}
            {settings?.next_due_date ? <p>Próximo vencimento: {settings.next_due_date}</p> : null}
            {settings?.last_error ? <Alert variant="error">{settings.last_error}</Alert> : null}
            {active ? (
              <Button type="button" variant="ghost" onClick={() => void cancel()} disabled={canceling}>
                {canceling ? "Cancelando…" : "Cancelar assinatura"}
              </Button>
            ) : null}
          </CardBody>
        </Card>

        <Card className="mt-6">
          <CardHeader
            title="Cartão de crédito"
            description={
              termsRegistered
                ? `Será cobrado ${payload?.chargeAmountLabel ?? formatBRL(1)} na recorrência mensal da licença.`
                : "Disponível somente após registrar o aceite do termo acima."
            }
          />
          <CardBody className="space-y-4">
            {!termsRegistered ? (
              <Alert variant="warning">
                Registre o aceite do termo de responsabilidade antes de informar os dados do
                cartão.
              </Alert>
            ) : null}

            {!payload?.asaas.configured ? (
              <Alert variant="warning">
                Configure <code>ASAAS_API_KEY</code> no servidor antes de testar a cobrança real.
              </Alert>
            ) : null}

            <fieldset disabled={!termsRegistered} className="space-y-4 disabled:opacity-50">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-sm font-medium text-slate-700">Nome no cartão</span>
                  <input
                    className={glassField()}
                    value={holderName}
                    onChange={(e) => setHolderName(e.target.value)}
                  />
                </label>
                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-sm font-medium text-slate-700">Número do cartão</span>
                  <input
                    className={glassField()}
                    inputMode="numeric"
                    autoComplete="cc-number"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    placeholder="**** **** **** ****"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Mês</span>
                  <input
                    className={glassField()}
                    inputMode="numeric"
                    placeholder="MM"
                    maxLength={2}
                    value={expiryMonth}
                    onChange={(e) => setExpiryMonth(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Ano</span>
                  <input
                    className={glassField()}
                    inputMode="numeric"
                    placeholder="AAAA"
                    maxLength={4}
                    value={expiryYear}
                    onChange={(e) => setExpiryYear(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">CVV</span>
                  <input
                    className={glassField()}
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    maxLength={4}
                    value={ccv}
                    onChange={(e) => setCcv(e.target.value)}
                  />
                </label>
              </div>

              <h3 className="text-sm font-semibold text-slate-800">Titular / cobrança</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Nome</span>
                  <input
                    className={glassField()}
                    value={payerName}
                    onChange={(e) => setPayerName(e.target.value)}
                  />
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
                  <input
                    className={glassField()}
                    value={payerCpf}
                    onChange={(e) => setPayerCpf(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Telefone</span>
                  <input
                    className={glassField()}
                    value={payerPhone}
                    onChange={(e) => setPayerPhone(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">CEP</span>
                  <input
                    className={glassField()}
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                  />
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

              <Button
                type="button"
                onClick={() => void subscribe()}
                disabled={saving || !payload?.asaas.configured || !termsRegistered}
              >
                {saving
                  ? "Processando…"
                  : active
                    ? "Trocar cartão / recriar assinatura"
                    : "Ativar mensalidade no cartão"}
              </Button>
              <p className="text-xs text-slate-500">
                Os dados do cartão vão direto ao Asaas e não são salvos no banco do GRX (apenas
                final **** e bandeira).
              </p>
            </fieldset>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
