"use client";

import { useEffect, useState } from "react";
import { nextNumericCode } from "@/lib/codes";

/** Gera o próximo código numérico ao abrir "Novo"; na edição usa o código existente. */
export function useSeedNumericCode(
  table: string,
  companyId: string | null,
  item: { id?: string; code?: string | null } | null | undefined
) {
  const [seedCode, setSeedCode] = useState(item?.code ?? "");
  const [codeReady, setCodeReady] = useState(Boolean(item?.id || item?.code));

  useEffect(() => {
    if (item?.id) {
      setSeedCode(item.code ?? "");
      setCodeReady(true);
      return;
    }
    if (!companyId) return;
    let cancelled = false;
    setCodeReady(false);
    void nextNumericCode(table, companyId, 8).then((code) => {
      if (!cancelled) {
        setSeedCode(code);
        setCodeReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, item?.code, item?.id, table]);

  return { seedCode, codeReady };
}
