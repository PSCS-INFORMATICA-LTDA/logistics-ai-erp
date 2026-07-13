"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/brand/AuthShell";
import { Alert } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { getAuthCallbackUrl } from "@/lib/auth-urls";
import { createClient } from "@/lib/supabase/client";

type AuthMode = "login" | "signup" | "forgot";

function LoginForm() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  useEffect(() => {
    const urlError = searchParams.get("error");
    const confirmed = searchParams.get("confirmed");
    if (urlError) setError(urlError);
    if (confirmed === "1") {
      setInfo("E-mail confirmado. Agora você pode entrar com sua senha.");
      setMode("login");
    }
  }, [searchParams]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setPassword("");
    setConfirmPassword("");
    if (next !== "signup") setConfirmEmail("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    const next = searchParams.get("next") || "/dashboard";
    const normalizedEmail = email.trim().toLowerCase();

    if (mode === "signup") {
      if (normalizedEmail !== confirmEmail.trim().toLowerCase()) {
        setError("Os e-mails informados não coincidem.");
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError("A senha deve ter pelo menos 6 caracteres.");
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        setError("A confirmação da senha não confere.");
        setLoading(false);
        return;
      }

      const { data, error: err } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: getAuthCallbackUrl("/login?confirmed=1"),
        },
      });

      if (err) {
        setError(err.message);
      } else if (data.user && !data.session) {
        setInfo(
          "Conta criada. Enviamos um link de confirmação para o seu e-mail. Confirme antes de entrar."
        );
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setConfirmEmail("");
      } else {
        setInfo("Conta criada com sucesso. Você já pode entrar.");
        setMode("login");
      }
      setLoading(false);
      return;
    }

    if (mode === "forgot") {
      if (!normalizedEmail) {
        setError("Informe o e-mail cadastrado.");
        setLoading(false);
        return;
      }

      const { error: err } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: getAuthCallbackUrl("/auth/redefinir-senha"),
      });

      if (err) setError(err.message);
      else {
        setInfo(
          "Se este e-mail estiver cadastrado, enviamos um link para redefinir a senha. Verifique a caixa de entrada e o spam."
        );
      }
      setLoading(false);
      return;
    }

    const { error: err } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
    setLoading(false);
  };

  const title =
    mode === "signup" ? "Criar conta" : mode === "forgot" ? "Recuperar senha" : "Entrar";
  const description =
    mode === "signup"
      ? "Cadastre e-mail, confirme o e-mail e defina sua senha."
      : mode === "forgot"
        ? "Informe o e-mail cadastrado para receber o link de recuperação."
        : "Acesse sua conta para continuar";

  return (
    <Card className="w-full max-w-md border-slate-200 shadow-md">
      <CardHeader title={title} description={description} />
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {info && <Alert variant="info">{info}</Alert>}

          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          {mode === "signup" ? (
            <Input
              label="Confirmar e-mail"
              type="email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              required
              autoComplete="email"
            />
          ) : null}

          {mode !== "forgot" ? (
            <Input
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          ) : null}

          {mode === "signup" ? (
            <Input
              label="Confirmar senha"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading
              ? "Aguarde..."
              : mode === "signup"
                ? "Criar conta"
                : mode === "forgot"
                  ? "Enviar link de recuperação"
                  : "Entrar"}
          </Button>

          <div className="space-y-2 text-center text-sm">
            {mode === "login" ? (
              <>
                <button
                  type="button"
                  className="block w-full text-brand-600 hover:text-brand-700 hover:underline"
                  onClick={() => switchMode("forgot")}
                >
                  Esqueci a senha
                </button>
                <button
                  type="button"
                  className="block w-full text-brand-600 hover:text-brand-700 hover:underline"
                  onClick={() => switchMode("signup")}
                >
                  Criar nova conta
                </button>
              </>
            ) : null}

            {mode === "signup" ? (
              <button
                type="button"
                className="w-full text-brand-600 hover:text-brand-700 hover:underline"
                onClick={() => switchMode("login")}
              >
                Já tenho conta
              </button>
            ) : null}

            {mode === "forgot" ? (
              <button
                type="button"
                className="w-full text-brand-600 hover:text-brand-700 hover:underline"
                onClick={() => switchMode("login")}
              >
                Voltar ao login
              </button>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={<div className="text-sm text-slate-500">Carregando...</div>}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
