// Generates mockups/{a,b,c}-{reports,army}-{1440,360}.html (page tabs: Reports + Army) from the real Icon.tsx markup (tooling/icons.html)
// and the real unit art (mockups/units/*.svg). Run: node tooling/gen.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const OUT = join(here, '..', 'mockups');
const raw = readFileSync(join(here, 'icons.html'), 'utf8'); const ICONS = {};
for (const m of raw.matchAll(/<div data-n="(\w+)">(<svg[\s\S]*?<\/svg>)<\/div>/g)) ICONS[m[1]] = m[2];
const ic = (n, s = 24) => ICONS[n].replace('width="64" height="64"', `width="${s}" height="${s}"`);
const chev = (s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>`;
const av = (s = 46) => `<span class="ring" style="width:${s}px;height:${s}px"><img src="avatar.svg" width="${s}" height="${s}" alt=""></span>`;
const pt = (u, s = 44) => `<img class="pt" src="units/${u}.svg" width="${s}" height="${s}" alt="">`;
const fig = (u, s = 84) => `<img class="pt" src="units/${u}-idle.svg" width="${s}" height="${s}" alt="">`;

/* ---------------- data ---------------- */
const RES = [['wood', '48.2k', '+1,025/h'], ['food', '31.4k', '+1,875/h'], ['iron', '22.8k', '+875/h'], ['gold', '15.7k', '+350/h']];
const TABS = [['village', 'Village'], ['map', 'Map'], ['army', 'Army'], ['reports', 'Reports'], ['mail', 'Mail'], ['tribe', 'Tribe'], ['ranks', 'Ranks']];
const P5 = [['village', 'Village'], ['map', 'Map'], ['army', 'Army'], ['reports', 'Reports'], ['more', 'More']];
// k: d = defence, r = own raid. res: won | lost.
const REP = [
  { g: 'Today', n: 'Tolvek', k: 'd', res: 'won', t: '4h', xy: '-2|4' },
  { n: 'Ironhart', k: 'd', res: 'won', t: '8h', xy: '-27|-18' },
  { n: 'Ysolde_K', k: 'd', res: 'won', t: '12h', xy: '24|-30' },
  { n: 'You', k: 'r', res: 'won', t: '14h', xy: '3|-4' },
  { n: 'Brannoch', k: 'd', res: 'won', t: '16h', xy: '-9|-1' },
  { n: 'Tolvek', k: 'd', res: 'lost', t: '20h', xy: '-2|4' },
  { g: 'Yesterday', n: 'Ironhart', k: 'd', res: 'won', t: '1d', xy: '-27|-18' },
  { n: 'Ysolde_K', k: 'd', res: 'won', t: '1d', xy: '24|-30' },
];
const verb = (r) => (r.k === 'r' ? 'You raided' : `${r.n} attacked`);
const UNITS = [['pikeman', 'Pikeman', 40, 0, 0], ['guard', 'Shieldbearer', 25, 0, 0], ['raider', 'Raider', 12, 4, 5], ['outrider', 'Outrider', 8, 0, 0], ['knight', 'Knight', 6, 0, 0], ['pathfinder', 'Pathfinder', 3, 0, 0], ['chieftain', 'Chieftain', 2, 0, 0], ['logram', 'Log Ram', 1, 0, 0], ['boulder', 'Boulder Sling', 0, 0, 0]];

/* ---------------- shared css: header pills + dock (same as the liked village HUD) ---------------- */
const BASE = `
html,body{margin:0}html{overflow:hidden}*,*::before,*::after{box-sizing:border-box}
body{position:relative;overflow:hidden;background:var(--page);color:var(--on-surface);font:15px/1.3 var(--font);-webkit-font-smoothing:antialiased}
body.d{width:1440px;height:900px}body.p{width:360px;height:780px}
svg{display:block;flex:none}img{display:block}h1,h2,h3{margin:0;font-weight:400}
.art{position:absolute;inset:0;background-image:url(scene.png);background-repeat:no-repeat}
.ring{display:block;flex:none;border-radius:50%;border:2.5px solid var(--c-ink);background:var(--c-sun);overflow:hidden}.ring img{width:100%;height:100%}
.bell{position:relative;flex:none;display:grid;place-items:center;border-radius:50%;border:2.5px solid var(--c-ink);background:var(--surface);box-shadow:0 3px 0 var(--c-ink)}
.bd{position:absolute;top:-6px;right:-6px;min-width:21px;height:21px;padding:0 5px 1px;border-radius:99px;border:2px solid var(--c-ink);display:grid;place-items:center;font:700 12px/1 var(--font)}
.bd.red{background:var(--strip-danger);color:var(--on-strip)}.bd.dk{background:var(--dark);color:var(--on-dark)}
.rs{display:flex;align-items:center;gap:6px;white-space:nowrap}.rs b{display:block;font:700 15px/1.05 var(--font);color:var(--heading)}.rs small{display:block;font:500 11px/1.2 var(--font);color:var(--on-surface-muted);margin-top:1px}
.atk{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px 2px 10px;border:2.5px solid var(--c-ink);border-radius:99px;background:var(--strip-danger);color:var(--on-strip);font:700 15px/1 var(--font);box-shadow:0 4px 0 var(--c-ink);white-space:nowrap}
.prot{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px 2px 9px;border:2.5px solid var(--c-ink);border-radius:99px;background:var(--c-teal-hi);color:var(--on-fill);font:700 14px/1 var(--font);box-shadow:0 3px 0 var(--c-ink);white-space:nowrap}
.fl{position:absolute;z-index:8}
.tlb{left:16px;top:16px}.brandp{display:inline-flex;align-items:center;gap:10px;min-height:56px;padding:0 20px 2px 12px;border:3px solid var(--c-ink);border-radius:99px;background:var(--surface);box-shadow:0 5px 0 var(--c-ink)}
.brandp b{font:400 23px/1 var(--font-display);padding-top:3px}.brandp small{font:600 14px/1 var(--font);color:var(--on-surface-muted)}
.rpill{left:50%;top:16px;transform:translateX(-50%);display:flex;gap:18px;padding:7px 22px;border:3px solid var(--c-ink);border-radius:99px;background:var(--surface);box-shadow:0 5px 0 var(--c-ink)}
.trb{right:16px;top:16px;display:flex;gap:10px;align-items:center}.trb .bell,.trb .ring{box-shadow:0 5px 0 var(--c-ink);border-width:3px}
.row2{left:50%;top:84px;transform:translateX(-50%);display:flex;gap:10px;align-items:center}
.dock{position:absolute;z-index:9;display:flex;padding:8px;border:3px solid var(--c-ink);background:var(--surface)}
.db{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;border:2.5px solid transparent;font:700 13px/1 var(--font)}.db.on{background:var(--c-sun);border-color:var(--c-ink)}
body.d .dock{left:50%;bottom:16px;transform:translateX(-50%);gap:6px;border-radius:30px;box-shadow:0 5px 0 var(--c-ink)}
body.d .db{gap:4px;width:78px;height:70px;border-radius:20px}body.d .db.on{box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -5px 0 var(--c-sun-lo)}.db .bd{top:-6px;right:-2px}
body.p .ptop{position:absolute;z-index:8;top:8px;left:8px;right:8px;display:flex;align-items:center;gap:3px}
.ch{display:flex;align-items:center;gap:2px;height:44px;flex:1 1 0;min-width:0;padding:0 2px 1px 3px;justify-content:center;border:2.5px solid var(--c-ink);border-radius:99px;background:var(--surface);box-shadow:0 3px 0 var(--c-ink);font:700 12.5px/1 var(--font)}.ch svg{width:21px;height:21px}.ptop .bell{margin-left:4px}.ptop .bell .bd{right:-4px}
body.p .pl2{position:absolute;z-index:8;top:64px;left:8px;right:8px;display:flex;gap:6px;align-items:center}
body.p .pl2 .atk{flex:1;min-width:0;font-size:13px;padding:0 10px 2px 8px;gap:6px}body.p .pl2 .atk b{flex:1}body.p .pl2 .atk svg{width:22px;height:22px}body.p .pl2 .prot{font-size:12.5px;padding:0 9px 2px 6px;gap:4px}body.p .pl2 .prot svg{width:19px;height:19px}
body.p .dock{left:8px;right:8px;bottom:10px;justify-content:space-between;padding:6px 8px;border-radius:26px;box-shadow:0 4px 0 var(--c-ink)}
body.p .db{gap:3px;width:58px;height:60px;border-radius:18px;font-size:11.5px}body.p .db.on{box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -4px 0 var(--c-sun-lo)}body.p .db .bd{top:-6px;right:-3px;min-width:19px;height:19px;font-size:11px}
/* shared page pieces */
.pt{border-radius:50%;flex:none}
.tag{display:inline-flex;align-items:center;height:26px;padding:0 11px 1px;border-radius:99px;font:700 13px/1 var(--font);white-space:nowrap}
.tag.won{background:var(--c-leaf);color:var(--c-ink)}.tag.lost{background:var(--strip-danger);color:var(--on-strip)}.tag.loot{background:var(--c-sun);color:var(--c-ink)}.tag.mut{background:var(--surface-3);color:var(--on-surface)}.tag.tl{background:var(--c-teal-hi);color:var(--c-ink)}
.dot{width:10px;height:10px;border-radius:50%;background:var(--accent);flex:none}
.tk{display:grid;place-items:center;flex:none;border-radius:50%;border:2.5px solid var(--c-ink);box-shadow:0 2px 0 var(--c-ink)}
.tk.d{background:var(--c-teal-hi)}.tk.r{background:var(--c-sun)}.tk.x{background:var(--c-terra-hi)}.tk.w{background:var(--c-sun)}.tk.m{background:var(--strip-danger)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px 3px;border:2.5px solid var(--c-ink);border-radius:14px;background:var(--c-bone);box-shadow:inset 0 2px 0 #fff3dc,inset 0 -4px 0 var(--c-bone-shade),0 3px 0 var(--c-ink);font:700 15px/1 var(--font);color:var(--on-fill);white-space:nowrap}
.btn.g{background:var(--c-sun);box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -5px 0 var(--c-sun-lo),0 3px 0 var(--c-ink);font:400 17px/1 var(--font-display)}
.btn.sm{min-height:40px;padding:0 14px 3px;font-size:14px;border-radius:12px}.btn.g.sm{font-size:15px}
.cd{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 11px 1px;border-radius:99px;background:var(--c-ink);color:var(--on-dark);font:700 14px/1 var(--font);white-space:nowrap}.cd.red{background:var(--strip-danger)}
.up{font:700 12px/1 var(--font);letter-spacing:.09em;text-transform:uppercase;color:var(--on-surface-muted)}
.mut{color:var(--on-surface-muted)}
.pop{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 13px 1px 9px;border-radius:99px;background:var(--surface-3);font:700 15px/1 var(--font)}
.lr{display:inline-flex;gap:10px;font-size:13px;font-weight:700}.lr span{display:inline-flex;align-items:center;gap:3px}
`;
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Rubik:wght@400;500;600;700&display=swap">';
const write = (name, cls, body, css = '') => { const w = cls === 'd' ? 1440 : 360; writeFileSync(join(OUT, name + '.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${w}"><title>${name}</title>${FONTS}<link rel="stylesheet" href="tokens.css"><style>${BASE}${css}</style></head><body class="${cls}">${body}</body></html>`); };

