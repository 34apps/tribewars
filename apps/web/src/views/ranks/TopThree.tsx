// "Top three" box of the Ranks page's right column (owner pick "A · Mini leaderboard"): three calm rows, each a medal, a small portrait
// (an initial circle when the ranking carries no portrait; a tag badge for tribes), the name as a link, the tribe tag and the value.
// Keep the box height (the You card above and the Domination box below depend on it).

import { ChieftainAvatar } from '../../art/Chieftain.tsx';

export interface TopThreeItem {
  key: number;
  rank: number;
  name: string;
  /** Tribe tag without brackets (players), or null. */
  tag: string | null;
  /** Right-aligned value, e.g. "14,920". */
  value: string;
  /** Chieftain portrait id when known; otherwise an initial circle (players) or the tag badge (`tribe`). */
  chieftain?: string | null;
  tribe?: boolean;
}

export function TopThree({ items, valueLabel, onPick }: { items: TopThreeItem[]; valueLabel: string; onPick: (key: number) => void }) {
  return (
    <section className="fv-pn frk-top3" aria-label="Top three">
      <div className="fv-ph">
        <h2>Top three</h2>
        <span className="fv-sp" />
        <span className="fv-mut">{valueLabel}</span>
      </div>
      <ol className="frk-t3">
        {items.slice(0, 3).map((it) => (
          <li key={it.key} className="frk-t3-r">
            <span className={`frk-md g${it.rank}`} aria-label={`Rank ${it.rank}`}>{it.rank}</span>
            {it.tribe ? (
              <span className="frk-t3-av is-tag" aria-hidden="true">{it.tag}</span>
            ) : it.chieftain ? (
              <span className="frk-t3-av"><ChieftainAvatar id={it.chieftain} size={32} /></span>
            ) : (
              <span className="frk-t3-av is-init" aria-hidden="true">{it.name.slice(0, 1).toUpperCase()}</span>
            )}
            <button type="button" className="frk-who frk-t3-n" onClick={() => onPick(it.key)}>{it.name}</button>
            {!it.tribe && <span className="frk-t3-g">{it.tag && <span className="frk-tag">{it.tag}</span>}</span>}
            <span className="frk-t3-v">{it.value}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
