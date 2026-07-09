import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Proposta GRX Transportes e Logística";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
  "https://grx-management.vercel.app"
).replace(/\/$/, "");

export default async function ProposalOpenGraphImage() {
  const logoUrl = `${APP_URL}/grx-logo.png`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(165deg, #181818 0%, #0a0a0a 52%, #050505 100%)",
          padding: 48,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(165deg, #181818 0%, #0a0a0a 52%, #050505 100%)",
            borderRadius: 20,
            padding: "36px 56px",
            boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt="GRX"
            width={420}
            height={168}
            style={{ objectFit: "contain" }}
          />
        </div>
        <p
          style={{
            marginTop: 32,
            fontSize: 28,
            color: "#f8fafc",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Proposta GRX — Transportes e Logística
        </p>
      </div>
    ),
    { ...size }
  );
}