const bellEl = (s) => `<span class="bell" style="width:${s}px;height:${s}px">${ic('bell', 26)}<span class="bd red">1</span></span>`;
const res = () => RES.map(([n, a, r]) => `<div class="rs"><i>${ic(n, 28)}</i><div><b>${a}</b><small>${r}</small></div></div>`).join('') + `<div class="rs"><i>${ic('pop', 28)}</i><div><b>300</b><small>of 311</small></div></div>`;
const atkPill = (t) => `<span class="atk">${ic('warning', 24)}<b>${t}</b></span>`;
const protPill = `<span class="prot">${ic('shield', 22)}Protected 2m</span>`;
const dock = (items, active) => `<div class="dock">${items.map(([i, l]) => `<span class="db${i === active ? ' on' : ''}">${i === 'more' ? av(28) : ic(i, 30)}<span>${l}</span>${i === 'army' ? '<span class="bd red">1</span>' : i === 'reports' ? '<span class="bd dk">20</span>' : ''}</span>`).join('')}</div>`;
const hdrD = () => `<div class="fl tlb"><span class="brandp">${ic('flame', 34)}<b>demo391716's village</b><small>24|24</small></span></div><div class="fl rpill">${res()}</div><div class="fl trb">${bellEl(50)}${av(50)}</div><div class="fl row2">${atkPill('Attack in 2m 25s · Brannoch')}${protPill}</div>`;
const chip4 = RES.map(([n, a]) => `<span class="ch">${ic(n, 22)}<b>${a}</b></span>`).join('');
const hdrP = () => `<div class="ptop">${chip4}${bellEl(44)}</div><div class="pl2">${atkPill('Attack 2m 25s · Brannoch')}${protPill}</div>`;
const phoneArt = (cy, k = 1.45) => `.art{background-size:${Math.round(1548 * k)}px auto;background-position:${Math.round(180 - 775 * k)}px ${Math.round(cy - 520 * k)}px}`;
const artD = `.art{background-size:cover;background-position:50% 52%}`;

