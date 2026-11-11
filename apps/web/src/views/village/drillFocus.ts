// Hand-over: "Go to Drillyard" on an unresearched unit remembers which research card the Drillyard page should highlight.
// Read by more than one panel (and by dev double-mounts), so it expires instead of being consumed.
let pending: { unit: string; until: number } | null = null;

export function setResearchFocus(unit: string): void {
  pending = { unit, until: Date.now() + 6000 };
}

export function takeResearchFocus(): string | null {
  return pending && pending.until > Date.now() ? pending.unit : null;
}
