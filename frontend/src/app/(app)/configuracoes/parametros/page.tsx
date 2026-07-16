"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { Alert, Loading } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { GlassSelect } from "@/components/ui/GlassSelect";
import { APP_SCREENS } from "@/lib/app-screens";
import { useCompany } from "@/lib/company-context";
import { glassField } from "@/lib/liquid-glass-styles";
import {
  createSalt,
  hashMasterPassword,
  hashRecoveryPhrase,
  isMasterSessionUnlocked,
  setMasterSessionUnlocked,
  validateRecoveryPhrase,
  verifyMasterPassword,
  verifyRecoveryPhrase,
} from "@/lib/master-password";
import { createClient } from "@/lib/supabase/client";
import type { Partner } from "@/types/database";

type PermissionRow = {
  screen_key: string;
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

type SecuritySettings = {
  master_password_salt: string;
  master_password_hash: string;
  recovery_phrase_salt: string | null;
  recovery_phrase_hash: string | null;
};

type GateMode = "create" | "unlock" | "recover";

export default function ParametrosPage() {
  const { companyId } = useCompany();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [gateMode, setGateMode] = useState<GateMode>("create");

  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [confirmRecoveryPhrase, setConfirmRecoveryPhrase] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [perms, setPerms] = useState<Record<string, PermissionRow>>({});
  const [savingPerms, setSavingPerms] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data } = await supabase
      .from("company_security_settings")
      .select(
        "master_password_salt, master_password_hash, recovery_phrase_salt, recovery_phrase_hash"
      )
      .eq("company_id", companyId)
      .maybeSingle();

    const next = (data as SecuritySettings | null) ?? null;
    setSettings(next);
    setGateMode(next ? "unlock" : "create");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUnlocked(
      Boolean(companyId && user?.id && isMasterSessionUnlocked(companyId, user.id))
    );
    setLoading(false);
  }, [companyId, supabase]);

  const loadPartners = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from("partners")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .eq("status", "Ativo")
      .order("name");
    setPartners((data as Partner[]) ?? []);
  }, [companyId, supabase]);

  const loadPermissions = useCallback(
    async (partnerId: string) => {
      if (!companyId || !partnerId) {
        setPerms({});
        return;
      }
      const { data } = await supabase
        .from("partner_screen_permissions")
        .select("screen_key, can_view, can_edit, can_delete")
        .eq("company_id", companyId)
        .eq("partner_id", partnerId);

      const map: Record<string, PermissionRow> = {};
      for (const screen of APP_SCREENS) {
        if (
          screen.key === "configuracoes.parametros" ||
          screen.key === "configuracoes.historico-exclusoes"
        ) {
          continue;
        }
        map[screen.key] = {
          screen_key: screen.key,
          can_view: false,
          can_edit: false,
          can_delete: false,
        };
      }
      for (const row of data ?? []) {
        const key = row.screen_key as string;
        if (!map[key]) continue;
        map[key] = {
          screen_key: key,
          can_view: Boolean(row.can_view),
          can_edit: Boolean(row.can_edit),
          can_delete: Boolean(row.can_delete),
        };
      }
      setPerms(map);
    },
    [companyId, supabase]
  );

  useEffect(() => {
    void loadSettings();
    void loadPartners();
  }, [loadPartners, loadSettings]);

  useEffect(() => {
    if (selectedPartnerId) void loadPermissions(selectedPartnerId);
  }, [loadPermissions, selectedPartnerId]);

  const partnerOptions = useMemo(
    () => [
      { value: "", label: "Selecione o sócio…" },
      ...partners.map((p) => ({
        value: p.id,
        label: `${p.name} (${p.code}) — ${p.partner_type}`,
      })),
    ],
    [partners]
  );

  const clearGateFields = () => {
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setRecoveryPhrase("");
    setConfirmRecoveryPhrase("");
  };

  const createMasterPassword = async () => {
    if (!companyId) return;
    setError(null);
    setMsg(null);

    if (newPassword.length < 6) {
      setError("A senha master deve ter pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("A confirmação da senha não confere.");
      return;
    }
    const phraseError = validateRecoveryPhrase(recoveryPhrase);
    if (phraseError) {
      setError(phraseError);
      return;
    }
    if (
      recoveryPhrase.trim().toLowerCase() !== confirmRecoveryPhrase.trim().toLowerCase()
    ) {
      setError("A confirmação da frase de recuperação não confere.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const passwordSalt = createSalt();
    const passwordHash = await hashMasterPassword(newPassword, passwordSalt);
    const phraseSalt = createSalt();
    const phraseHash = await hashRecoveryPhrase(recoveryPhrase, phraseSalt);

    const { error: upsertError } = await supabase.from("company_security_settings").upsert({
      company_id: companyId,
      master_password_salt: passwordSalt,
      master_password_hash: passwordHash,
      recovery_phrase_salt: phraseSalt,
      recovery_phrase_hash: phraseHash,
      updated_by: user?.id ?? null,
    });

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    if (user?.id) setMasterSessionUnlocked(companyId, user.id);
    setUnlocked(true);
    setSettings({
      master_password_salt: passwordSalt,
      master_password_hash: passwordHash,
      recovery_phrase_salt: phraseSalt,
      recovery_phrase_hash: phraseHash,
    });
    clearGateFields();
    setMsg(
      "Senha master criada. Guarde a frase de recuperação em local seguro — ela será pedida se você esquecer a senha."
    );
  };

  const unlockMaster = async () => {
    if (!companyId || !settings) return;
    setError(null);
    setMsg(null);
    const ok = await verifyMasterPassword(
      password,
      settings.master_password_salt,
      settings.master_password_hash
    );
    if (!ok) {
      setError("Senha master incorreta.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      setError("Sessão inválida. Faça login novamente.");
      return;
    }
    setMasterSessionUnlocked(companyId, user.id);
    setUnlocked(true);
    clearGateFields();
    setMsg("Acesso master liberado nesta sessão.");
  };

  const recoverMasterPassword = async () => {
    if (!companyId || !settings) return;
    setError(null);
    setMsg(null);

    if (!settings.recovery_phrase_salt || !settings.recovery_phrase_hash) {
      setError(
        "Esta empresa ainda não tem frase de recuperação. Peça suporte PSCS para resetar a senha master."
      );
      return;
    }

    const phraseOk = await verifyRecoveryPhrase(
      recoveryPhrase,
      settings.recovery_phrase_salt,
      settings.recovery_phrase_hash
    );
    if (!phraseOk) {
      setError("Frase de recuperação incorreta.");
      return;
    }
    if (newPassword.length < 6) {
      setError("A nova senha master deve ter pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("A confirmação da nova senha não confere.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const passwordSalt = createSalt();
    const passwordHash = await hashMasterPassword(newPassword, passwordSalt);

    const { error: updateError } = await supabase
      .from("company_security_settings")
      .update({
        master_password_salt: passwordSalt,
        master_password_hash: passwordHash,
        updated_by: user?.id ?? null,
      })
      .eq("company_id", companyId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSettings({
      ...settings,
      master_password_salt: passwordSalt,
      master_password_hash: passwordHash,
    });
    if (user?.id) setMasterSessionUnlocked(companyId, user.id);
    setUnlocked(true);
    clearGateFields();
    setGateMode("unlock");
    setMsg("Senha master redefinida com a frase de recuperação. Acesso liberado.");
  };

  const togglePerm = (
    screenKey: string,
    field: "can_view" | "can_edit" | "can_delete",
    value: boolean
  ) => {
    setPerms((prev) => {
      const current = prev[screenKey] ?? {
        screen_key: screenKey,
        can_view: false,
        can_edit: false,
        can_delete: false,
      };
      const next = { ...current, [field]: value };
      if (field === "can_view" && !value) {
        next.can_edit = false;
        next.can_delete = false;
      }
      if ((field === "can_edit" || field === "can_delete") && value) {
        next.can_view = true;
      }
      return { ...prev, [screenKey]: next };
    });
  };

  const savePermissions = async () => {
    if (!companyId || !selectedPartnerId) return;
    setSavingPerms(true);
    setError(null);
    setMsg(null);

    // Só grava telas com algum acesso; ausente no banco = negado (fiel aos checkboxes).
    const rows = Object.values(perms)
      .filter((row) => row.can_view || row.can_edit || row.can_delete)
      .map((row) => ({
        company_id: companyId,
        partner_id: selectedPartnerId,
        screen_key: row.screen_key,
        can_view: row.can_view,
        can_edit: row.can_edit,
        can_delete: row.can_delete,
      }));

    const { error: delError } = await supabase
      .from("partner_screen_permissions")
      .delete()
      .eq("company_id", companyId)
      .eq("partner_id", selectedPartnerId);

    if (delError) {
      setError(delError.message);
      setSavingPerms(false);
      return;
    }

    const { error: insError } =
      rows.length > 0
        ? await supabase.from("partner_screen_permissions").insert(rows)
        : { error: null };

    if (insError) {
      setError(insError.message);
      setSavingPerms(false);
      return;
    }

    setMsg("Permissões salvas para o sócio selecionado.");
    setSavingPerms(false);
  };

  const saveRecoveryPhraseWhileUnlocked = async () => {
    if (!companyId || !settings) return;
    setError(null);
    setMsg(null);
    const phraseError = validateRecoveryPhrase(recoveryPhrase);
    if (phraseError) {
      setError(phraseError);
      return;
    }
    if (
      recoveryPhrase.trim().toLowerCase() !== confirmRecoveryPhrase.trim().toLowerCase()
    ) {
      setError("A confirmação da frase de recuperação não confere.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const phraseSalt = createSalt();
    const phraseHash = await hashRecoveryPhrase(recoveryPhrase, phraseSalt);
    const { error: updateError } = await supabase
      .from("company_security_settings")
      .update({
        recovery_phrase_salt: phraseSalt,
        recovery_phrase_hash: phraseHash,
        updated_by: user?.id ?? null,
      })
      .eq("company_id", companyId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSettings({
      ...settings,
      recovery_phrase_salt: phraseSalt,
      recovery_phrase_hash: phraseHash,
    });
    setRecoveryPhrase("");
    setConfirmRecoveryPhrase("");
    setMsg("Frase de recuperação salva com sucesso.");
  };

  if (loading) return <Loading />;

  if (!unlocked) {
    const headerTitle =
      gateMode === "create"
        ? "Criar senha master"
        : gateMode === "recover"
          ? "Recuperar senha master"
          : "Entrar com senha master";

    return (
      <div className="mx-auto max-w-lg">
        <Card>
          <CardHeader
            title="Senha Máster - Concessão de Acessos"
            description="Área master: acesso a todas as telas e definição de permissões por sócio."
          />
          <CardBody className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            {msg && <Alert variant="info">{msg}</Alert>}

            <h3 className="text-base font-semibold text-slate-800">{headerTitle}</h3>

            {gateMode === "create" ? (
              <>
                <p className="text-sm text-slate-600">
                  Defina a senha master do Rafael (administrador). Com ela, ele acessa todas as
                  telas e gerencia quem pode ver, alterar ou excluir em cada módulo.
                </p>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Nova senha master</span>
                  <input
                    type="password"
                    className={glassField()}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Confirmar senha</span>
                  <input
                    type="password"
                    className={glassField()}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Frase de recuperação</span>
                  <input
                    type="text"
                    className={glassField()}
                    value={recoveryPhrase}
                    onChange={(e) => setRecoveryPhrase(e.target.value)}
                    placeholder="Ex.: van vermelha viagem belo horizonte"
                  />
                  <span className="text-xs text-slate-500">
                    Mínimo 3 palavras. Anote em local seguro — será a única forma de recuperar a
                    senha.
                  </span>
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">
                    Confirmar frase de recuperação
                  </span>
                  <input
                    type="text"
                    className={glassField()}
                    value={confirmRecoveryPhrase}
                    onChange={(e) => setConfirmRecoveryPhrase(e.target.value)}
                  />
                </label>
                <Button type="button" onClick={() => void createMasterPassword()}>
                  Criar senha master
                </Button>
              </>
            ) : null}

            {gateMode === "unlock" ? (
              <>
                <p className="text-sm text-slate-600">
                  Digite a senha master para liberar a gestão de permissões.
                </p>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Senha master</span>
                  <input
                    type="password"
                    className={glassField()}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void unlockMaster();
                    }}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={() => void unlockMaster()}>
                    Entrar
                  </Button>
                  <button
                    type="button"
                    className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
                    onClick={() => {
                      setError(null);
                      setMsg(null);
                      clearGateFields();
                      setGateMode("recover");
                    }}
                  >
                    Esqueci a senha
                  </button>
                </div>
              </>
            ) : null}

            {gateMode === "recover" ? (
              <>
                <p className="text-sm text-slate-600">
                  Informe a frase de recuperação cadastrada e defina uma nova senha master.
                </p>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Frase de recuperação</span>
                  <input
                    type="text"
                    className={glassField()}
                    value={recoveryPhrase}
                    onChange={(e) => setRecoveryPhrase(e.target.value)}
                    placeholder="Digite a frase exatamente como cadastrou"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Nova senha master</span>
                  <input
                    type="password"
                    className={glassField()}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Confirmar nova senha</span>
                  <input
                    type="password"
                    className={glassField()}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={() => void recoverMasterPassword()}>
                    Redefinir senha
                  </Button>
                  <button
                    type="button"
                    className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
                    onClick={() => {
                      setError(null);
                      setMsg(null);
                      clearGateFields();
                      setGateMode("unlock");
                    }}
                  >
                    Voltar
                  </button>
                </div>
              </>
            ) : null}
          </CardBody>
        </Card>
      </div>
    );
  }

  const screensByGroup = APP_SCREENS.filter(
    (s) =>
      s.key !== "configuracoes.parametros" &&
      s.key !== "configuracoes.historico-exclusoes"
  ).reduce(
    (acc, screen) => {
      if (!acc[screen.group]) acc[screen.group] = [];
      acc[screen.group].push(screen);
      return acc;
    },
    {} as Record<string, typeof APP_SCREENS>
  );

  const savePermissionsButton = selectedPartnerId ? (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" onClick={() => void savePermissions()} disabled={savingPerms}>
        {savingPerms ? "Salvando…" : "Salvar permissões do sócio"}
      </Button>
      <p className="text-xs text-slate-500">
        Grava no banco as telas liberadas (Análise / Alteração / Exclusão) para o sócio
        selecionado.
      </p>
    </div>
  ) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Card>
        <CardHeader
          title="Senha Máster - Concessão de Acessos"
          description="Somente parametrização de acessos por sócio. Valores e cartão de mensalidade ficam em Configurações → Mensalidade."
        />
        <CardBody className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {msg && <Alert variant="info">{msg}</Alert>}
          <Alert variant="info">
            Acesso master liberado nesta sessão. Esta tela não inclui cobrança Asaas — use{" "}
            <Link href="/configuracoes/mensalidade" className="font-medium underline">
              Mensalidade
            </Link>
            .
          </Alert>

          {!settings?.recovery_phrase_hash ? (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-sm text-amber-900">
                Esta senha master ainda não tem frase de recuperação. Cadastre agora para poder
                recuperar se esquecer a senha.
              </p>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Frase de recuperação</span>
                <input
                  type="text"
                  className={glassField()}
                  value={recoveryPhrase}
                  onChange={(e) => setRecoveryPhrase(e.target.value)}
                  placeholder="Ex.: van vermelha viagem belo horizonte"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">Confirmar frase</span>
                <input
                  type="text"
                  className={glassField()}
                  value={confirmRecoveryPhrase}
                  onChange={(e) => setConfirmRecoveryPhrase(e.target.value)}
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void saveRecoveryPhraseWhileUnlocked()}
              >
                Salvar frase de recuperação
              </Button>
            </div>
          ) : null}

          <h3 className="text-base font-semibold text-slate-800">Permissões por sócio</h3>

          <GlassSelect
            label="Sócio (usuário cadastrado)"
            value={selectedPartnerId}
            onChange={setSelectedPartnerId}
            options={partnerOptions}
          />

          {selectedPartnerId ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3">
              {savePermissionsButton}
            </div>
          ) : null}

          {!selectedPartnerId ? (
            <p className="text-sm text-slate-500">
              Selecione um sócio da lista para liberar as telas.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left">
                      <th className="px-3 py-2 font-medium text-slate-600">Tela</th>
                      <th className="px-3 py-2 font-medium text-slate-600">Análise (ver)</th>
                      <th className="px-3 py-2 font-medium text-slate-600">Alteração</th>
                      <th className="px-3 py-2 font-medium text-slate-600">Exclusão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(screensByGroup).map(([group, screens]) => (
                      <Fragment key={group}>
                        <tr className="bg-brand-50/40">
                          <td
                            colSpan={4}
                            className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-brand-800"
                          >
                            {group}
                          </td>
                        </tr>
                        {screens.map((screen) => {
                          const row = perms[screen.key];
                          return (
                            <tr key={screen.key} className="border-b border-slate-50">
                              <td className="px-3 py-2 text-slate-700">{screen.label}</td>
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(row?.can_view)}
                                  onChange={(e) =>
                                    togglePerm(screen.key, "can_view", e.target.checked)
                                  }
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(row?.can_edit)}
                                  onChange={(e) =>
                                    togglePerm(screen.key, "can_edit", e.target.checked)
                                  }
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(row?.can_delete)}
                                  onChange={(e) =>
                                    togglePerm(screen.key, "can_delete", e.target.checked)
                                  }
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sticky bottom-0 z-10 -mx-1 border-t border-slate-200 bg-white/95 px-1 py-3 backdrop-blur">
                {savePermissionsButton}
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