/* ---------------- shared bits ---------------- */
const tkEl = (r, s = 40) => { const i = r.k === 'r' ? 'army' : 'shield'; const c = r.res === 'lost' ? 'x' : r.k === 'r' ? 'r' : 'd'; return `<span class="tk ${c}" style="width:${s}px;height:${s}px">${ic(i, Math.round(s * 0.6))}</span>`; };
const tagEl = (r) => `<span class="tag ${r.k === 'r' ? 'loot' : r.res}">${r.k === 'r' ? 'Loot' : r.res === 'won' ? 'Won' : 'Lost'}</span>`;
const lootRow = `<span class="lr">${['wood', 'food', 'iron'].map((n) => `<span>${ic(n, 22)}<b>150</b></span>`).join('')}</span>`;
const detail = (big) => {
  const stat = (who, n) => `<div class="st"><span class="up">${who}</span><div class="sr">${pt('pikeman', big ? 64 : 56)}<div><b class="sn">−${n}</b><span class="mut">Pikemen</span></div></div></div>`;
  return `<div class="det"><div class="dh"><h2>Tolvek attacked demo's village</h2><div class="dm"><span class="tag won">Won</span><span class="mut">4h ago · (−2|4)</span></div></div><div class="sts">${stat('Tolvek lost', 8)}${stat('You lost', 2)}</div><div class="wl"><span class="tk d" style="width:36px;height:36px">${ic('shield', 22)}</span><b>Wall level 3</b><span class="mut">held the line</span></div><div class="da"><span class="btn g sm">Send troops</span><span class="btn sm">Delete</span></div></div>`;
};
const detailCss = `.det{display:flex;flex-direction:column;gap:16px}.dh h2{font:400 28px/1.1 var(--font-display);color:var(--heading)}.dm{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:14.5px}
.sts{display:grid;grid-template-columns:1fr 1fr;gap:12px}.st{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:18px;background:var(--surface-2)}.sr{display:flex;align-items:center;gap:12px}.sn{display:block;font:400 34px/1 var(--font-display);color:var(--heading)}.sr span.mut{font-size:14px}
.wl{display:flex;align-items:center;gap:12px;font-size:16px}.da{display:flex;gap:10px;margin-top:4px}`;
const aMovesHtml = (cls) => `<div class="${cls} inc"><span class="tk" style="width:38px;height:38px;background:var(--c-cream)">${ic('warning', 22)}</span><span class="tw"><b>Brannoch attacks</b><span class="sub">(10|7) · size unknown</span></span><span class="cd${cls === 'mvb' ? ' red' : ''}">2m 25s</span></div>
<div class="${cls}"><span class="tk r" style="width:38px;height:38px">${ic('army', 22)}</span><span class="tw"><b>Raid returning</b><span class="sub">${lootRow}</span></span><span class="cd">12m</span></div>`;
const aTrainHtml = (cls) => `<div class="${cls}">${pt('raider', 38)}<span class="tw"><b>5 Raiders</b><span class="sub">next in 3m 10s</span></span><span class="cd">3m 10s</span></div>`;

