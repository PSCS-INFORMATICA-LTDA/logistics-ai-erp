import type { CarWashServiceRow } from "@/lib/patio";

export type PatioWashLoyaltySettings = {
  company_id: string;
  wash_loyalty_enabled: boolean;
  wash_loyalty_every_n: 5 | 10;
  wash_loyalty_reward_qty: number;
};

export const DEFAULT_WASH_LOYALTY_SETTINGS: Omit<PatioWashLoyaltySettings, "company_id"> = {
  wash_loyalty_enabled: true,
  wash_loyalty_every_n: 5,
  wash_loyalty_reward_qty: 1,
};

export type WashLoyaltyProgress = {
  enabled: boolean;
  everyN: number;
  rewardQty: number;
  paidCompleted: number;
  rewardsEarned: number;
  rewardsUsed: number;
  availableFree: number;
  /** Pagos no ciclo atual (0 .. everyN-1). */
  towardNext: number;
  remainingToReward: number;
};

export function computeWashLoyaltyProgress(
  rows: Pick<CarWashServiceRow, "status" | "is_loyalty_reward">[],
  settings: Pick<
    PatioWashLoyaltySettings,
    "wash_loyalty_enabled" | "wash_loyalty_every_n" | "wash_loyalty_reward_qty"
  >
): WashLoyaltyProgress {
  const everyN = settings.wash_loyalty_every_n || 5;
  const rewardQty = settings.wash_loyalty_reward_qty || 1;
  const enabled = Boolean(settings.wash_loyalty_enabled);

  const paidCompleted = rows.filter(
    (r) => r.status === "Concluido" && !r.is_loyalty_reward
  ).length;
  const rewardsUsed = rows.filter(
    (r) =>
      (r.status === "Concluido" || r.status === "Pronto" || r.status === "Aberto") &&
      Boolean(r.is_loyalty_reward)
  ).length;
  const rewardsEarned = enabled ? Math.floor(paidCompleted / everyN) * rewardQty : 0;
  const availableFree = Math.max(0, rewardsEarned - rewardsUsed);
  const cycle = enabled ? paidCompleted % everyN : 0;
  const remainingToReward = availableFree > 0 ? 0 : everyN - cycle;

  return {
    enabled,
    everyN,
    rewardQty,
    paidCompleted,
    rewardsEarned,
    rewardsUsed,
    availableFree,
    towardNext: cycle,
    remainingToReward,
  };
}

export function washLoyaltyLabel(progress: WashLoyaltyProgress): string {
  if (!progress.enabled) return "Fidelidade desligada";
  if (progress.availableFree > 0) {
    return `${progress.availableFree} lavagem(ns) grátis disponível(is)`;
  }
  return `${progress.towardNext}/${progress.everyN} lavagens — faltam ${progress.remainingToReward} para ${progress.rewardQty} grátis`;
}
