"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  APP_SCREENS,
  asCompanyMemberRole,
  canRoleDeleteScreen,
  canRoleEditScreen,
  canRoleViewScreen,
  type CompanyMemberRole,
  type ScreenPermissionFlags,
} from "@/lib/app-screens";
import { useCompany } from "@/lib/company-context";
import { createClient } from "@/lib/supabase/client";

export type MemberRole = CompanyMemberRole;

type AccessContextValue = {
  loading: boolean;
  role: MemberRole | null;
  partnerId: string | null;
  isAdmin: boolean;
  /** Admin / master = acesso total; demais usam mapa por tela. */
  canViewScreen: (screenKey: string) => boolean;
  canEditScreen: (screenKey: string) => boolean;
  canDeleteScreen: (screenKey: string) => boolean;
  permissionsByScreen: Record<string, ScreenPermissionFlags>;
  refreshAccess: () => Promise<void>;
};

const AccessContext = createContext<AccessContextValue>({
  loading: true,
  role: null,
  partnerId: null,
  isAdmin: false,
  canViewScreen: () => false,
  canEditScreen: () => false,
  canDeleteScreen: () => false,
  permissionsByScreen: {},
  refreshAccess: async () => {},
});

export function AccessProvider({ children }: { children: ReactNode }) {
  const { companyId, loading: companyLoading } = useCompany();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [permissionsByScreen, setPermissionsByScreen] = useState<
    Record<string, ScreenPermissionFlags>
  >({});
  /** full só para admin. restricted usa matriz de sócio ou allowlist do papel. */
  const [accessMode, setAccessMode] = useState<"loading" | "full" | "restricted" | "denied">(
    "loading"
  );

  const refreshAccess = useCallback(async () => {
    setLoading(true);
    setAccessMode("loading");

    // Não liberar telas enquanto a empresa ainda não carregou (evita “full access” fantasma).
    if (companyLoading) {
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !companyId) {
      setRole(null);
      setPartnerId(null);
      setPermissionsByScreen({});
      setAccessMode("denied");
      setLoading(false);
      return;
    }

    const { data: membership } = await supabase
      .from("company_members")
      .select("role, partner_id")
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .maybeSingle();

    const memberRole = asCompanyMemberRole(membership?.role);
    const linkedPartnerId = (membership?.partner_id as string | null) ?? null;
    setRole(memberRole);
    setPartnerId(linkedPartnerId);

    if (memberRole === "admin") {
      const full: Record<string, ScreenPermissionFlags> = {};
      for (const screen of APP_SCREENS) {
        full[screen.key] = { can_view: true, can_edit: true, can_delete: true };
      }
      setPermissionsByScreen(full);
      setAccessMode("full");
      setLoading(false);
      return;
    }

    if (!linkedPartnerId) {
      setPermissionsByScreen({});
      setAccessMode(memberRole ? "restricted" : "denied");
      setLoading(false);
      return;
    }

    const { data: rows } = await supabase
      .from("partner_screen_permissions")
      .select("screen_key, can_view, can_edit, can_delete")
      .eq("company_id", companyId)
      .eq("partner_id", linkedPartnerId);

    const map: Record<string, ScreenPermissionFlags> = {};
    for (const row of rows ?? []) {
      map[row.screen_key as string] = {
        can_view: Boolean(row.can_view),
        can_edit: Boolean(row.can_edit),
        can_delete: Boolean(row.can_delete),
      };
    }
    setPermissionsByScreen(map);
    setAccessMode("restricted");
    setLoading(false);
  }, [companyId, companyLoading, supabase]);

  useEffect(() => {
    void refreshAccess();
  }, [refreshAccess]);

  const isAdmin = role === "admin";
  const accessReady = !loading && !companyLoading && accessMode !== "loading";

  const value = useMemo<AccessContextValue>(
    () => ({
      loading: !accessReady,
      role,
      partnerId,
      isAdmin,
      permissionsByScreen,
      refreshAccess,
      canViewScreen: (screenKey: string) => {
        if (!accessReady || accessMode === "denied") return false;
        return canRoleViewScreen({
          role,
          partnerId,
          screenKey,
          partnerCanView: Boolean(permissionsByScreen[screenKey]?.can_view),
        });
      },
      canEditScreen: (screenKey: string) => {
        if (!accessReady || accessMode === "denied") return false;
        return canRoleEditScreen({
          role,
          partnerId,
          screenKey,
          partnerCanView: Boolean(permissionsByScreen[screenKey]?.can_view),
          partnerCanEdit: Boolean(permissionsByScreen[screenKey]?.can_edit),
        });
      },
      canDeleteScreen: (screenKey: string) => {
        if (!accessReady || accessMode === "denied") return false;
        return canRoleDeleteScreen({
          role,
          partnerId,
          screenKey,
          partnerCanView: Boolean(permissionsByScreen[screenKey]?.can_view),
          partnerCanDelete: Boolean(permissionsByScreen[screenKey]?.can_delete),
        });
      },
    }),
    [
      accessMode,
      accessReady,
      isAdmin,
      partnerId,
      permissionsByScreen,
      refreshAccess,
      role,
    ]
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  return useContext(AccessContext);
}