/* =============== A · Panel over the village =============== */
const A_CSS = `
.sheet{position:absolute;z-index:6;background:var(--surface);border:3px solid var(--c-ink);display:flex;flex-direction:column}
.sh{display:flex;align-items:center;gap:14px}.sh h1{font:400 34px/1 var(--font-display);color:var(--heading);padding-top:3px}.sh .tkb{width:56px;height:56px;border-radius:18px;background:var(--c-sun);border:2.5px solid var(--c-ink);box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -4px 0 var(--c-sun-lo),0 3px 0 var(--c-ink);display:grid;place-items:center;flex:none}
.sh .sp{flex:1}
.seg{display:flex;gap:4px;padding:4px;border:2.5px solid var(--c-ink);border-radius:99px;background:var(--surface-3)}.sg{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:40px;padding:0 18px 2px;border-radius:99px;font:700 15px/1 var(--font);color:var(--on-surface)}.sg.on{background:var(--c-sun);box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -3px 0 var(--c-sun-lo);outline:2.5px solid var(--c-ink)}
.sg i{font-style:normal;display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px 1px;border-radius:99px;background:var(--dark);color:var(--on-dark);font-size:12px}
.up.l{margin:14px 4px 6px}
.r{display:flex;align-items:center;gap:11px;height:48px;padding:0 12px 0 8px;margin-bottom:5px;border-radius:16px;background:var(--surface-2);font-size:16px;white-space:nowrap}.r .nm{font-weight:700}.r .tm{margin-left:auto;color:var(--on-surface-muted);font-size:14px;font-weight:500}.r>svg{color:var(--on-surface-muted)}
.r.sel{background:var(--surface);outline:2.5px solid var(--c-ink);box-shadow:0 3px 0 var(--c-ink)}
.r .xy{color:var(--on-surface-muted);font-weight:500;font-size:14px}
${detailCss}
body.d .sheet{left:50%;transform:translateX(-50%);top:136px;bottom:124px;width:980px;border-radius:30px;box-shadow:0 6px 0 var(--c-ink);padding:18px 24px 14px}
body.d .cols{display:grid;grid-template-columns:500px 1fr;gap:26px;margin-top:6px;flex:1;min-height:0}
body.d .det{padding:14px 0 0}
body.p .sheet{left:0;right:0;top:124px;bottom:0;border-bottom:0;border-radius:30px 30px 0 0;padding:14px 12px 96px;box-shadow:0 -4px 0 rgba(43,33,28,.3);overflow:hidden}
body.p .sh h1{font-size:28px}body.p .sh .tkb{width:48px;height:48px;border-radius:16px}
body.p .seg{margin-top:12px}body.p .sg{flex:1;padding:0 4px 2px;font-size:14px;height:38px;gap:5px}
body.p .r{height:50px;margin-bottom:5px;font-size:15px;gap:8px;padding:0 10px 0 6px}body.p .r .tk{width:34px!important;height:34px!important}body.p .r .tag{padding:0 9px 1px;font-size:12.5px}body.p .r .xy{display:none}
.ur{display:flex;align-items:center;gap:12px;height:50px;padding:0 14px 0 6px;margin-bottom:5px;border-radius:16px;background:var(--surface-2);font-size:16px;white-space:nowrap}.ur b{font-weight:700}.ur .ct{margin-left:auto;font:400 26px/1 var(--font-display);color:var(--heading);padding-top:3px}.ur.lk{opacity:.5}body.p .ur .tag.tl{display:none}.ur.lk .ct{font-size:20px}
.mv{display:flex;align-items:center;gap:11px;min-height:52px;padding:0 10px 0 9px;margin-bottom:6px;border-radius:16px;background:var(--surface-2);font-size:15px}.mv b{font-weight:700}
.mv.inc{background:var(--strip-danger);color:var(--on-strip);border:2.5px solid var(--c-ink);box-shadow:0 3px 0 var(--c-ink)}.mv.inc .cd{background:var(--c-cream);color:var(--c-ink)}.mv .sub{display:block;font-size:12.5px;margin-top:2px}.mv.inc .sub{opacity:.9}.mv:not(.inc) .sub{color:var(--on-surface-muted)}
.mv .tw{display:flex;flex-direction:column;line-height:1.15;min-width:0}.mv .cd{margin-left:auto}
body.d .acols{display:grid;grid-template-columns:1fr 380px;gap:26px;margin-top:8px;flex:1;min-height:0}
body.d .ur{height:52px;margin-bottom:5px}body.d .r{height:52px}
.ab{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
.sech{display:flex;align-items:center;justify-content:space-between;margin:12px 4px 6px;gap:8px}
body.p .sech .btn{min-height:38px;padding:0 11px 3px;font-size:13px;border-radius:11px}body.p .sech .btn.g{font-size:14px}
`;
const sg = (l, on, n) => `<span class="sg${on ? ' on' : ''}">${l}${n ? `<i>${n}</i>` : ''}</span>`;
const sheetHead = (icon, title, extra = '', segs = '') => `<div class="sh"><span class="tkb">${ic(icon, 36)}</span><h1>${title}</h1><span class="sp"></span>${extra}${segs ? `<div class="seg">${segs}</div>` : ''}</div>`;
const aRepRows = (phone) => REP.map((r, i) => `${r.g ? `<div class="up l">${r.g}</div>` : ''}<div class="r${i === 0 && !phone ? ' sel' : ''}">${tkEl(r, 36)}<span class="dot"></span><span class="nm">${verb(r)}</span><span class="xy">(${r.xy})</span><span class="tm">${r.t}</span>${tagEl(r)}${chev(14)}</div>`).join('');
const aUnits = () => UNITS.map(([u, n, c, away, tr]) => `<div class="ur${c === 0 ? ' lk' : ''}">${pt(u, 38)}<b>${n}</b>${away ? '<span class="tag mut">4 away</span>' : ''}${tr ? '<span class="tag tl">+5 training</span>' : ''}<span class="ct">${c === 0 ? 'Locked' : c}</span></div>`).join('');
write('a-reports-1440', 'd', `<div class="art"></div>${hdrD()}<div class="sheet">${sheetHead('reports', 'Reports', '', sg('All', true, 20) + sg('Defence') + sg('Raids'))}<div class="cols"><div>${aRepRows(false)}</div><div>${detail(true)}</div></div></div>${dock(TABS, 'reports')}`, `${artD}${A_CSS}`);
write('a-army-1440', 'd', `<div class="art"></div>${hdrD()}<div class="sheet">${sheetHead('army', 'Army', `<span class="pop" style="margin-right:6px">${ic('pop', 22)}300 / 311</span>`, sg('All', true) + sg('Troops') + sg('Moves', false, 2) + sg('Training'))}<div class="acols"><div>${aUnits()}</div><div><div class="up l" style="margin-top:0">Moving</div>${aMovesHtml('mv')}<div class="up l">Training</div>${aTrainHtml('mv')}<div class="ab"><span class="btn g">Send troops</span><span class="btn">Train</span><span class="btn">Simulator</span></div></div></div></div>${dock(TABS, 'army')}`, `${artD}${A_CSS}`);
write('a-reports-360', 'p', `<div class="art"></div>${hdrP()}<div class="sheet">${sheetHead('reports', 'Reports', `<span class="tag mut" style="height:30px;font-size:14px">20 new</span>`)}<div class="seg">${sg('All', true) + sg('Defence') + sg('Raids')}</div>${aRepRows(true)}</div>${dock(P5, 'reports')}`, `${phoneArt(60)}${A_CSS}`);
write('a-army-360', 'p', `<div class="art"></div>${hdrP()}<div class="sheet">${sheetHead('army', 'Army', `<span class="btn sm">Simulator</span>`)}<div class="seg">${sg('All', true) + sg('Troops') + sg('Moves', false, 2) + sg('Training')}</div><div style="margin-top:10px">${aMovesHtml('mv')}${aTrainHtml('mv')}</div><div class="sech"><span class="up">Troops · 300/311</span><span style="display:flex;gap:6px"><span class="btn g sm">Send troops</span><span class="btn sm">Train</span></span></div>${aUnits()}</div>${dock(P5, 'army')}`, `${phoneArt(60)}${A_CSS}`);

