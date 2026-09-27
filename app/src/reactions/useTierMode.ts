// Tier mode (H): price tiers vs hype mode (rarity), remembered per viewer.
import { useCallback, useState } from "react";
import { loadTierMode, nextTierMode, saveTierMode, type TierMode } from "./tiers";

/** Price tiers vs hype mode (rarity). A saved choice wins over tiers.json's default. */
export function useTierMode(configDefault: TierMode | undefined) {
  const [saved, setSaved] = useState<TierMode | null>(() => loadTierMode(null));
  const mode: TierMode = saved ?? configDefault ?? "price";
  const toggle = useCallback(() => {
    setSaved((s) => {
      const next = nextTierMode(s ?? configDefault ?? "price");
      saveTierMode(next);
      return next;
    });
  }, [configDefault]);
  return { tierMode: mode, toggleTierMode: toggle };
}

export const tierModeLabel = (m: TierMode) => (m === "price" ? "Price tiers" : "Hype mode (rarity)");
