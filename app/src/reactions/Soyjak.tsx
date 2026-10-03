// The two soyjaks from the "Two Soyjaks Pointing" template (public/memes/, credits in CREDITS.md),
// cropped apart: the gawking one with glasses sits bottom-left, the pointing one bottom-right
// pointing back at the card.
import { assetUrl } from "../assetUrl";

export function Soyjak({ variant, className }: { variant: "glasses" | "pointing"; className?: string }) {
  return <img className={className} src={assetUrl(`/memes/soyjak-${variant}.png`)} alt="" draggable={false} />;
}
