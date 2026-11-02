// Mags the Tinker, the advisor (approved artboard VillageViewDesktop), as a plain .svg asset so she costs no JS.
// Decorative; her words are plain text next to her.

import MAGS_URL from './mags.svg?no-inline';

export function Mags({ size = 150, className }: { size?: number; className?: string }) {
  return <img src={MAGS_URL} width={size} height={Math.round((size * 268) / 244)} alt="" className={className} draggable={false} />;
}
