// The small "Preview" pill: tells the player this is a local preview and offers "Reset world".
// Plain DOM (outside React) so it never interferes with the real client; styled inline.

export interface PillOptions {
  onReset: () => void;
  /** Called by the pill owner to show whether the world is being saved. */
  storage: { ok: boolean };
  /** "Show all buildings": set every building of the test village to a look (1 = first, 2 = middle, 3 = last). */
  onShowcase: (stage: 1 | 2 | 3 | 4) => void;
  /** "Try look animations": open the level bar under the village (pick a building, jump between its looks, replay). */
  onLookTester: () => void;
}

const CSS = `
.pv-pill{position:fixed;z-index:2147483000;left:0;right:0;top:env(safe-area-inset-top,0px);height:0;pointer-events:none;font:600 9px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#fbf6e9}
.pv-chip{position:absolute;left:118px;top:0;pointer-events:auto;appearance:none;border:0;cursor:pointer;background:rgba(59,42,26,.72);color:inherit;font:inherit;letter-spacing:.06em;text-transform:uppercase;padding:3px 9px 4px;border-radius:0 0 8px 8px;opacity:.65}
.pv-chip::after{content:'';position:absolute;inset:-4px -12px -14px}
.pv-chip:hover,.pv-chip:focus-visible,.pv-chip[aria-expanded=true]{opacity:1}
.pv-menu{position:absolute;pointer-events:auto;left:12px;right:12px;top:24px;max-width:300px;box-sizing:border-box;background:#fbf6e9;color:#2c2318;border:1px solid #c9b88e;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px rgba(0,0,0,.3);font-weight:400;font-size:13px;line-height:1.4;letter-spacing:0;text-transform:none}
.pv-menu[hidden]{display:none}
.pv-menu p{margin:0 0 8px}
.pv-menu .pv-note{color:#66573f;font-size:12px}
.pv-menu .pv-warn{color:#8a2a12;font-size:12px;font-weight:600}
.pv-btn{appearance:none;border:1px solid #8a2a12;background:#fff;color:#8a2a12;font:600 13px/1 system-ui,sans-serif;border-radius:8px;padding:10px 12px;min-height:40px;width:100%;cursor:pointer}
.pv-btn:hover{background:#f6e3dc}
.pv-sec{margin:10px 0 0;padding-top:8px;border-top:1px solid #e0d3b0}
.pv-sec b{display:block;margin-bottom:6px;font-size:13px}
.pv-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}
.pv-row .pv-btn{min-width:0;min-height:44px;padding:10px 4px}
.pv-btn-yes{background:#8a2a12;color:#fff;margin-top:6px}
.pv-btn-yes:hover{background:#6f2210}
@media (min-width:768px){
.pv-pill{top:auto;bottom:6px;font-size:11px}
.pv-chip{left:50%;top:auto;bottom:0;transform:translateX(-50%);padding:5px 10px;border-radius:999px;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.pv-chip::after{inset:-6px}
.pv-menu{left:50%;right:auto;top:auto;bottom:32px;transform:translateX(-50%);width:250px}
}
`;

export interface Pill {
  setStorageOk(ok: boolean): void;
}

export function mountPill(opts: PillOptions): Pill {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const root = document.createElement('div');
  root.className = 'pv-pill';

  const chip = document.createElement('button');
  chip.className = 'pv-chip';
  chip.type = 'button';
  chip.textContent = 'Preview';
  chip.setAttribute('aria-haspopup', 'true');
  chip.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'pv-menu';
  menu.hidden = true;

  const about = document.createElement('p');
  about.textContent = 'Preview build: the whole game runs in this page, with computer players. Your progress is saved in this browser.';
  const warn = document.createElement('p');
  warn.className = 'pv-warn';
  warn.hidden = !!opts.storage.ok;
  warn.textContent = 'Saving is unavailable here, so progress will be lost on reload.';
  const reset = document.createElement('button');
  reset.className = 'pv-btn';
  reset.type = 'button';
  reset.textContent = 'Reset world';
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'pv-btn pv-btn-yes';
  confirmBtn.type = 'button';
  confirmBtn.textContent = 'Yes, wipe my save';
  confirmBtn.hidden = true;
  const confirmNote = document.createElement('p');
  confirmNote.className = 'pv-note';
  confirmNote.hidden = true;
  confirmNote.textContent = 'This deletes your village and starts a new world.';

  const sec = document.createElement('div');
  sec.className = 'pv-sec';
  const secTitle = document.createElement('b');
  secTitle.textContent = 'Show all buildings';
  const row = document.createElement('div');
  row.className = 'pv-row';
  for (const stage of [1, 2, 3, 4] as const) {
    const b = document.createElement('button');
    b.className = 'pv-btn';
    b.type = 'button';
    b.textContent = `Stage ${stage}`;
    b.addEventListener('click', () => {
      for (const x of row.querySelectorAll('button')) x.disabled = true;
      opts.onShowcase(stage);
    });
    row.append(b);
  }
  const secNote = document.createElement('p');
  secNote.className = 'pv-note';
  secNote.textContent = 'Preview only \u2014 changes your test village';
  sec.append(secTitle, row, secNote);

  const anim = document.createElement('div');
  anim.className = 'pv-sec';
  const animTitle = document.createElement('b');
  animTitle.textContent = 'Look change animation';
  const animBtn = document.createElement('button');
  animBtn.className = 'pv-btn';
  animBtn.type = 'button';
  animBtn.textContent = 'Try look animations';
  animBtn.addEventListener('click', () => {
    opts.onLookTester();
    setOpen(false);
  });
  const animNote = document.createElement('p');
  animNote.className = 'pv-note';
  animNote.textContent = 'Opens a bar on the village: pick a building, press Look 1\u20134 or Replay. Nothing is saved.';
  anim.append(animTitle, animBtn, animNote);

  menu.append(about, warn, sec, anim, reset, confirmNote, confirmBtn);
  root.append(chip, menu);

  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    chip.setAttribute('aria-expanded', String(open));
    if (!open) {
      confirmBtn.hidden = true;
      confirmNote.hidden = true;
    }
  };
  chip.addEventListener('click', () => setOpen(menu.hidden));
  reset.addEventListener('click', () => {
    confirmBtn.hidden = false;
    confirmNote.hidden = false;
  });
  confirmBtn.addEventListener('click', () => opts.onReset());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && e.target instanceof Node && !root.contains(e.target)) setOpen(false);
  });

  document.body.append(root);
  return {
    setStorageOk(ok) {
      warn.hidden = ok;
    },
  };
}
