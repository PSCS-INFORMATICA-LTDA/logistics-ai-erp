"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/brand/AuthShell";
import { Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { classifyPasswordUpdate } from "@/lib/auth/recovery-redirect";
import { createClient } from "@/lib/supabase/client";

export default function RedefinirSenhaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionOk, setSessionOk] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      const present = Boolean(data.user);
      setSessionOk(present);
      if (!present) {
        setError("Link de recuperação inválido ou expirado. Solicite um novo.");
      }
    }).catch(() => {
      if (!active) return;
      setSessionOk(false);
      setError("Link de recuperação inválido ou expirado. Solicite um novo.");
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("A confirmação da senha não confere.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const { error: updateError } = userData.user
      ? await supabase.auth.updateUser({ password })
      : { error: { message: "session" } };
    const decision = classifyPasswordUpdate({
      sessionPresent: Boolean(userData.user),
      updateError: updateError ? { message: updateError.message } : null,
    });
    setPassword("");
    setConfirmPassword("");
    setLoading(false);

    if (!decision.ok) {
      setError(decision.error);
      return;
    }

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
            <Button type="submit" className="w-full" disabled={loading || sessionOk !== true}>
              {loading ? "Salvando…" : "Salvar nova senha"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </AuthShell>
  );
}
