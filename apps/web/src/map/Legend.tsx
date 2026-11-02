import { LEGEND_ORDER, RELATION_STYLE } from '../relations.ts';

/** Compact, collapsible key to the village colours (closed by default so it never covers the map). */
export function Legend() {
  return (
    <details className="map-legend">
      <summary>
        <span aria-hidden="true">🎨</span> Legend
      </summary>
      <ul>
        {LEGEND_ORDER.map((k) => (
          <li key={k}>
            <span className="swatch" style={{ background: RELATION_STYLE[k].body, borderColor: RELATION_STYLE[k].roof }} aria-hidden="true" />
            {RELATION_STYLE[k].label}
          </li>
        ))}
        <li>
          <span className="swatch swatch-ring" aria-hidden="true" />
          Beginner protection
        </li>
      </ul>
    </details>
  );
}
