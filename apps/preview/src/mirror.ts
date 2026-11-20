// The local world mirror's address and one-time problem report (host.ts). Kept apart so a test can reach it.

/**
 * Absolute address of the dev/local server's mirror endpoint, built from the page or worker `location.href`.
 * In the built file the game worker runs from a blob: URL, where a relative address cannot be resolved.
 */
export function mirrorUrl(href: string | null | undefined): string | null {
  try {
    return new URL('/__clanfire/preview-world', String(href ?? '').replace(/^blob:/, '')).href;
  } catch {
    return null;
  }
}

/** Says why the mirror is not working, once per reason: a stale local build or a missing server otherwise fails in silence. */
export function createProblemReporter(log: (msg: string) => void): (reason: string) => void {
  const seen = new Set<string>();
  return (reason) => {
    if (seen.has(reason)) return;
    seen.add(reason);
    log(`Clanflame world mirror: ${reason}. The owner's copy on disk is not updating (rebuild with npm run build:preview:local?).`);
  };
}
