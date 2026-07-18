/** Termo de responsabilidade — renovação mensal da licença (PSCS). */

export const LICENSE_TERMS_VERSION = "v1-2026-07";

export const LICENSE_TERMS_TITLE =
  "Termo de responsabilidade e renovação da licença";

export const LICENSE_TERMS_PARAGRAPHS: string[] = [
  "Este termo regula a licença de uso do sistema GRX Management / ERP da PSCS (central de serviço de software), contratada pela empresa assinante.",
  "A licença é de uso do software e dos serviços associados. Não há transferência de código-fonte nem de propriedade intelectual da PSCS.",
  "A renovação da licença é mensal e automática, mediante cobrança no cartão de crédito cadastrado, enquanto a assinatura permanecer ativa.",
  "O contratante é responsável pelo uso correto do sistema, pela veracidade dos dados cadastrados e pelos acessos concedidos aos usuários e sócios da empresa.",
  "A PSCS presta o serviço de sistema e suporte conforme o plano contratado. Decisões operacionais do cliente (frete, transporte, estacionamento, lava-rápido, DRE e demais módulos) são de responsabilidade exclusiva do contratante.",
  "O cancelamento pode ser solicitado pelo contratante na tela de Renovação da Licença. A cobrança automática deixa de ocorrer conforme o ciclo vigente após o cancelamento.",
  "Após 12 (doze) meses da contratação ou do último reajuste, o valor mensal da licença poderá ser reajustado pelo IGPM (Índice Geral de Preços do Mercado — FGV), com aviso prévio de 30 (trinta) dias ao contratante.",
  "Os dados do cartão são processados pelo Asaas. O sistema GRX não armazena número completo nem CVV — apenas final do cartão e bandeira, quando disponíveis.",
  "Ao marcar “Li e concordo” e registrar o aceite, o representante da empresa declara ter lido e compreendido este termo, autorizando a cobrança mensal da licença nos termos acima.",
];

export function formatTermsAcceptedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
