import { AccessProvider } from "@/lib/access-context";
import { CompanyProvider } from "@/lib/company-context";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CompanyProvider>
      <AccessProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex flex-1 flex-col">
            <Header />
            <main className="flex-1 overflow-auto bg-slate-50 p-6">{children}</main>
          </div>
        </div>
      </AccessProvider>
    </CompanyProvider>
  );
}
