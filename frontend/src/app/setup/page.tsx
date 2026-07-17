"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/brand/AuthShell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Badge";

export default function SetupPage() {
  const [name, setName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [document, setDocument] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Usuário não autenticado.");
      setLoading(false);
      return;
    }

    const { data: company, error: companyErr } = await supabase
      .from("companies")
      .insert({
        name: name.trim(),
        trade_name: tradeName.trim() || null,
        document: document.trim() || null,
      })
      .select()
      .single();

    if (companyErr) {
      setError(companyErr.message);
      setLoading(false);
      return;
    }

    const { error: memberErr } = await supabase.from("company_members").insert({
      company_id: company.id,
      user_id: user.id,
      role: "admin",
    });

    if (memberErr) {
      setError(memberErr.message);
      setLoading(false);
      return;
    }

    router.push("/configuracoes/empresa");
    router.refresh();
  };

  return (
    <AuthShell>
      <Card className="w-full max-w-lg border-slate-200 shadow-md">
        <CardHeader
          title="Configurar empresa"
          description="Primeiro acesso — cadastre o nome da sua empresa. Depois você poderá enviar o logo em Configurações → Empresa."
        />
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            <Input
              label="Razão social"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Input
              label="Nome fantasia (aparece no header e documentos)"
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
            />
            <Input
              label="CNPJ"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
            />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Criando..." : "Criar empresa e continuar"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </AuthShell>
  );
}
