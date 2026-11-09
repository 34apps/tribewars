// "Top three" box of the Ranks page's right column. Own small component so its design can be swapped without touching the page:
// keep the props, and keep the box height (the You card above and the Domination box below depend on it). The look is TEMPORARY (plain list).

export interface TopThreeItem {
  key: number;
  rank: number;
  name: string;
  sub: string;
}

export function TopThree({ items, onPick }: { items: TopThreeItem[]; onPick: (key: number) => void }) {
  return (
    <section className="fv-pn frk-top3" aria-label="Top three">
      <div className="fv-ph">
        <h2>Top three</h2>
      </div>
      <ol className="frk-t3">
        {items.slice(0, 3).map((it) => (
          <li key={it.key}>
            <button type="button" className="frk-t3-b" onClick={() => onPick(it.key)} aria-label={`${it.name}, rank ${it.rank}, ${it.sub}`}>
              <span className="frk-t3-n">{it.rank}</span>
              <b>{it.name}</b>
              <span className="fv-mut">{it.sub}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
