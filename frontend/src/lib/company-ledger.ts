/** Lançamentos manuais da empresa (DRE geral — sem vínculo obrigatório com placa). */

export const COMPANY_LEDGER_ENTRY_SOURCE = "company_ledger";

/** Histórico importado (teste) — aparece no DRE Empresa sem o unique index de company_ledger. */
export const IMPORT_HISTORICO_TESTE_ENTRY_SOURCE = "import_historico_teste";

export const COMPANY_LEDGER_ENTRY_SOURCES = [
  COMPANY_LEDGER_ENTRY_SOURCE,
  IMPORT_HISTORICO_TESTE_ENTRY_SOURCE,
] as const;

export type CompanyLedgerTypeFilter = "all" | "Receita" | "Despesa";
