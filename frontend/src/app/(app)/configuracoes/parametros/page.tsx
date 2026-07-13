"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
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
  isMasterSessionUnlocked,
  setMasterSessionUnlocked,
  verifyMasterPassword,
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
};

export default function ParametrosPage() {
  const { companyId } = useCompany();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
      .select("master_password_salt, master_password_hash")
      .eq("company_id", companyId)
      .maybeSingle();

    setSettings((data as SecuritySettings | null) ?? null);
    setUnlocked(Boolean(companyId && isMasterSessionUnlocked(companyId)));
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
        if (screen.key === "configuracoes.parametros") continue;
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

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const salt = createSalt();
    const hash = await hashMasterPassword(newPassword, salt);
    const { error: upsertError } = await supabase.from("company_security_settings").upsert({
      company_id: companyId,
      master_password_salt: salt,
      master_password_hash: hash,
      updated_by: user?.id ?? null,
    });

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setMasterSessionUnlocked(companyId);
    setUnlocked(true);
    setSettings({ master_password_salt: salt, master_password_hash: hash });
    setNewPassword("");
    setConfirmPassword("");
    setMsg("Senha master criada. Você tem acesso total às configurações de permissão.");
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
    setMasterSessionUnlocked(companyId);
    setUnlocked(true);
    setPassword("");
    setMsg("Acesso master liberado nesta sessão.");
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

    const rows = Object.values(perms).map((row) => ({
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

    const { error: insError } = await supabase
      .from("partner_screen_permissions")
      .insert(rows);

    if (insError) {
      setError(insError.message);
      setSavingPerms(false);
      return;
    }

    setMsg("Permissões salvas para o sócio selecionado.");
    setSavingPerms(false);
  };

  if (loading) return <Loading />;

  if (!unlocked) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Parâmetros</h1>
          <p className="mt-1 text-sm text-slate-600">
            Área master: acesso a todas as telas e definição de permissões por sócio.
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {msg && <Alert variant="info">{msg}</Alert>}

        <Card>
          <CardHeader title={settings ? "Digite a senha master" : "Criar senha master"} />
          <CardBody className="space-y-4">
            {!settings ? (
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
                <Button type="button" onClick={() => void createMasterPassword()}>
                  Criar senha master
                </Button>
              </>
            ) : (
              <>
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
                <Button type="button" onClick={() => void unlockMaster()}>
                  Entrar
                </Button>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  const screensByGroup = APP_SCREENS.filter((s) => s.key !== "configuracoes.parametros").reduce(
    (acc, screen) => {
      if (!acc[screen.group]) acc[screen.group] = [];
      acc[screen.group].push(screen);
      return acc;
    },
    {} as Record<string, typeof APP_SCREENS>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Parâmetros</h1>
        <p className="mt-1 text-sm text-slate-600">
          Acesso master liberado. Defina, por sócio cadastrado, o que ele pode analisar, alterar
          ou excluir em cada tela.
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {msg && <Alert variant="info">{msg}</Alert>}

      <Card>
        <CardHeader title="Permissões por sócio" />
        <CardBody className="space-y-4">
          <GlassSelect
            label="Sócio (usuário cadastrado)"
            value={selectedPartnerId}
            onChange={setSelectedPartnerId}
            options={partnerOptions}
          />

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
                          <td colSpan={4} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-brand-800">
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
              <Button
                type="button"
                onClick={() => void savePermissions()}
                disabled={savingPerms}
              >
                {savingPerms ? "Salvando…" : "Salvar permissões"}
              </Button>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
