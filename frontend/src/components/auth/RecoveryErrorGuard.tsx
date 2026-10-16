"use client";

import { useEffect } from "react";
import {
  recoveryAuthErrorKindFromHref,
  recoveryLinkErrorMessage,
} from "@/lib/auth/recovery-redirect";

/** Leva erro cru do link (query ou fragmento) para o login, sem abrir o dashboard. */
export function RecoveryErrorGuard() {
  useEffect(() => {
    const current = new URL(window.location.href);
    if (current.pathname === "/login" && current.searchParams.get("recovery") === "1") {
      return;
    }
    const kind = recoveryAuthErrorKindFromHref(current.href);
    if (!kind) return;
    const login = new URL("/login", current.origin);
    login.searchParams.set("recovery", "1");
    login.searchParams.set("error", recoveryLinkErrorMessage(kind));
    window.location.replace(login.toString());
  }, []);

  return null;
}
