import type { Metadata } from "next";
import { PublicProposalClient } from "./PublicProposalClient";

type Props = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await params;
  return {
    title: "Proposta GRX — Transportes e Logística",
    description: "Proposta de ordem de serviço GRX Transportes e Logística. Confirme pelo link.",
    openGraph: {
      title: "Proposta GRX",
      description: "Proposta de frete — GRX Transportes e Logística",
      siteName: "GRX Transportes e Logística",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Proposta GRX",
      description: "Proposta de frete — GRX Transportes e Logística",
    },
  };
}

export default async function PublicProposalPage({ params }: Props) {
  const { token } = await params;
  return <PublicProposalClient token={token} />;
}
