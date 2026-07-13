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
import { APP_SCREENS, FULL_ACCESS, type ScreenPermissionFlags } from "@/lib/app-screens";
import { useCompany } from "@/lib/company-context";
import { createClient } from "@/lib/supabase/client";

export type MemberRole = "admin" | "financeiro" | "operacional" | "socio";

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
  canViewScreen: () => true,
  canEditScreen: () => true,
  canDeleteScreen: () => true,
  permissionsByScreen: {},
  refreshAccess: async () => {},
});

export function AccessProvider({ children }: { children: ReactNode }) {
  const { companyId } = useCompany();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [permissionsByScreen, setPermissionsByScreen] = useState<
    Record<string, ScreenPermissionFlags>
  >({});

  const refreshAccess = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !companyId) {
      setRole(null);
      setPartnerId(null);
      setPermissionsByScreen({});
      setLoading(false);
      return;
    }

    const { data: membership } = await supabase
      .from("company_members")
      .select("role, partner_id")
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .maybeSingle();

    const memberRole = (membership?.role as MemberRole | undefined) ?? null;
    const linkedPartnerId = (membership?.partner_id as string | null) ?? null;
    setRole(memberRole);
    setPartnerId(linkedPartnerId);

    if (memberRole === "admin" || !linkedPartnerId) {
      // Admin = tudo. Sem partner vinculado: mantém acesso legado completo.
      const full: Record<string, ScreenPermissionFlags> = {};
      for (const screen of APP_SCREENS) full[screen.key] = { ...FULL_ACCESS };
      setPermissionsByScreen(full);
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
    setLoading(false);
  }, [companyId, supabase]);

  useEffect(() => {
    void refreshAccess();
  }, [refreshAccess]);

  const isAdmin = role === "admin";

  const value = useMemo<AccessContextValue>(
    () => ({
      loading,
      role,
      partnerId,
      isAdmin,
      permissionsByScreen,
      refreshAccess,
      canViewScreen: (screenKey: string) => {
        if (isAdmin || !partnerId) return true;
        if (screenKey === "configuracoes.parametros") return false;
        return Boolean(permissionsByScreen[screenKey]?.can_view);
      },
      canEditScreen: (screenKey: string) => {
        if (isAdmin || !partnerId) return true;
        return Boolean(permissionsByScreen[screenKey]?.can_edit);
      },
      canDeleteScreen: (screenKey: string) => {
        if (isAdmin || !partnerId) return true;
        return Boolean(permissionsByScreen[screenKey]?.can_delete);
      },
    }),
    [isAdmin, loading, partnerId, permissionsByScreen, refreshAccess, role]
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  return useContext(AccessContext);
}
