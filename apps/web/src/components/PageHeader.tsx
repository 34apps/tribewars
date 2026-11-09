import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../art/Icon.tsx';
import type { IconName } from '../art/Icon.tsx';

export interface PageHeaderTab {
  key: string;
  label: ReactNode;
  /** Small count bubble inside the tab (waiting items). */
  badge?: number;
  badgeLabel?: string;
  disabled?: boolean;
  /** DOM id and aria-controls for real tab panels. */
  id?: string;
}

interface Props {
  icon: IconName;
  title: ReactNode;
  /** Small chip right of the title, e.g. "20 new" or "300 / 311". */
  count?: ReactNode;
  /** Buttons on the right. */
  actions?: ReactNode;
  tabs?: PageHeaderTab[];
  activeTab?: string;
  onTab?: (key: string) => void;
  tabsLabel?: string;
  /** 'tablist' (default) for real tab panels, 'group' for toggle buttons (aria-pressed). */
  tabsRole?: 'tablist' | 'group';
  panelId?: string;
  titleId?: string;
  /** Extra content under the title row (small text). */
  children?: ReactNode;
}

/** The top of every page sheet: big toy icon token, Bagel title, count chip, actions and chunky sub-tabs. */
export function PageHeader({ icon, title, count, actions, tabs, activeTab, onTab, tabsLabel, tabsRole = 'tablist', panelId, titleId, children }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  // Keep the active sub-tab in view on a phone (the row scrolls sideways when it is too wide).
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>('[data-active="true"]');
    if (!row || !chip) return;
    const left = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
    row.scrollTo?.({ left: Math.max(0, left) });
  }, [activeTab]);

  return (
    <header className="ph">
      <div className="ph-row">
        <span className="ph-token" aria-hidden="true">
          <Icon name={icon} size={34} />
        </span>
        <h1 className="ph-title" id={titleId}>{title}</h1>
        {count !== undefined && count !== null && count !== '' && <span className="ph-count">{count}</span>}
        {actions && <div className="ph-actions">{actions}</div>}
      </div>
      {children}
      {tabs && tabs.length > 0 && (
        <div className="ph-tabs" role={tabsRole} aria-label={tabsLabel} ref={rowRef}>
          {tabs.map((t) => {
            const active = activeTab === t.key;
            const tabProps =
              tabsRole === 'tablist'
                ? { role: 'tab', 'aria-selected': active, id: t.id, 'aria-controls': panelId }
                : { 'aria-pressed': active };
            return (
              <button
                key={t.key}
                type="button"
                {...tabProps}
                data-active={active}
                disabled={t.disabled}
                className={`ph-tab${active ? ' is-active' : ''}`}
                onClick={() => onTab?.(t.key)}
              >
                {t.label}
                {t.badge !== undefined && t.badge > 0 && (
                  <span className="ph-badge" aria-label={t.badgeLabel ?? `${t.badge} waiting`}>{t.badge}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}