/* =============== B · Clean list =============== */
const B_CSS = `
.pg{position:absolute;z-index:2}
.ttl{display:flex;align-items:center;gap:12px}.ttl h1{font:400 38px/1 var(--font-display);color:var(--heading);padding-top:3px}.ttl .sp{flex:1}
.chips{display:flex;gap:8px}.cp{display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 16px 2px;border-radius:99px;background:var(--surface-3);font:700 14.5px/1 var(--font);color:var(--on-surface)}.cp.on{background:var(--dark);color:var(--on-dark)}
.card{background:var(--surface);border:2.5px solid var(--c-ink);border-radius:22px;box-shadow:0 4px 0 var(--c-ink);padding:6px 18px 8px}
.card>.up{display:flex;align-items:center;justify-content:space-between;padding:16px 2px 8px}
.card .hd{display:flex;align-items:center;justify-content:space-between;padding:12px 0 6px}.card .hd h2{font:400 22px/1 var(--font-display);color:var(--heading);padding-top:3px}
.li{display:flex;align-items:center;gap:12px;min-height:56px;border-top:1px solid var(--edge-soft);font-size:16px;white-space:nowrap}.up+.li{border-top:0}.li .nm{font-weight:700}.li .tm{margin-left:auto;color:var(--on-surface-muted);font-size:14.5px}.li>svg{color:var(--on-surface-muted)}
.li.sel{background:var(--surface-2);margin:0 -18px;padding:0 18px;border-top-color:transparent}
.li .dot{margin-right:-2px}.li .xy{color:var(--on-surface-muted);font-size:14px}
${detailCss}
.card.dc{padding:22px 24px 22px}.card.dc .st{background:transparent;padding:14px 0 0;border-top:1px solid var(--edge-soft);border-radius:0}.card.dc .sts{gap:20px;margin-top:2px}
.card.dc .wl{padding-top:14px;border-top:1px solid var(--edge-soft)}
.mvb{display:flex;align-items:center;gap:12px;min-height:60px;border-top:1px solid var(--edge-soft);font-size:15.5px}.hd+.mvb{border-top:0}.mvb b{font-weight:700}.mvb .sub{display:block;font-size:13px;color:var(--on-surface-muted);margin-top:3px}.mvb .tw{display:flex;flex-direction:column;min-width:0}.mvb .cd{margin-left:auto}
.mvb.inc .tk{background:var(--strip-danger)}.mvb.inc .sub{color:var(--strip-danger);font-weight:600}
.uli{display:flex;align-items:center;gap:14px;min-height:54px;border-top:1px solid var(--edge-soft);font-size:16.5px;white-space:nowrap}.hd+.uli{border-top:0}.uli b{font-weight:700}.uli .ct{font:400 28px/1 var(--font-display);color:var(--heading);padding-top:3px;text-align:right}.uli small{font-size:13.5px;color:var(--on-surface-muted);font-weight:500}.uli.lk{opacity:.5}
.acts{display:flex;gap:10px}
body.d .pg{left:50%;transform:translateX(-50%);top:138px;bottom:124px;width:1180px}
body.d .cols2{display:grid;grid-template-columns:560px 1fr;gap:20px;margin-top:12px;align-items:start}
body.p .pg{left:0;right:0;top:122px;bottom:0;padding:0 12px;overflow:hidden}
body.p .ttl h1{font-size:30px}body.p .chips{margin:10px 0 10px}body.p .cp{flex:1;justify-content:center;padding:0 6px 2px}
body.p .card{padding:4px 14px 6px;margin-bottom:12px}body.p .li{gap:8px;min-height:56px;font-size:15px}body.p .li .tk{width:34px!important;height:34px!important}body.p .li .tag{padding:0 9px 1px;font-size:12.5px}body.p .li .xy{display:none}
body.p .acts .btn{flex:1;padding:0 6px 3px;font-size:13.5px}body.p .acts{margin-top:12px;margin-bottom:12px}
`;
const bRepRows = (phone) => REP.map((r, i) => `${r.g ? `<div class="up">${r.g}</div>` : ''}<div class="li${i === 0 && !phone ? ' sel' : ''}">${tkEl(r, 36)}<span class="dot"></span><span class="nm">${verb(r)}</span><span class="xy">(${r.xy})</span><span class="tm">${r.t}</span>${tagEl(r)}${chev(14)}</div>`).join('');
const bUnits = () => UNITS.map(([u, n, c, away]) => `<div class="uli${c === 0 ? ' lk' : ''}">${pt(u, 44)}<b>${n}</b><span style="margin-left:auto;display:flex;align-items:baseline;gap:10px">${away ? '<small>4 away</small>' : ''}<span class="ct">${c === 0 ? '<span class="mut" style="font:600 17px var(--font)">Locked</span>' : c}</span></span></div>`).join('');
const bTitle = (i, t, extra = '') => `<div class="ttl"><span class="tk w" style="width:44px;height:44px">${ic(i, 28)}</span><h1>${t}</h1><span class="sp"></span>${extra}</div>`;
const bChips = `<div class="chips"><span class="cp on">All</span><span class="cp">Defence</span><span class="cp">Raids</span></div>`;
write('b-reports-1440', 'd', `${hdrD()}<div class="pg">${bTitle('reports', 'Reports', bChips)}<div class="cols2"><div class="card">${bRepRows(false)}</div><div class="card dc">${detail(true)}</div></div></div>${dock(TABS, 'reports')}`, B_CSS);
write('b-army-1440', 'd', `${hdrD()}<div class="pg">${bTitle('army', 'Army', `<span class="pop" style="margin-right:6px">${ic('pop', 22)}300 / 311</span><div class="acts"><span class="btn sm">Simulator</span><span class="btn sm">Train</span><span class="btn g sm">Send troops</span></div>`)}<div class="cols2"><div class="card"><div class="hd"><h2>Troops</h2></div>${bUnits()}</div><div><div class="card"><div class="hd"><h2>Movements</h2><span class="tag mut">2</span></div>${aMovesHtml('mvb')}</div><div class="card" style="margin-top:20px"><div class="hd"><h2>Training</h2></div>${aTrainHtml('mvb')}</div></div></div></div>${dock(TABS, 'army')}`, B_CSS);
write('b-reports-360', 'p', `${hdrP()}<div class="pg">${bTitle('reports', 'Reports')}<div class="chips">${['All', 'Defence', 'Raids'].map((c, i) => `<span class="cp${i ? '' : ' on'}">${c}</span>`).join('')}</div><div class="card">${bRepRows(true)}</div></div>${dock(P5, 'reports')}`, B_CSS);
write('b-army-360', 'p', `${hdrP()}<div class="pg">${bTitle('army', 'Army', `<span class="pop">${ic('pop', 20)}300 / 311</span>`)}<div class="acts" style="margin-top:12px"><span class="btn g">Send troops</span><span class="btn">Train</span><span class="btn">Simulator</span></div><div class="card"><div class="hd"><h2>Movements</h2><span class="tag mut">2</span></div>${aMovesHtml('mvb')}</div><div class="card"><div class="hd"><h2>Troops</h2></div><div class="up" style="padding:4px 2px 2px">In training</div>${aTrainHtml('mvb')}<div class="up" style="padding:12px 2px 2px">At home</div>${bUnits()}</div></div>${dock(P5, 'army')}`, B_CSS);

