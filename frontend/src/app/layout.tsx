import type { Metadata, Viewport } from "next";
import { Rubik } from "next/font/google";
import { RecoveryErrorGuard } from "@/components/auth/RecoveryErrorGuard";
import "./globals.css";

const rubik = Rubik({
  subsets: ["latin"],
  variable: "--font-rubik",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GRX Management",
  description: "Gestão financeira e operacional GRX Transportes e Logística",
  icons: {
    icon: "/grx-logo.png",
  },
  appleWebApp: {
    capable: true,
    title: "GRX Management",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#d0001f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={rubik.variable}>
      <body className="font-sans antialiased">
        <RecoveryErrorGuard />
        {children}
      </body>
    </html>
  );
}
