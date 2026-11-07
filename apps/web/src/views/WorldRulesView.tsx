// "World rules": the published rules of this world (GET /api/world/config), read-only. Reached from the account menu. One column on
// a phone, two or three columns of cards on wide screens; the page scrolls (no inner scrollbars).

import type { WorldConfigResponse } from '@clanfire/engine';
import { formatDate } from '../format.ts';
import { useWorldConfigState } from '../hooks/useWorldConfig.ts';
import type { WorldConfigState } from '../hooks/useWorldConfig.ts';
import { ruleGroups } from '../ruleText.ts';

const trim = (n: number): string => String(Number(n.toFixed(2)));

function openedText(r: WorldConfigResponse): string {
  if (!r.open) return 'Not open yet';
  const at = r.openedAt ? Date.parse(r.openedAt) : NaN;
  return Number.isFinite(at) ? `Open since ${formatDate(at)}` : 'Open';
}

/** The page body for a loaded (or failed) state; split from the data hook so it renders from any config. */
export function WorldRulesPanel({ state }: { state: WorldConfigState }) {
  const { config, response, status } = state;
  const speed = config.pace.speed;
  const groups = ruleGroups(config, response?.editableAfterOpen ?? []);
  const walk = speed * config.pace.unitSpeed;
  return (
    <div className="page rules-page">
      <h1 className="page-title">World rules</h1>

      {status === 'loading' && <p className="muted" role="status">Loading…</p>}
      {status === 'failed' && (
        <p className="why" role="alert">
          Rules could not be loaded. Showing standard rules.
        </p>
      )}

      <section className="card rules-head" aria-labelledby="rules-world">
        <h2 id="rules-world" className="card-title">{response ? response.name : 'This world'}</h2>
        <dl className="facts rules-facts">
          {response && (
            <div>
              <dt>State</dt>
              <dd>{openedText(response)}</dd>
            </div>
          )}
          <div>
            <dt>World speed</dt>
            <dd>{trim(speed)}×</dd>
          </div>
          <div>
            <dt>March speed</dt>
            <dd>{trim(walk)}×</dd>
          </div>
          {response && (
            <div>
              <dt>Map</dt>
              <dd>
                {response.map.radius} tiles, {response.map.layout === 'expanding' ? 'growing' : 'scattered'}
              </dd>
            </div>
          )}
        </dl>
        {response && !response.open && <p className="muted small rules-note">Any rule can still change.</p>}
      </section>

      <div className="rules-grid">
        {groups.map((g) => (
          <section key={g.id} className="card rules-card" aria-labelledby={`rules-${g.id}`}>
            <h2 id={`rules-${g.id}`} className="card-title">{g.title}</h2>
            <dl className="rules-list">
              {g.rows.map((row) => (
                <div key={row.path} className="rules-row" data-path={row.path}>
                  <dt className="rules-label" title={row.help}>{row.label}</dt>
                  <dd className="rules-value">
                    {row.value}
                    {row.atSpeed1 && <span className="muted small rules-at1"> {row.atSpeed1}</span>}
                  </dd>
                  {response?.open && row.editable && (
                    <dd className="rules-help muted small">
                      <span className="tag tag-info rules-tag">Can still change</span>
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

export function WorldRulesView() {
  return <WorldRulesPanel state={useWorldConfigState()} />;
}
