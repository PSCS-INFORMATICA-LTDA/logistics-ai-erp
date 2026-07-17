/**
 * Operadores PSCS (cobrança / parâmetros de licença).
 * Não confundir com Senha Máster do cliente (concessão de acessos da empresa).
 *
 * Configure na Vercel: PSCS_OPERATOR_EMAILS=email1@...,email2@...
 * (também aceita NEXT_PUBLIC_PSCS_OPERATOR_EMAILS para espelho no cliente, se necessário)
 */

const FALLBACK_OPERATORS = [
  "pscfelipesolutions",
  "philippesantana",
  "philippe.santana",
  "@pscs",
];

function parseEnvList(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function getPscsOperatorMatchers(): string[] {
  const fromEnv = [
    ...parseEnvList(process.env.PSCS_OPERATOR_EMAILS),
    ...parseEnvList(process.env.NEXT_PUBLIC_PSCS_OPERATOR_EMAILS),
  ];
  return fromEnv.length > 0 ? fromEnv : FALLBACK_OPERATORS;
}

/** True se o e-mail for da equipe PSCS (não do cliente comprador). */
export function isPscsOperatorEmail(email: string | null | undefined): boolean {
  const normalized = String(email ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || !normalized.includes("@")) return false;

  return getPscsOperatorMatchers().some((matcher) => {
    if (matcher.startsWith("@")) {
      return normalized.endsWith(matcher) || normalized.includes(matcher);
    }
    if (matcher.includes("@")) {
      return normalized === matcher;
    }
    // trecho do local-part ou domínio (ex.: pscfelipesolutions)
    return normalized.includes(matcher);
  });
}
