// Generates mockups/{a,b,c}-{village,notif}-{1440,360}.html from the real Icon.tsx markup (tooling/icons.html, made by dump-icons.tsx).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const OUT = join(here, '..', 'mockups');
const raw = readFileSync(join(here, 'icons.html'), 'utf8'); const ICONS = {};
for (const m of raw.matchAll(/<div data-n="(\w+)">(<svg[\s\S]*?<\/svg>)<\/div>/g)) ICONS[m[1]] = m[2];
const ic = (n, s = 24, cls = '') => ICONS[n].replace('width="64" height="64"', `width="${s}" height="${s}"`).replace('class="icon"', `class="icon ${cls}"`);
const chev = (s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>`;
const av = (s = 46) => `<span class="ring" style="width:${s}px;height:${s}px"><img src="avatar.svg" width="${s}" height="${s}" alt=""></span>`;

const RES = [['wood', '48.2k', '+1,025/h'], ['food', '31.4k', '+1,875/h'], ['iron', '22.8k', '+875/h'], ['gold', '15.7k', '+350/h']];
const TABS = [['village', 'Village'], ['map', 'Map'], ['army', 'Army'], ['reports', 'Reports'], ['mail', 'Mail'], ['tribe', 'Tribe'], ['ranks', 'Ranks']];
const EARLIER = [['Tolvek', '-4|21', '4h'], ['Ironhart', '-13|7', '8h'], ['Ysolde_K', '29|27', '12h'], ['Brannoch', '10|7', '16h'], ['Tolvek', '-4|21', '20h'], ['Ironhart', '-13|7', '1d'], ['Ysolde_K', '29|27', '1d'], ['Brannoch', '10|7', '1d'], ['Tolvek', '-4|21', '2d'], ['Ironhart', '-13|7', '2d'], ['Ysolde_K', '29|27', '2d']];

const res = (rates = true, pop = false) => RES.map(([n, a, r]) => `<div class="rs"><i>${ic(n, 28)}</i><div><b>${a}</b>${rates ? `<small>${r}</small>` : ''}</div></div>`).join('') + (pop ? `<div class="rs"><i>${ic('pop', 28)}</i><div><b>277</b><small>of 311</small></div></div>` : '');
const bell = (on, sz = 46) => `<span class="bell${on ? ' on' : ''}" style="width:${sz}px;height:${sz}px">${ic('bell', 26)}<span class="bd red">1</span></span>`;
const row = (go, nm, co, tm) => `<div class="row${go ? ' go' : ''}"><i class="ri">${ic('warning', 22)}</i><span class="nm">${nm}</span><span class="co">(${co})</span><span class="tm">${go ? tm : tm + ' ago'}</span>${chev(15)}</div>`;
const alerts = (n, { title = true, foot = true } = {}) => `<div class="al">${title ? `<div class="al-head"><h2>Alerts</h2><span class="lnk">Mark all read</span></div>` : ''}<div class="lab">On the way</div>${row(true, 'Brannoch', '10|7', '2m 25s')}<div class="lab">Earlier</div>${EARLIER.slice(0, n).map((e) => row(false, ...e)).join('')}${foot ? `<div class="bro">Browser alerts off · <span class="lnk">Turn on</span></div>` : ''}</div>`;
const atk = (txt = 'Attack in 2m 25s · Brannoch') => `<span class="atk">${ic('warning', 24)}<b>${txt}</b>${chev(16)}</span>`;
const prot = () => `<span class="prot">${ic('shield', 22)}Protected 2m</span>`;
const steps = () => `<span class="cg">Steps 5/8 · Claim</span>`;
const mini = () => `<span class="cc sm">${ic('queue', 22)}<b>0/2</b></span><span class="cc sm">${ic('renown', 22)}<b>0/1,000</b></span>`;
const tab = (n, l, on, bd, lab = true) => `<span class="tab${on ? ' on' : ''}">${ic(n, 24)}${lab ? `<span>${l}</span>` : ''}${bd || ''}</span>`;
const bdAtk = '<span class="bd red">1</span>', bdRep = '<span class="bd dk">20</span>';
const brand = `<span class="brand">${ic('flame', 32)}<span>Clanfire</span></span>`;
const namePill = (big = true) => `<span class="np"><b>demo391716's village</b><small>24|24</small></span>`;

const BASE = `
html,body{margin:0}html{overflow:hidden}*,*::before,*::after{box-sizing:border-box}
body{position:relative;overflow:hidden;background:var(--page);color:var(--on-surface);font:15px/1.3 var(--font);-webkit-font-smoothing:antialiased}
body.d{width:1440px;height:900px}body.p{width:360px;height:780px}
svg{display:block;flex:none}img{display:block}h2{margin:0}
.art{position:absolute;background-image:url(scene.png);background-repeat:no-repeat}
.ring{display:block;flex:none;border-radius:50%;border:2.5px solid var(--c-ink);background:var(--c-sun);overflow:hidden}.ring img{width:100%;height:100%}
.bell{position:relative;flex:none;display:grid;place-items:center;border-radius:50%;border:2.5px solid var(--c-ink);background:var(--surface);box-shadow:0 3px 0 var(--c-ink)}.bell.on{background:var(--c-sun)}
.bd{position:absolute;top:-6px;right:-6px;min-width:21px;height:21px;padding:0 5px 1px;border-radius:99px;border:2px solid var(--c-ink);display:grid;place-items:center;font:700 12px/1 var(--font)}
.bd.red{background:var(--strip-danger);color:var(--on-strip)}.bd.dk{background:var(--dark);color:var(--on-dark)}
.rs{display:flex;align-items:center;gap:6px;white-space:nowrap}.rs b{display:block;font:700 15px/1.05 var(--font);color:var(--heading)}.rs small{display:block;font:500 11px/1.2 var(--font);color:var(--on-surface-muted);margin-top:1px}
.brand{display:inline-flex;align-items:center;gap:7px;font:400 27px/1 var(--font-display);color:var(--c-ink)}.brand span{padding-bottom:3px}
.tab{position:relative;display:inline-flex;align-items:center;gap:6px;height:46px;padding:0 9px 2px 6px;border:2.5px solid transparent;border-radius:99px;font:700 14.5px/1 var(--font);color:var(--on-bar)}
.tab.on{background:var(--c-sun);border-color:var(--c-ink);box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -4px 0 var(--c-sun-lo)}
.atk{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 12px 2px 10px;border:2.5px solid var(--c-ink);border-radius:99px;background:var(--strip-danger);color:var(--on-strip);font:700 15px/1 var(--font);box-shadow:0 4px 0 var(--c-ink);white-space:nowrap}.atk b{font-weight:700}
.prot{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px 2px 9px;border:2.5px solid var(--c-ink);border-radius:99px;background:var(--c-teal-hi);color:var(--on-fill);font:700 14px/1 var(--font);box-shadow:0 3px 0 var(--c-ink);white-space:nowrap}
.cc{display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 14px 2px 10px;border:2.5px solid var(--c-ink);border-radius:99px;background:var(--surface);box-shadow:0 3px 0 var(--c-ink);font:700 15px/1 var(--font);white-space:nowrap}.cc.sm{min-height:40px;padding:0 12px 2px 8px;font-size:14px}
.cg{display:inline-flex;align-items:center;min-height:44px;padding:0 16px 3px;border:2.5px solid var(--c-ink);border-radius:99px;background:var(--c-sun);box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -4px 0 var(--c-sun-lo),0 3px 0 var(--c-ink);font:400 17px/1 var(--font-display);color:var(--c-ink);white-space:nowrap}
.np{display:inline-flex;align-items:baseline;gap:9px;min-height:48px;padding:0 18px 3px;align-items:center;border:2.5px solid var(--c-ink);border-radius:99px;background:var(--surface);box-shadow:0 4px 0 var(--c-ink);white-space:nowrap}.np b{font:400 23px/1 var(--font-display);color:var(--heading);padding-top:3px}.np small{font:600 14px/1 var(--font);color:var(--on-surface-muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 18px 3px;border:2.5px solid var(--c-ink);border-radius:14px;background:var(--c-bone);box-shadow:inset 0 2px 0 #fff3dc,inset 0 -4px 0 var(--c-bone-shade);font:700 15px/1 var(--font);color:var(--on-fill)}
.btn.g{background:var(--c-sun);box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -5px 0 var(--c-sun-lo);font:400 17px/1 var(--font-display)}
body.p .line .atk,body.p .pl2 .atk{flex:1;min-width:0;font-size:12.5px;padding:0 8px 2px 7px;gap:5px}body.p .line .atk b,body.p .pl2 .atk b{flex:1}body.p .line .atk svg:last-child,body.p .pl2 .atk svg:last-child{display:none}body.p .line .atk svg:first-child,body.p .pl2 .atk svg:first-child{width:22px;height:22px}body.p .line .prot,body.p .pl2 .prot{font-size:12.5px;padding:0 9px 2px 6px;gap:4px}body.p .line .prot svg,body.p .pl2 .prot svg{width:19px;height:19px}
/* alerts list */
.al h2{font:400 27px/1.1 var(--font-display);color:var(--heading)}.al-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:46px}
.lnk{display:inline-flex;align-items:center;min-height:40px;padding:0 4px;color:var(--link);font:600 14px/1 var(--font)}
.al .lab,.lab{font:700 12px/1 var(--font);letter-spacing:.09em;text-transform:uppercase;color:var(--on-surface-muted);margin:10px 2px 7px}
.row{display:flex;align-items:center;gap:8px;min-height:46px;padding:0 10px 0 10px;margin-bottom:6px;border-radius:14px;background:var(--surface-2);font:15px/1 var(--font);color:var(--on-surface);white-space:nowrap}
.row .ri{display:grid;opacity:.55;filter:grayscale(1)}.row .nm{font-weight:700}.row .co{color:var(--on-surface-muted);font-size:13.5px}.row .tm{margin-left:auto;color:var(--on-surface-muted);font-size:14px}.row svg:last-child{color:var(--on-surface-muted)}
.row.go{background:var(--strip-danger);color:var(--on-strip);border:2.5px solid var(--c-ink);box-shadow:0 3px 0 var(--c-ink);margin-bottom:8px;min-height:50px}.row.go .ri{opacity:1;filter:none}.row.go .co,.row.go .tm,.row.go svg:last-child{color:var(--on-strip)}.row.go .tm{font-weight:700;font-size:16px}
.bro{margin:8px 2px 0;font:13.5px/1 var(--font);color:var(--on-surface-muted);display:flex;align-items:center;gap:4px}
`;
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Rubik:wght@400;500;600;700&display=swap">';
const write = (name, cls, body, css = '') => { const w = cls === 'd' ? 1440 : 360; writeFileSync(join(OUT, name + '.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${w}"><title>${name}</title>${FONTS}<link rel="stylesheet" href="tokens.css"><style>${BASE}${css}</style></head><body class="${cls}">${body}</body></html>`); };
// phone art: scale k, Town Hall (775,520 in scene.png) placed at (cx, cy) of the page
const phoneArt = (cy, k = 1.45) => `.art{inset:0;background-size:${Math.round(1548 * k)}px auto;background-position:${Math.round(180 - 775 * k)}px ${Math.round(cy - 520 * k)}px}`;
const deskArt = (cx, cy, k = 1) => `.art{background-size:${Math.round(1548 * k)}px auto;background-position:${Math.round(cx - 775 * k)}px ${Math.round(cy - 520 * k)}px}`;

/* ---------------- A · Tidy bar ---------------- */
const aBar = (n) => `<div class="abar">${brand}<div class="tabs">${TABS.map(([i, l]) => tab(i, l, i === 'village', i === 'army' ? bdAtk : i === 'reports' ? bdRep : '')).join('')}</div><div class="rg">${res(true, true)}</div>${bell(n)}${av(48)}</div>`;
const A_CSS_D = `.abar{position:absolute;z-index:6;top:0;left:0;right:0;height:72px;background:var(--bar);box-shadow:0 4px 0 var(--bar-deep);display:flex;align-items:center;gap:10px;padding:0 14px}.tabs{display:flex;gap:0;margin-left:2px}
.rg{margin-left:auto;display:flex;gap:13px;padding:6px 14px;border:2.5px solid var(--c-ink);border-radius:20px;background:var(--surface);box-shadow:0 3px 0 var(--bar-deep)}
.art{left:0;right:0;top:76px;bottom:0}${deskArt(720, 440, 1.05)}
.tl{position:absolute;z-index:3;left:16px;top:92px;display:flex;align-items:center;gap:12px}.bl{position:absolute;z-index:3;left:16px;bottom:16px}.br{position:absolute;z-index:3;right:16px;bottom:16px;display:flex;gap:10px}
.drawer{position:absolute;z-index:5;top:76px;right:0;bottom:0;width:390px;padding:12px 18px 18px;background:var(--surface);border-left:2.5px solid var(--c-ink);border-radius:26px 0 0 26px;box-shadow:-8px 0 24px rgba(43,33,28,.22)}`;
const aD = (n) => `<div class="art"></div>${aBar(n)}<div class="tl">${namePill()}${atk()}${prot()}</div><div class="bl">${steps()}</div>${n ? '' : `<div class="br">${mini()}</div>`}${n ? `<div class="drawer">${alerts(9)}</div>` : ''}`;
write('a-village-1440', 'd', aD(false), A_CSS_D); write('a-notif-1440', 'd', aD(true), A_CSS_D);

const pStrip = (n) => `<div class="pstrip"><div class="rg2">${res(true)}</div>${bell(n, 44)}</div>`;
const pNav = (extra = '') => `<div class="pnav">${[['village', 'Village'], ['map', 'Map'], ['army', 'Army'], ['reports', 'Reports'], ['more', 'More']].map(([i, l]) => `<span class="nt${i === 'village' ? ' on' : ''}">${i === 'more' ? av(28) : ic(i, 28)}<span>${l}</span>${i === 'army' ? bdAtk : i === 'reports' ? bdRep : ''}</span>`).join('')}</div>`;
const NAVCSS = `.pnav{position:absolute;z-index:6;left:0;right:0;bottom:0;height:72px;background:var(--bar);box-shadow:0 -4px 0 var(--bar-deep);display:flex;justify-content:space-around;align-items:center;padding:0 4px}
.nt{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:66px;height:60px;border:2.5px solid transparent;border-radius:18px;font:700 12px/1 var(--font);color:var(--on-bar)}.nt.on{background:var(--c-sun);border-color:var(--c-ink);box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -4px 0 var(--c-sun-lo)}.nt .bd{top:-5px;right:-1px;min-width:19px;height:19px;font-size:11px}`;
const A_CSS_P = `${phoneArt(380)}.line .atk svg:first-child{width:22px;height:22px}.pstrip{position:absolute;z-index:6;top:0;left:0;right:0;height:62px;background:var(--bar);box-shadow:0 4px 0 var(--bar-deep);display:flex;align-items:center;justify-content:space-between;padding:0 6px 0 8px}.rg2{display:flex;gap:6px}.rs i{display:block}
.rg2 .rs{gap:2px}.rg2 .rs svg{width:24px;height:24px}.rg2 .rs b{font-size:13.5px}.rg2 .rs small{font-size:10px;letter-spacing:-.1px}
.line{position:absolute;z-index:3;left:8px;right:8px;top:76px;display:flex;gap:6px;align-items:center}.line .atk{flex:1;min-width:0;font-size:13px;padding:0 10px 2px 8px;gap:6px}.line .atk b{flex:1}.line .atk svg:last-child,.pl2 .atk svg:last-child{display:none}.line .prot,.pl2 .prot{font-size:13px;padding:0 10px 2px 7px;gap:4px}
.pb{position:absolute;z-index:3;left:8px;right:8px;bottom:84px;display:flex;gap:6px;align-items:center}.pb .cg{font-size:15px;padding:0 12px 3px;min-height:42px}.pb .cc.sm{padding:0 9px 2px 6px;gap:4px;font-size:13px}
.sheet{position:absolute;z-index:5;top:66px;left:0;right:0;padding:10px 12px 12px;background:var(--surface);border:2.5px solid var(--c-ink);border-top:0;border-radius:0 0 26px 26px;box-shadow:0 6px 0 var(--c-ink),0 14px 24px rgba(43,33,28,.22)}${NAVCSS}`;
const pLine = `<div class="line">${atk('Attack 2m 25s · Brannoch')}${prot().replace('Protected 2m', 'Protected 2m')}</div>`;
write('a-village-360', 'p', `<div class="art"></div>${pStrip(false)}${pLine}<div class="pb">${steps().replace('Steps 5/8 · Claim', 'Steps 5/8 · Claim')}<span style="flex:1"></span>${mini()}</div>${pNav()}`, A_CSS_P);
write('a-notif-360', 'p', `<div class="art"></div>${pStrip(true)}${pLine.replace('class="line"', 'class="line" style="top:auto;bottom:84px;display:none"')}<div class="pb">${steps()}<span style="flex:1"></span>${mini()}</div><div class="sheet">${alerts(6, { title: true })}</div>${pNav()}`, A_CSS_P);

/* ---------------- B · Game HUD ---------------- */
const dock = (items, active = 'village') => `<div class="dock">${items.map(([i, l]) => `<span class="db${i === active ? ' on' : ''}">${i === 'more' ? av(28) : ic(i, 30)}<span>${l}</span>${i === 'army' ? bdAtk : i === 'reports' ? bdRep : ''}</span>`).join('')}</div>`;
const B_CSS_D = `.art{inset:0;background-size:cover;background-position:50% 52%}
.fl{position:absolute;z-index:4}.tlb{left:16px;top:16px;display:flex;align-items:center;gap:10px}.tlb .brandp{display:inline-flex;align-items:center;gap:10px;min-height:56px;padding:0 20px 2px 12px;border:3px solid var(--c-ink);border-radius:99px;background:var(--surface);box-shadow:0 5px 0 var(--c-ink)}
.brandp b{font:400 23px/1 var(--font-display);padding-top:3px}.brandp small{font:600 14px/1 var(--font);color:var(--on-surface-muted)}
.rpill{left:50%;top:16px;transform:translateX(-50%);display:flex;gap:18px;padding:7px 22px;border:3px solid var(--c-ink);border-radius:99px;background:var(--surface);box-shadow:0 5px 0 var(--c-ink)}
.trb{right:16px;top:16px;display:flex;gap:10px;align-items:center}.trb .bell{box-shadow:0 5px 0 var(--c-ink);border-width:3px}.trb .ring{box-shadow:0 5px 0 var(--c-ink);border-width:3px}
.acard{left:50%;top:92px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;width:380px;padding:10px 12px 12px 14px;border:3px solid var(--c-ink);border-radius:24px;background:var(--strip-danger);color:var(--on-strip);box-shadow:0 5px 0 var(--c-ink)}.acard .t{display:block;font:400 22px/1.05 var(--font-display)}.acard .s{display:block;font:500 14px/1.2 var(--font);margin-top:3px}.acard .btn{margin-left:auto}
.pc{left:50%;top:180px;transform:translateX(-50%)}
.dock{position:absolute;z-index:4;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:6px;padding:8px;border:3px solid var(--c-ink);border-radius:30px;background:var(--surface);box-shadow:0 5px 0 var(--c-ink)}
.db{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;width:78px;height:70px;border:2.5px solid transparent;border-radius:20px;font:700 13px/1 var(--font)}.db.on{background:var(--c-sun);border-color:var(--c-ink);box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -5px 0 var(--c-sun-lo)}.db .bd{top:-6px;right:-2px}
.bls{left:16px;bottom:24px}.brs{right:16px;bottom:24px;display:flex;gap:10px}
.nsheet{position:absolute;z-index:5;top:96px;right:16px;bottom:16px;width:380px;padding:12px 18px 18px;background:var(--surface);border:3px solid var(--c-ink);border-radius:28px;box-shadow:0 6px 0 var(--c-ink),0 14px 28px rgba(43,33,28,.25)}`;
const D7 = TABS;
const bD = (n) => `<div class="art"></div><div class="fl tlb"><span class="brandp">${ic('flame', 34)}<b>demo391716's village</b><small>24|24</small></span></div><div class="fl rpill">${res(true, true)}</div><div class="fl trb">${bell(n, 50)}${av(50)}</div>
<div class="fl acard">${ic('warning', 34)}<div><span class="t">Attack in 2m 25s</span><span class="s">Brannoch (10|7)</span></div><span class="btn g">Show</span></div><div class="fl pc">${prot()}</div>${dock(D7)}${n ? `<div class="nsheet">${alerts(9)}</div>` : `<div class="fl bls">${steps()}</div><div class="fl brs">${mini()}</div>`}`;
write('b-village-1440', 'd', bD(false), B_CSS_D); write('b-notif-1440', 'd', bD(true), B_CSS_D);

const chip4 = RES.map(([n, a]) => `<span class="ch">${ic(n, 22)}<b>${a}</b></span>`).join('');
const P5 = [['village', 'Village'], ['map', 'Map'], ['army', 'Army'], ['reports', 'Reports'], ['more', 'More']];
const B_CSS_P = `${phoneArt(400)}.ptop{position:absolute;z-index:4;top:8px;left:8px;right:8px;display:flex;align-items:center;gap:3px}.ch{display:flex;align-items:center;gap:2px;height:44px;flex:1 1 0;min-width:0;padding:0 2px 1px 3px;justify-content:center;border:2.5px solid var(--c-ink);border-radius:99px;background:var(--surface);box-shadow:0 3px 0 var(--c-ink);font:700 12.5px/1 var(--font)}.ch svg{width:21px;height:21px}.ptop .bell{margin-left:4px}.ptop .bell .bd{right:-4px}
.pl2{position:absolute;z-index:4;top:64px;left:8px;right:8px;display:flex;gap:6px;align-items:center}.pl2 .atk{flex:1;min-width:0;font-size:13px;padding:0 10px 2px 8px;gap:6px}.pl2 .atk b{flex:1}.pl2 .atk svg:first-child{width:22px;height:22px}
.dock{position:absolute;z-index:6;left:8px;right:8px;bottom:10px;display:flex;justify-content:space-between;padding:6px 8px;border:3px solid var(--c-ink);border-radius:26px;background:var(--surface);box-shadow:0 4px 0 var(--c-ink)}
.db{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:58px;height:60px;border:2.5px solid transparent;border-radius:18px;font:700 11.5px/1 var(--font)}.db.on{background:var(--c-sun);border-color:var(--c-ink);box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -4px 0 var(--c-sun-lo)}.db .bd{top:-6px;right:-3px;min-width:19px;height:19px;font-size:11px}
.pbb{position:absolute;z-index:4;left:8px;right:8px;bottom:96px;display:flex;gap:6px}.pbb .cg{font-size:15px;min-height:42px;padding:0 12px 3px}.pbb .cc.sm{padding:0 9px 2px 6px;gap:4px;font-size:13px}
.bsheet{position:absolute;z-index:5;left:0;right:0;bottom:0;height:552px;padding:8px 12px 12px;background:var(--surface);border:3px solid var(--c-ink);border-bottom:0;border-radius:30px 30px 0 0;box-shadow:0 -6px 24px rgba(43,33,28,.25)}.grab{width:48px;height:6px;margin:0 auto 4px;border-radius:99px;background:var(--edge)}`;
const bP = (n) => `<div class="art"></div><div class="ptop">${chip4}${bell(n, 44)}</div><div class="pl2">${atk('Attack 2m 25s · Brannoch')}${prot()}</div>${n ? `<div class="bsheet"><div class="grab"></div>${alerts(6)}</div>` : `<div class="pbb">${steps()}<span style="flex:1"></span>${mini()}</div>${dock(P5)}`}`;
write('b-village-360', 'p', bP(false), B_CSS_P); write('b-notif-360', 'p', bP(true), B_CSS_P);

/* ---------------- C · Side rail + Now panel ---------------- */
const rail = `<div class="rail">${ic('flame', 38)}<div class="rt">${TABS.map(([i, l]) => `<span class="rtab${i === 'village' ? ' on' : ''}">${ic(i, 28)}<span>${l}</span>${i === 'army' ? bdAtk : i === 'reports' ? bdRep : ''}</span>`).join('')}</div>${av(50)}</div>`;
const cTop = (n) => `<div class="ctop"><span class="np2"><b>demo391716's village</b><small>24|24</small></span>${prot()}<div class="rg">${res(true, true)}</div>${bell(n, 44)}</div>`;
const nowCards = `<div class="card atkc"><div class="ch1"><span class="tagr">Attack coming</span><span class="lnk" style="min-height:28px"></span></div><div class="who">Brannoch <span>(10|7)</span></div><div class="big">2m 25s</div><span class="btn g wide">Show</span></div>
<div class="card"><div class="ch1"><b class="ct">Building</b><span class="tagn">0/2</span></div><div class="mut">Idle · 2 free slots</div></div>
<div class="card"><div class="ch1"><b class="ct">First steps</b><span class="tagn">5/8</span></div><div class="prog"><i style="width:62%"></i></div><span class="btn g wide">Claim (5)</span></div>
<div class="card"><div class="ch1"><b class="ct">Alerts</b><span class="lnk">All alerts ${chev(14)}</span></div>${EARLIER.slice(0, 3).map((e) => row(false, ...e)).join('')}</div>`;
const C_CSS_D = `.rail{position:absolute;z-index:6;left:0;top:0;bottom:0;width:88px;background:var(--bar);box-shadow:4px 0 0 var(--bar-deep);display:flex;flex-direction:column;align-items:center;padding:14px 0 14px}.rt{display:flex;flex-direction:column;gap:4px;margin:14px 0 auto}
.rtab{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;width:76px;height:68px;border:2.5px solid transparent;border-radius:20px;font:700 12.5px/1 var(--font);color:var(--on-bar)}.rtab.on{background:var(--c-sun);border-color:var(--c-ink);box-shadow:inset 0 3px 0 var(--c-sun-hi),inset 0 -5px 0 var(--c-sun-lo)}.rtab .bd{top:-3px;right:0}
.ctop{position:absolute;z-index:5;left:88px;right:0;top:0;height:68px;background:var(--bar);box-shadow:0 4px 0 var(--bar-deep);display:flex;align-items:center;gap:14px;padding:0 16px 0 22px}.np2{display:flex;align-items:baseline;gap:10px;white-space:nowrap}.np2 b{font:400 27px/1 var(--font-display)}.np2 small{font:600 15px/1 var(--font);color:var(--on-surface-muted)}
.ctop .rg{margin-left:auto;display:flex;gap:16px;padding:5px 16px;border:2.5px solid var(--c-ink);border-radius:18px;background:var(--surface);box-shadow:0 3px 0 var(--bar-deep)}
.art{left:88px;top:72px;bottom:0;width:1032px}${deskArt(516, 470, 1)}
.col{position:absolute;z-index:3;right:0;top:72px;bottom:0;width:320px;padding:14px 14px 16px;background:var(--page);border-left:2.5px solid var(--edge);display:flex;flex-direction:column;gap:12px}
.card{padding:12px 14px 14px;border:2.5px solid var(--c-ink);border-radius:20px;background:var(--surface);box-shadow:0 4px 0 var(--c-ink)}.card .row:not(.go){background:var(--surface-2)}.ch1{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px;margin-bottom:6px}.ct{font:400 20px/1 var(--font-display);color:var(--heading)}
.tagr{display:inline-flex;align-items:center;height:26px;padding:0 11px 1px;border-radius:99px;background:var(--strip-danger);color:var(--on-strip);font:700 12px/1 var(--font);letter-spacing:.06em;text-transform:uppercase}.tagn{display:inline-flex;align-items:center;height:26px;padding:0 10px 1px;border-radius:99px;background:var(--dark);color:var(--on-dark);font:700 13px/1 var(--font)}
.who{font:700 19px/1.2 var(--font)}.who span{font-weight:500;color:var(--on-surface-muted);font-size:15px}.big{font:400 52px/1.05 var(--font-display);color:var(--danger);margin:2px 0 10px}.btn.wide{display:flex;width:100%}.mut{font:15px/1.3 var(--font);color:var(--on-surface-muted);padding:2px 0 2px}
.prog{height:14px;margin:4px 0 12px;border:2px solid var(--c-ink);border-radius:99px;background:var(--surface-3);overflow:hidden}.prog i{display:block;height:100%;background:var(--c-sun);border-right:2px solid var(--c-ink)}
.cw{position:absolute;z-index:3;left:104px;bottom:16px}.cr{position:absolute;z-index:3;left:104px;bottom:16px;display:flex;gap:10px}
.col.nl{padding-top:12px}.col .al{padding:0 2px}`;
const cD = (n) => `<div class="art"></div>${rail}${cTop(n)}${n ? `<div class="col nl"><div class="card">${alerts(10)}</div></div>` : `<div class="col">${nowCards}</div>`}<div class="cw">${n ? '' : ''}</div><div class="cr">${mini()}</div>`;
write('c-village-1440', 'd', cD(false), C_CSS_D); write('c-notif-1440', 'd', cD(true), C_CSS_D);

const cNowRow = `<div class="nowrow"><div class="nc"><span class="tagr">Attack coming</span><div class="nwho"><b>Brannoch</b> <span>(10|7)</span></div><div class="nbig">2m 25s</div>${chev(18)}</div><div class="nc peek"><span class="tagn">First steps 5/8</span></div></div><div class="dots"><i class="on"></i><i></i><i></i></div>`;
const C_CSS_P = `${phoneArt(500)}.np2{display:flex;align-items:baseline;gap:9px;white-space:nowrap}.np2 b{font:400 27px/1 var(--font-display)}.np2 small{font:600 14px/1 var(--font);color:var(--on-surface-muted)}.tagr{display:inline-flex;align-items:center;height:24px;padding:0 10px 1px;border-radius:99px;background:var(--on-strip);color:var(--danger);font:700 11.5px/1 var(--font);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}.tagn{display:inline-flex;align-items:center;height:24px;padding:0 9px 1px;border-radius:99px;background:var(--dark);color:var(--on-dark);font:700 12px/1 var(--font);white-space:nowrap}.nc.atkc{background:var(--strip-danger);color:var(--on-strip)}.nc.atkc .nwho span,.nc.atkc svg:last-child{color:var(--on-strip)}.nc.atkc .nbig{color:var(--on-strip)}.cbar{position:absolute;z-index:6;top:0;left:0;right:0;height:56px;background:var(--bar);display:flex;align-items:center;justify-content:space-between;padding:0 8px 0 14px}.cbar .np2 b{font-size:21px}
.cres{position:absolute;z-index:6;top:56px;left:0;right:0;height:50px;background:var(--bar);box-shadow:0 4px 0 var(--bar-deep);display:flex;align-items:center;justify-content:space-between;padding:0 8px;border-top:2px solid var(--bar-line)}.cres .rs{gap:2px}.cres .rs svg{width:24px;height:24px}.cres .rs b{font-size:13.5px}.cres .rs small{font-size:10px}
.nowrow{position:absolute;z-index:4;top:114px;left:0;right:0;display:flex;gap:8px;padding:0 8px;overflow:hidden}.nc{flex:none;width:318px;height:84px;display:flex;align-items:center;gap:10px;padding:0 14px;border:2.5px solid var(--c-ink);border-radius:20px;background:var(--surface);box-shadow:0 4px 0 var(--c-ink)}.nc.peek{width:60px;padding:0 8px;overflow:hidden}
.nwho{font:15px/1.2 var(--font);flex:1;white-space:nowrap}.nwho span{color:var(--on-surface-muted)}.nbig{font:400 30px/1 var(--font-display);color:var(--danger);white-space:nowrap;padding-top:2px}.nc svg:last-child{color:var(--on-surface-muted)}.nc .tagr{white-space:nowrap}

.nwhat{display:flex;flex-direction:column}.dots{position:absolute;z-index:4;top:209px;left:0;right:0;display:flex;justify-content:center;gap:6px}.dots i{width:8px;height:8px;border-radius:99px;background:var(--edge);border:1.5px solid var(--c-ink)}.dots i.on{background:var(--c-sun);width:20px}
.cp{position:absolute;z-index:4;left:8px;top:228px}${NAVCSS}
.page{position:absolute;z-index:7;inset:0;background:var(--surface);padding:0 12px}.ph{display:flex;align-items:center;gap:8px;height:60px;margin:0 -12px 6px;padding:0 10px 0 8px;background:var(--bar);box-shadow:0 4px 0 var(--bar-deep)}.ph h2{font:400 26px/1 var(--font-display);padding-top:3px}.ph .lnk{margin-left:auto}.backb{display:grid;place-items:center;width:44px;height:44px;border:2.5px solid var(--c-ink);border-radius:14px;background:var(--c-bone);box-shadow:inset 0 2px 0 #fff3dc,inset 0 -3px 0 var(--c-bone-shade)}`;
const cardP = `<div class="nc atkc"><div style="display:flex;flex-direction:column;gap:6px;flex:1"><span class="tagr" style="display:inline-flex;align-self:flex-start">Attack coming</span><div class="nwho"><b>Brannoch</b> <span>(10|7)</span></div></div><div class="nbig">2m 25s</div>${chev(18)}</div><div class="nc peek"><span class="tagn">Steps 5/8</span></div>`;
const cP = `<div class="art"></div><div class="cbar"><span class="np2"><b>demo391716's village</b><small>24|24</small></span>${bell(false, 44)}</div><div class="cres">${res(true)}</div><div class="nowrow">${cardP}</div><div class="dots"><i class="on"></i><i></i><i></i></div><div class="cp">${prot()}</div>${pNav()}`;
write('c-village-360', 'p', cP, C_CSS_P);
write('c-notif-360', 'p', `<div class="page"><div class="ph"><span class="backb">${ic('back', 24)}</span><h2>Alerts</h2><span class="lnk">Mark all read</span></div>${alerts(11, { title: false })}</div>`, C_CSS_P);
console.log('ok', Object.keys(ICONS).length);