/* =============== C · Game tiles =============== */
const C_CSS = `
.pg{position:absolute;z-index:2}
.ttl{display:flex;align-items:center;gap:12px}.ttl h1{font:400 38px/1 var(--font-display);color:var(--heading);padding-top:3px}.ttl .sp{flex:1}
.cp{display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 16px 2px;border-radius:99px;background:var(--surface-3);font:700 14.5px/1 var(--font);color:var(--on-surface)}.cp.on{background:var(--dark);color:var(--on-dark)}.chips{display:flex;gap:8px}
.up.l{margin:16px 4px 8px}
.tg{display:grid;gap:16px}
.t{position:relative;display:flex;flex-direction:column;border:3px solid var(--c-ink);border-radius:22px;background:var(--surface);box-shadow:0 5px 0 var(--c-ink);overflow:hidden}
.ob{display:flex;align-items:center;gap:10px;padding:0 14px 2px;border-bottom:3px solid var(--c-ink)}.ob b{font:400 30px/1 var(--font-display);padding-top:3px}.ob .tk{box-shadow:none;background:var(--c-cream)}
.ob.won{background:var(--c-leaf);color:var(--c-ink)}.ob.lost{background:var(--strip-danger);color:var(--on-strip)}.ob.loot{background:var(--c-sun);color:var(--c-ink)}
.tb{padding:10px 14px 12px;display:flex;flex-direction:column;gap:4px}.tb .nm{font-size:18px;font-weight:700;white-space:nowrap}.tb .tm{display:flex;align-items:center;justify-content:space-between;font-size:14px;color:var(--on-surface-muted);font-weight:500}
.tb .nm{display:flex;align-items:center;gap:8px}.tb .dot{width:12px;height:12px}.ob .ex{margin-left:auto;font:700 15px var(--font)}body.p .ob .ex{display:none}
.ut{padding:12px 14px 12px;gap:6px}.ut .top{display:flex;align-items:center;gap:12px}.ut .ct{margin-left:auto;font:400 40px/1 var(--font-display);color:var(--heading);padding-top:4px;text-align:right}.ut .ct small{display:block;white-space:nowrap;font:600 12px/1 var(--font);color:var(--on-surface-muted);margin-top:4px}.ut .nm{font-size:17px;font-weight:700}.ut .bd2{display:flex;gap:6px;flex-wrap:wrap}.ut .bd2:empty{display:none}
.ut.lk{background:var(--surface-3);box-shadow:0 5px 0 var(--edge)}.ut.lk .pt,.ut.lk .nm{opacity:.45;filter:grayscale(1)}.ut.lk .ct{color:var(--on-surface-muted);opacity:.8;font-size:24px}
.mvc{position:relative;border:3px solid var(--c-ink);border-radius:22px;background:var(--surface);box-shadow:0 5px 0 var(--c-ink);padding:0 16px 3px 12px;flex:none}
.mvc{display:grid;grid-template-columns:44px 1fr auto;grid-template-areas:'i t b' 'i s b';column-gap:12px;row-gap:3px;align-items:center}.mvc>.tk,.mvc>.pt{grid-area:i}.mvc .ti{grid-area:t;align-self:end;font-size:16.5px;font-weight:700;white-space:nowrap}.mvc .su{grid-area:s;align-self:start;font-size:13px;color:var(--on-surface-muted);white-space:nowrap}.mvc .big{grid-area:b;font:400 28px/1 var(--font-display);padding-top:3px;white-space:nowrap}
.mvc.inc{background:var(--strip-danger);color:var(--on-strip)}.mvc.inc .su{color:var(--on-strip);opacity:.92}.mvc.inc .tk{background:var(--c-cream)}
body.d .pg{left:50%;transform:translateX(-50%);top:138px;bottom:124px;width:1180px}
body.d .tg.rep{grid-template-columns:repeat(4,1fr)}body.d .ob{height:76px}body.d .ob b{font-size:36px}body.d .tg.rep{gap:18px}body.d .tb .nm{font-size:20px}body.d .tb{padding:12px 16px 14px}
body.d .strip{display:grid;grid-template-columns:1.05fr 1fr .9fr;gap:20px;margin-top:14px}body.d .mvc{height:88px}
body.d .tg.un{grid-template-columns:repeat(5,1fr);gap:14px}
body.p .pg{left:0;right:0;top:122px;bottom:0;padding:0 12px;overflow:hidden}
body.p .ttl h1{font-size:30px}body.p .tg.rep{grid-template-columns:1fr 1fr;gap:12px}body.p .ob{height:54px;padding:0 10px 2px}body.p .ob b{font-size:26px}body.p .tb{padding:9px 12px 11px}body.p .tb .nm{font-size:16.5px}
body.p .chips{margin:10px 0 0}body.p .cp{flex:1;justify-content:center;padding:0 6px 2px}
body.p .strip{display:flex;gap:10px;margin:12px -12px 0;padding:0 12px 8px;overflow-x:hidden}body.p .mvc{width:236px;height:108px;padding:10px 14px 12px 12px;grid-template-columns:40px 1fr;grid-template-areas:'i t' 'i b' 's s';align-content:center;row-gap:2px}body.p .mvc>.tk,body.p .mvc>.pt{width:40px;height:40px}body.p .mvc .big{font-size:32px;padding-top:2px}body.p .mvc .su{padding-top:4px}
body.p .acts{display:flex;gap:8px;margin-top:6px}body.p .acts .btn{flex:1;padding:0 4px 3px;font-size:13.5px}
body.p .tg.un{grid-template-columns:1fr 1fr;gap:12px}body.p .ut{padding:10px 12px 10px}body.p .ut .ct{font-size:34px}body.p .ut .ct small{font-size:11px}body.p .ut .top{gap:8px}
`;
const cOB = (r, sz) => { const cls = r.k === 'r' ? 'loot' : r.res; const lab = r.k === 'r' ? 'Loot' : r.res === 'won' ? 'Won' : 'Lost'; const i = r.k === 'r' ? 'gold' : r.res === 'won' ? 'shield' : 'warning'; return `<div class="ob ${cls}"><span class="tk" style="width:${sz}px;height:${sz}px">${ic(i, Math.round(sz * 0.62))}</span><b>${lab}</b>${r.k === 'r' ? '<span class="ex">+450</span>' : ''}</div>`; };
const cTile = (r) => `<div class="t">${cOB(r, 36)}<div class="tb"><span class="nm"><i class="dot"></i>${r.k === 'r' ? 'You raided' : r.n}</span><span class="tm"><span>${r.k === 'r' ? 'Abandoned' : 'Attacked you'}</span><span>${r.t}</span></span></div></div>`;
const cTiles = () => { let out = '', open = false; REP.forEach((r) => { if (r.g) { if (open) out += '</div>'; out += `<div class="up l">${r.g}</div><div class="tg rep">`; open = true; } out += cTile(r); }); return out + '</div>'; };
const cMoves = () => `<div class="mvc inc"><span class="tk" style="width:44px;height:44px">${ic('warning', 28)}</span><b class="ti">Incoming attack</b><span class="su">Brannoch (10|7) · size unknown</span><span class="big">2m 25s</span></div>
<div class="mvc"><span class="tk r" style="width:44px;height:44px">${ic('army', 28)}</span><b class="ti">Raid returning</b><span class="su">${lootRow}</span><span class="big">12m</span></div>
<div class="mvc">${pt('raider', 44)}<b class="ti">Training 5 Raiders</b><span class="su">next in 3m 10s</span><span class="big">3m 10s</span></div>`;
const cUnits = (px) => UNITS.map(([u, n, c, away, tr]) => `<div class="t ut${c === 0 ? ' lk' : ''}"><div class="top">${fig(u, px)}<span class="ct">${c === 0 ? 'Locked' : c}${c ? '<small>at home</small>' : ''}</span></div><span class="nm">${n}</span><div class="bd2">${away ? '<span class="tag mut">4 away</span>' : ''}${tr ? '<span class="tag tl">+5 training</span>' : ''}</div></div>`).join('');
const cBtns = `<span class="btn sm">Simulator</span><span class="btn sm">Train</span><span class="btn g sm">Send troops</span>`;
const cTitle = (i, t, extra = '') => `<div class="ttl"><span class="tk w" style="width:44px;height:44px">${ic(i, 28)}</span><h1>${t}</h1><span class="sp"></span>${extra}</div>`;
write('c-reports-1440', 'd', `${hdrD()}<div class="pg">${cTitle('reports', 'Reports', '<div class="chips"><span class="cp on">All 20</span><span class="cp">Defence</span><span class="cp">Raids</span></div>')}${cTiles()}</div>${dock(TABS, 'reports')}`, C_CSS);
write('c-army-1440', 'd', `${hdrD()}<div class="pg">${cTitle('army', 'Army', `<span class="pop" style="margin-right:6px">${ic('pop', 22)}300 / 311</span><span style="display:flex;gap:10px">${cBtns}</span>`)}<div class="strip">${cMoves()}</div><div class="up l" style="margin-top:14px">Troops</div><div class="tg un">${cUnits(100)}</div></div>${dock(TABS, 'army')}`, C_CSS);
write('c-reports-360', 'p', `${hdrP()}<div class="pg">${cTitle('reports', 'Reports')}<div class="chips">${['All 20', 'Defence', 'Raids'].map((c, i) => `<span class="cp${i ? '' : ' on'}">${c}</span>`).join('')}</div>${cTiles()}</div>${dock(P5, 'reports')}`, C_CSS);
write('c-army-360', 'p', `${hdrP()}<div class="pg">${cTitle('army', 'Army', `<span class="pop">${ic('pop', 20)}300 / 311</span>`)}<div class="strip">${cMoves()}</div><div class="acts">${cBtns}</div><div class="tg un" style="margin-top:14px">${cUnits(80)}</div></div>${dock(P5, 'army')}`, C_CSS);
console.log('ok', Object.keys(ICONS).length);
