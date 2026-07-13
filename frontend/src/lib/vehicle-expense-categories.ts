/** Categorias rápidas de despesa por veículo → contas DRE. */

export type VehicleExpenseCategoryKey =
  | "pedagio"
  | "combustivel"
  | "pneu"
  | "oficina"
  | "outros";

export type VehicleExpenseCategory = {
  key: VehicleExpenseCategoryKey;
  label: string;
  /** Nome exato no plano de contas (null = usuário escolhe). */
  accountName: string | null;
};

export const VEHICLE_EXPENSE_CATEGORIES: VehicleExpenseCategory[] = [
  { key: "pedagio", label: "Pedágio", accountName: "Pedágio" },
  { key: "combustivel", label: "Combustível", accountName: "Posto de Combustível" },
  { key: "pneu", label: "Troca de pneu", accountName: "Pneus" },
  { key: "oficina", label: "Oficina / manutenção", accountName: "Manutenção de bens" },
  { key: "outros", label: "Outros", accountName: null },
];

export const VEHICLE_EXPENSE_ENTRY_SOURCE = "vehicle_expense";
