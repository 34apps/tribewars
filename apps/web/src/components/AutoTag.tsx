
/** Small filled "auto" tag on a build or training job that auto mode queued (`job.auto`). */
export function AutoTag({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="auto-tag" title="Queued by auto mode">
      auto
    </span>
  );
}
