import type { Metadata } from "next";
import { PublicPatioTicketClient } from "./PublicPatioTicketClient";

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
  "https://grx-management.vercel.app"
).replace(/\/$/, "");

type Props = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  return {
    metadataBase: new URL(APP_URL),
    title: "Comprovante do pátio",
    description: "Comprovante digital de estacionamento ou lava-rápido.",
    openGraph: {
      title: "Comprovante do pátio",
      description: "Apresente este comprovante na operação.",
      url: `${APP_URL}/ticket/${token}`,
      type: "website",
    },
  };
}

export default async function PublicPatioTicketPage({ params }: Props) {
  const { token } = await params;
  return <PublicPatioTicketClient token={token} />;
}
