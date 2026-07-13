export type IntegrationTier = "free" | "paid" | "optional";

export type IntegrationStatus = "active" | "inactive" | "optional";

export type IntegrationModule = {
  id: string;
  name: string;
  description: string;
  tier: IntegrationTier;
  envVar?: string;
  features: string[];
  upgradeUrl?: string;
  contactEmail?: string;
  pricingHint?: string;
};

export const INTEGRATION_MODULES: IntegrationModule[] = [
  {
    id: "route-osrm",
    name: "Distância de rota (OSRM)",
    description: "Cálculo de km e tempo entre pontos A e B via OpenStreetMap.",
    tier: "free",
    features: ["Distância em km", "Tempo estimado", "Geocodificação por endereço ou CEP"],
  },
  {
    id: "antt-local",
    name: "Piso mínimo ANTT (local)",
    description: "Cálculo do piso legal com coeficientes da Resolução ANTT 6.076/2026 (carga geral).",
    tier: "free",
    features: ["Piso mínimo", "Parâmetros de eixos e tipo de carga", "Valor sugerido com pedágio manual"],
  },
  {
    id: "qualp-tolls",
    name: "Pedágios automáticos (QualP)",
    description:
      "Praças, valores individuais e total de pedágio na rota. Ative quando o volume de fretes justificar o plano pago.",
    tier: "paid",
    envVar: "QUALP_API_TOKEN",
    features: [
      "Quantidade de praças na rota",
      "Valor por praça e total",
      "Preenchimento automático do pedágio na OS",
    ],
    upgradeUrl: "https://qualp.com.br/pro/",
    contactEmail: "contato@qualp.com.br",
    pricingHint: "Planos a partir de ~R$ 390/mês (1.000 consultas). Consulte qualp.com.br.",
  },
  {
    id: "ciot-antt",
    name: "ANTT todos os tipos de carga (CIOT Online)",
    description: "Opcional — piso ANTT para todos os 12 tipos de carga via API externa.",
    tier: "optional",
    envVar: "CIOT_ONLINE_API_TOKEN",
    features: ["Todos os tipos de carga ANTT", "Complementa o cálculo local"],
    pricingHint: "Token comercial — configure quando necessário.",
  },
  {
    id: "asaas-billing",
    name: "Mensalidade cartão (Asaas)",
    description:
      "Assinatura recorrente no cartão para cobrança mensal da PSCS (teste e produção).",
    tier: "paid",
    envVar: "ASAAS_API_KEY",
    features: [
      "Cadastro de cartão sem gravar número/CVV no GRX",
      "Valor de teste e mensalidade de produção",
      "Assinatura mensal automática",
    ],
    upgradeUrl: "https://www.asaas.com/",
    pricingHint: "Crie conta Asaas (sandbox para teste) e cole a API Key no servidor.",
  },
];

export function resolveIntegrationStatus(
  module: IntegrationModule,
  configuredEnvVars: Record<string, boolean>
): IntegrationStatus {
  if (module.tier === "free") return "active";
  if (!module.envVar) return "inactive";
  return configuredEnvVars[module.envVar] ? "active" : module.tier === "optional" ? "optional" : "inactive";
}

export function isQualpConfigured(configuredEnvVars: Record<string, boolean>): boolean {
  return Boolean(configuredEnvVars.QUALP_API_TOKEN);
}
