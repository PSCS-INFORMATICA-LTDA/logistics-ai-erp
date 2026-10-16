"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/brand/AuthShell";
import { Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import {
  canShowPasswordResetForm,
  classifyPasswordConfirmation,
  classifyPasswordUpdate,
  RECOVERY_LINK_EXPIRED_MESSAGE,
} from "@/lib/auth/recovery-redirect";
import { createClient } from "@/lib/supabase/client";
import { clearRecoveryGrant } from "./grant";

export function RedefinirSenhaForm({ recoveryGrant }: { recoveryGrant: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(
    canShowPasswordResetForm(recoveryGrant) ? null : RECOVERY_LINK_EXPIRED_MESSAGE,
  );
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const showForm = canShowPasswordResetForm(recoveryGrant);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!showForm) {
      setError(RECOVERY_LINK_EXPIRED_MESSAGE);
      return;
    }

    const confirmation = classifyPasswordConfirmation(password, confirmPassword);
    if (!confirmation.ok) {
      setError(confirmation.error);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: updateError } = await supabase.auth.updateUser({ password });
    const decision = classifyPasswordUpdate({
      sessionPresent: Boolean(data?.user),
      recoveryGrant: true,
      updateError: updateError
        ? { message: updateError.message, code: updateError.code }
        : null,
      updateAccepted: !updateError,
    });
    setPassword("");
    setConfirmPassword("");
    setLoading(false);

    if (!decision.ok) {
      setError(decision.error);
      return;
    }

    await clearRecoveryGrant();
    setInfo("Senha atualizada com sucesso. Redirecionando…");
    setTimeout(() => {
      router.push(decision.next);
      router.refresh();
    }, 800);
  };

  return (
    <AuthShell>
      <Card className="w-full max-w-md border-slate-200 shadow-md">
        <CardHeader
          title="Redefinir senha"
          description="Defina uma nova senha para acessar o GRX Management."
        />
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            {info && <Alert variant="info">{info}</Alert>}
            {showForm ? (
              <>
                <Input
                  label="Nova senha"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <Input
                  label="Confirmar nova senha"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Salvando…" : "Salvar nova senha"}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                className="w-full"
                onClick={() => {
                  window.location.assign("/login?recovery=1");
                }}
              >
                Solicitar um novo e-mail
              </Button>
            )}
          </form>
        </CardBody>
      </Card>
    </AuthShell>
  );
}
