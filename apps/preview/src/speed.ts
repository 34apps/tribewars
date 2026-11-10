// The speed chip: a second small vertical chip on the left edge, just below the "Preview" chip. It always shows the
// current pace (world speed x clock rate; 1x = the real game) and opens a small panel to change it or skip ahead.
// Plain DOM like pill.ts; it reuses the .pv-* styles that mountPill injects, so mount the pill first.

export interface SpeedOptions {
  /** Game seconds per real second (clock.ts). */
  getRate: () => number;
  setRate: (rate: number) => void;
  /** The world's own speed setting (1 for new worlds; older saved worlds may be 25). */
  getWorldSpeed: () => number;
  /** Game time now, and when the world started (ms). */
  gameNow: () => number;
  worldStart: () => number;
  /** Skip ahead with catch-up; resolves when done. */
  skip: (ms: number) => Promise<void>;
}

const CSS = `
.pv-speed-chip{top:-50px;transform:none;white-space:nowrap}
.pv-speed-chip.pv-fast{opacity:1;background:#b8431f;color:#fff;box-shadow:0 0 0 2px rgba(255,214,150,.9)}
.pv-speed-chip.pv-busy{opacity:1;background:#b8431f}
.pv-speed-menu .pv-time{font-weight:600;margin:0 0 8px}
.pv-speed-menu .pv-btn.pv-on{background:#8a2a12;color:#fff}
.pv-speed-menu .pv-btn:disabled{opacity:.55;cursor:default}
.pv-speed-menu .pv-row-3{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:6px}
.pv-speed-menu .pv-row-3 .pv-btn{min-width:0;min-height:44px;padding:10px 2px}
`;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function formatGameTime(now: number, start: number): string {
  const day = Math.max(0, Math.floor((now - start) / DAY)) + 1;
  const d = new Date(now);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `Day ${day} · ${hh}:${mm}`;
}

export function formatPace(x: number): string {
  return `${Math.round(x).toLocaleString('en-US')}x`;
}

export interface SpeedChip {
  refresh(): void;
}

export function mountSpeed(opts: SpeedOptions): SpeedChip {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const root = document.createElement('div');
  root.className = 'pv-pill';

  const chip = document.createElement('button');
  chip.className = 'pv-chip pv-speed-chip';
  chip.type = 'button';
  chip.setAttribute('aria-haspopup', 'true');
  chip.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'pv-menu pv-speed-menu';
  menu.hidden = true;

  const title = document.createElement('p');
  title.innerHTML = '<b>Game speed</b>';
  const time = document.createElement('p');
  time.className = 'pv-time';
  const row = document.createElement('div');
  row.className = 'pv-row-3';
  const skipTitle = document.createElement('b');
  skipTitle.textContent = 'Skip ahead';
  const skipSec = document.createElement('div');
  skipSec.className = 'pv-sec';
  const skipRow = document.createElement('div');
  skipRow.className = 'pv-row';
  const note = document.createElement('p');
  note.className = 'pv-note';
  note.textContent = 'Everything speeds up: income, building, training, marches and the computer players. 1x is the real game.';

  let busy = false;
  const rateButtons: Array<{ rate: number; el: HTMLButtonElement }> = [];
  const skipButtons: HTMLButtonElement[] = [];

  const pace = (): number => opts.getWorldSpeed() * opts.getRate();

  const rebuildRates = (): void => {
    const speed = opts.getWorldSpeed();
    const rates = speed > 1 ? [1, 10, 100] : [1, 10, 100, 1000]; // an older fast world: never a rate below 1
    row.replaceChildren();
    rateButtons.length = 0;
    for (const rate of rates) {
      const b = document.createElement('button');
      b.className = 'pv-btn';
      b.type = 'button';
      b.textContent = formatPace(speed * rate);
      b.addEventListener('click', () => {
        if (busy) return;
        opts.setRate(rate);
        refresh();
      });
      rateButtons.push({ rate, el: b });
      row.append(b);
    }
  };

  for (const [label, ms] of [['+1 hour', HOUR], ['+1 day', DAY]] as const) {
    const b = document.createElement('button');
    b.className = 'pv-btn';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      refresh();
      opts.skip(ms).then(
        () => finish(),
        (err: unknown) => {
          console.error('skip failed', err);
          finish();
        },
      );
    });
    skipButtons.push(b);
    skipRow.append(b);
  }
  skipSec.append(skipTitle, skipRow);
  menu.append(title, time, row, skipSec, note);
  root.append(chip, menu);

  function finish(): void {
    busy = false;
    refresh();
  }

  function refresh(): void {
    const x = pace();
    const fast = x > 1;
    chip.textContent = busy ? 'Skipping…' : `Speed ${formatPace(x)}`;
    chip.classList.toggle('pv-fast', fast);
    chip.classList.toggle('pv-busy', busy);
    time.textContent = busy ? 'Skipping ahead…' : formatGameTime(opts.gameNow(), opts.worldStart());
    const rate = opts.getRate();
    for (const { rate: r, el } of rateButtons) {
      el.classList.toggle('pv-on', r === rate);
      el.setAttribute('aria-pressed', String(r === rate));
      el.disabled = busy;
    }
    for (const b of skipButtons) b.disabled = busy;
  }

  let tick: number | undefined;
  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    chip.setAttribute('aria-expanded', String(open));
    if (open) {
      document.dispatchEvent(new CustomEvent('pv-menu-open', { detail: root }));
      refresh();
      tick = window.setInterval(refresh, 1000);
    } else if (tick !== undefined) {
      window.clearInterval(tick);
      tick = undefined;
    }
  };
  chip.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('pv-menu-open', (e) => {
    if ((e as CustomEvent).detail !== root && !menu.hidden) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && e.target instanceof Node && !root.contains(e.target)) setOpen(false);
  });

  rebuildRates();
  refresh();
  document.body.append(root);
  return { refresh };
}
