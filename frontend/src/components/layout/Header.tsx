"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useCompany } from "@/lib/company-context";
import { companyDisplayName } from "@/lib/company-logo";
import { clearMasterSession } from "@/lib/master-password";

type HeaderProps = {
  onMenuClick?: () => void;
};

export function Header({ onMenuClick }: HeaderProps) {
  const { company } = useCompany();
  const router = useRouter();
  const supabase = createClient();
  const companyName = companyDisplayName(company);

  const handleLogout = async () => {
    clearMasterSession();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="app-shell-header app-header-shell sticky top-0 z-30">
      <div className="app-header-brand-row flex min-w-0 flex-1 items-center justify-start gap-2 sm:gap-3">
        <button
          type="button"
          className="app-header-menu-btn lg:hidden"
          aria-label="Abrir menu"
          onClick={onMenuClick}
        >
          <span className="app-header-menu-icon" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </button>
        <div
          className="app-header-company liquid-glass-btn liquid-glass-btn--secondary min-w-0 text-left"
          role="status"
          aria-label={`Empresa ${companyName}`}
        >
          <p className="app-header-company-label">Empresa</p>
          <p className="app-header-company-name truncate">{companyName}</p>
        </div>
      </div>
      <button type="button" className="app-header-btn shrink-0" onClick={handleLogout}>
        Sair
      </button>
    </header>
  );
}
