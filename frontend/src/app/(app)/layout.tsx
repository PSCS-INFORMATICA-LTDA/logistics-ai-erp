import { AccessProvider } from "@/lib/access-context";
import { CompanyProvider } from "@/lib/company-context";
import { AppShell } from "@/components/layout/AppShell";
import { ScreenAccessGate } from "@/components/layout/ScreenAccessGate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CompanyProvider>
      <AccessProvider>
        <AppShell>
          <ScreenAccessGate>{children}</ScreenAccessGate>
        </AppShell>
      </AccessProvider>
    </CompanyProvider>
  );
}
