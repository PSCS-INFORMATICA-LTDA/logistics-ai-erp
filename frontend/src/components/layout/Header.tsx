"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useCompany } from "@/lib/company-context";
import { clearMasterSession } from "@/lib/master-password";

/** Logo da empresa adquirente no header (sem fundo). */
const COMPANY_MARK_SRC = "/grx-company-mark.png?v=3";

type HeaderProps = {
  onMenuClick?: () => void;
};

export function Header({ onMenuClick }: HeaderProps) {
  const { company } = useCompany();
  const router = useRouter();
  const supabase = createClient();

  const companyName = company?.trade_name || company?.name || "Empresa";

  const handleLogout = async () => {
    clearMasterSession();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="app-shell-header app-header-shell sticky top-0 z-30">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
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
        <div className="app-header-company-mark min-w-0" title={companyName}>
          <Image
            src={COMPANY_MARK_SRC}
            alt={companyName}
            width={606}
            height={522}
            unoptimized
            priority
            className="app-header-company-mark-image"
          />
        </div>
      </div>
      <button type="button" className="app-header-btn shrink-0" onClick={handleLogout}>
        Sair
      </button>
    </header>
  );
}
