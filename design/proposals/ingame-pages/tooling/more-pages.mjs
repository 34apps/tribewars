// More in-game pictures in the mix frame (A's top bar + folder tabs), two options each, from owner feedback of 2026-11-09:
//   sim-{a,b}-1440          battle simulator as a see-at-once page with a luck control (views/SimulatorView.tsx, simulator.ts)
//   unitcard-{a,b}-1440     unit info card over the Army page (components/UnitInfo.tsx); a hover card and a click card
//   toast-{a,b}-1440        a toast family (error, warning, success, info) over the Mail page (components/Toasts.tsx)
//   mailto-{a,b}-1440       choosing who to write to, inside the Mail page (views/mail/FrameMail.tsx); B adds Contacts = NEW feature
//   notribe-{a,b}-1440      Tribe page without a tribe (views/TribeView.tsx, tribe/Finder.tsx, tribe/Join.tsx)
//   domination-{a,b}-1440   Domination details (components/DominationBar.tsx, domination.ts, GAME_DESIGN 18.1)
// Called from gen.mjs (after ranks-map.mjs) with the shared helpers. Unit numbers are engine config.ts values; the simulator numbers are
// the REAL engine battle (apps/web/src/simulator.ts `simulate`) for the army below, run at -10, -5, 0, +5 and +10 % luck.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const MOCK = join(here, '..', 'mockups');

export default function morePages(h) {
  const { write, topA, tabRowA, ic, chev, xI, fmt, pt, fig, MIX_CSS, T_CSS, TT_CSS, BB, costEl, UN } = h;
  const page = (name, act, body, css = '') => write(name, 'A', `${topA()}${tabRowA(act)}${body}`, `${MIX_CSS}${T_CSS}${TT_CSS}${X_CSS}${css}`);
  // An existing picture as the base: extra CSS before </head>, extra markup before </body>.
  const over = (base, name, css, body, edit = (s) => s) => {
    let s = edit(readFileSync(join(MOCK, base + '.html'), 'utf8'));
    s = s.replace(`<title>${base}</title>`, `<title>${name}</title>`).replace('</head>', `<style>${X_CSS}${css}</style></head>`).replace('</body>', `${body}</body>`);
    return s;
  };
  const SRCH = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 6 6"/></svg>`;
  const PIN = (s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M9 3h6l-1 6 4 4H6l4-4z" fill="#F2B33D" stroke="#2B211C" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 13v8" stroke="#2B211C" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  const CHK = (s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`;
  // Toast badges in the toy style (ink outline, flat fill, one highlight).
  const TI = {
    error: (s = 30) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#C4623A" stroke="#2B211C" stroke-width="2.4"/><path d="M8 11a9 9 0 0 1 6-5" stroke="#EF9C6E" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M11.5 11.5l9 9M20.5 11.5l-9 9" stroke="#FFF8E8" stroke-width="3.2" stroke-linecap="round"/></svg>`,
    warn: (s = 30) => ic('warning', s),
    ok: (s = 30) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#5E8C3A" stroke="#2B211C" stroke-width="2.4"/><path d="M8 11a9 9 0 0 1 6-5" stroke="#A6C964" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M10 16.5l4 4 8-9" stroke="#FFF8E8" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
    info: (s = 30) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#2F9AA0" stroke="#2B211C" stroke-width="2.4"/><path d="M8 11a9 9 0 0 1 6-5" stroke="#7AD3CD" stroke-width="2.4" stroke-linecap="round" fill="none"/><circle cx="16" cy="10.5" r="2.1" fill="#FFF8E8"/><path d="M16 15v8" stroke="#FFF8E8" stroke-width="3.2" stroke-linecap="round"/></svg>`,
  };
  const AV = { Maerwen: 'seer-maelis', Corwin: 'corwen-the-heir', Ysolde_K: 'hild-ironveil', Brannoch: 'brannoc-one-eye', Ironhart: 'khorza-longmane', Tolvek: 'wren-the-huntress', Saffi: 'saffi-goldhand', Barley: 'barley-tam', Orrin: 'orm-the-elder', Hild: 'hild-ironveil', Khorza: 'khorza-longmane', Wren: 'wren-the-huntress', Pell: 'barley-tam', Maddox: 'orm-the-elder', Marlo: 'corwen-the-heir', Halvard: 'orm-the-elder', Merrow: 'seer-maelis', Dagny: 'saffi-goldhand' };
  const av = (n, s = 36) => `<span class="ring" style="width:${s}px;height:${s}px;background:var(--surface-2)"><img src="chieftains/${AV[n]}.svg" alt=""></span>`;
  const UNM = Object.fromEntries(UN.map((u) => [u.id, u]));

  /* ============================== shared CSS for these pictures ============================== */
  const X_CSS = `
.sw2{display:inline-flex;align-items:center;gap:9px;min-height:36px;font:600 14px/1.2 var(--font);color:var(--on-surface);white-space:nowrap}
.sw2 i{position:relative;width:46px;height:28px;border-radius:99px;background:var(--surface-3);border:2px solid var(--edge);flex:none}
.sw2 i::after{content:'';position:absolute;left:2px;top:2px;width:20px;height:20px;border-radius:50%;background:#fff;border:2px solid var(--edge)}
.sw2.on i{background:var(--c-moss);border-color:var(--c-ink)}.sw2.on i::after{left:20px;border-color:var(--c-ink)}
.chip{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px 1px;border-radius:11px;border:2px solid var(--edge);background:var(--surface);font:700 14px/1.2 var(--font);white-space:nowrap;flex:none}
.chip.on{border-color:var(--c-ink);background:var(--c-sun-hi)}.chip small{font:500 13px/1.2 var(--font);color:var(--on-surface-muted)}
.stp{display:inline-flex;align-items:stretch;border:2px solid var(--c-ink);border-radius:11px;overflow:hidden;background:var(--input-bg);height:38px;flex:none}
.stp span{display:grid;place-items:center;width:36px;font:700 19px/1 var(--font);background:var(--surface-2)}
.stp b{display:grid;place-items:center;min-width:48px;font:700 16px/1.2 var(--font);border-left:2px solid var(--edge);border-right:2px solid var(--edge)}
.xsel{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;height:38px;padding:0 10px 1px 12px;border:2px solid var(--edge);border-radius:10px;background:var(--input-bg);font:600 14px/1.2 var(--font);white-space:nowrap;flex:none}.xsel svg{color:var(--on-surface-muted)}
.new{display:inline-flex;align-items:center;height:22px;padding:0 8px 1px;border-radius:99px;background:var(--c-plum);color:#fff8e8;font:700 13px/1.2 var(--font);letter-spacing:.04em;flex:none}
.xsr{display:flex;align-items:center;gap:9px;height:42px;padding:0 14px;border-radius:12px;border:2px solid var(--edge);background:var(--input-bg);font:500 15px/1.2 var(--font);color:#8a7a68}.xsr svg{color:var(--on-surface-muted)}.xsr.on{border-color:var(--c-ink);box-shadow:0 0 0 3px var(--c-sun-hi);color:var(--on-surface)}
.ph .sub2{font:600 13.5px/1.2 var(--font);color:var(--on-surface-muted);white-space:nowrap}
`;

  /* ============================== 1 · BATTLE SIMULATOR ============================== */
  // The army typed in (a saved group "Big raid"), the defender from a scouting report, Wall 6, 15 Pikemen of support, Raider Might 2.
  const ARMY = { raider: 60, outrider: 12, knight: 6, logram: 4 };
  const DEFV = { pikeman: 48, guard: 30 }; const SUPV = { pikeman: 15 };
  // Real engine results (simulate) per luck: attacker won, attack power, attacker losses, defender losses, support losses, carry.
  const DP = 3700;
  const LUCK = {
    '-10': { won: 0, ap: 3632, al: { raider: 60, outrider: 12, knight: 6, logram: 4 }, dl: { pikeman: 47, guard: 29 }, sl: { pikeman: 15 }, carry: 0 },
    '-5': { won: 1, ap: 3834, al: { raider: 57, outrider: 11, knight: 6, logram: 4 }, dl: { pikeman: 48, guard: 30 }, sl: { pikeman: 15 }, carry: 160 },
    0: { won: 1, ap: 4036, al: { raider: 53, outrider: 11, knight: 5, logram: 4 }, dl: { pikeman: 48, guard: 30 }, sl: { pikeman: 15 }, carry: 320 },
    5: { won: 1, ap: 4238, al: { raider: 49, outrider: 10, knight: 5, logram: 3 }, dl: { pikeman: 48, guard: 30 }, sl: { pikeman: 15 }, carry: 510 },
    10: { won: 1, ap: 4440, al: { raider: 46, outrider: 9, knight: 5, logram: 3 }, dl: { pikeman: 48, guard: 30 }, sl: { pikeman: 15 }, carry: 670 },
  };
  const SENT = 82;
  const left = (L) => SENT - Object.values(L.al).reduce((a, b) => a + b, 0);
  const lt = (k) => (k > 0 ? `+${k}%` : k < 0 ? `−${-k}%` : '0%');
  const lossRows = (sent, lost, cls = '') => Object.entries(sent).map(([u, n]) => { const l = lost[u] || 0; return `<tr class="${cls}"><td><span class="un">${pt(u, 28)}${UNM[u].n}</span></td><td>${n}</td><td class="${l ? 'ls' : 'z'}">${l ? '−' + l : '0'}</td><td><b>${n - l}</b></td></tr>`; }).join('');
  const verdict = (L, k) => L.won
    ? `<div class="vd win">${TI.ok(34)}<span class="mt"><b>Your army wins</b><small>${left(L)} of ${SENT} come home · luck ${lt(k)}</small></span>${pw(L)}</div>`
    : `<div class="vd lose">${TI.error(34)}<span class="mt"><b>The defender holds</b><small>none of your ${SENT} come home · luck ${lt(k)}</small></span>${pw(L)}</div>`;
  const pw = (L) => `<span class="vp"><span>${ic('army', 18)}Attack <b>${fmt(L.ap)}</b></span><span>${ic('shield', 18)}Defence <b>${fmt(DP)}</b></span></span>`;
  const SIM_CSS = `
.un{display:inline-flex;align-items:center;gap:8px;font:600 14px/1.2 var(--font)}
.lt2{width:100%;border-collapse:collapse}.lt2 th{font:700 13px/1.2 var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--on-surface-muted);text-align:right;padding:8px 10px 6px}.lt2 th:first-child{text-align:left}
.lt2 td{height:34px;padding:0 10px;border-top:1px solid var(--edge-soft);text-align:right;font:700 15px/1.2 var(--font)}.lt2 td:first-child{text-align:left}.lt2 td.ls{color:var(--danger)}.lt2 td.z{color:var(--on-surface-muted)}
.lt2 tr.gh td{height:30px;background:var(--surface-2);font:700 13px/1.2 var(--font);letter-spacing:.05em;text-transform:uppercase;color:var(--on-surface-muted)}.lt2 tr.gh td:first-child{text-align:left;color:var(--heading)}.lt2 tr.sup td{background:#eef7f1}
.vd{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:14px;border:2.5px solid var(--c-ink);box-shadow:0 3px 0 var(--c-ink)}.vd .mt b{font:400 22px/1.3 var(--font-display);color:var(--c-ink)}.vd .mt small{font:600 14px/1.25 var(--font);color:var(--c-ink)}
.vd.win{background:var(--c-leaf)}.vd .mt{flex:1}.vp{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font:600 13.5px/1.2 var(--font);color:var(--c-ink)}.vp span{display:inline-flex;align-items:center;gap:6px}.vp b{font:700 16px/1.2 var(--font);min-width:44px;text-align:right}
.rbd{display:flex;flex-direction:column;gap:10px;padding:12px 14px;flex:1;min-height:0}.vd.lose{background:var(--danger-bg)}
.pw{display:flex;flex-direction:column;gap:6px}.pwl{display:flex;justify-content:space-between;font:600 14px/1.2 var(--font);color:var(--on-surface-muted)}.pwl span{display:inline-flex;align-items:center;gap:6px}.pwl b{color:var(--heading);font-size:16px}
.pwb{position:relative;display:flex;height:16px;border-radius:99px;border:2px solid var(--c-ink);overflow:hidden;background:var(--c-teal-hi)}.pwb i.a{display:block;height:100%;background:var(--c-terra-hi);border-right:2px solid var(--c-ink)}.pwm{position:absolute;left:50%;top:-2px;bottom:-2px;width:2px;background:rgba(43,33,28,.45)}
.fx{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.fx>div{display:flex;flex-direction:column;gap:4px;padding:8px 12px;border-radius:12px;background:var(--surface-2)}.fx b{font:400 20px/1.3 var(--font-display);color:var(--heading)}.fx small{font:600 13px/1.2 var(--font);color:var(--on-surface-muted)}
`;

  // ---- Option A: three columns, Your army | Defender | Result with a luck slider ----
  {
    const k = -5, L = LUCK['-5'];
    const armyRows = UN.map((u) => { const v = ARMY[u.id] || 0; return `<div class="sr">${pt(u.id, 34)}<span class="mt"><b>${u.n}</b><small>${u.home ? u.home + ' at home' : 'none at home'}</small></span><span class="inp${u.id === 'raider' ? ' on' : v ? '' : ' z'}">${v}</span></div>`; }).join('');
    const army = `<div class="pn"><div class="ph"><h2>Your army</h2><span class="sp"></span><span class="btn sm">From home</span><span class="btn sm">Clear</span></div>
<div class="sga"><span class="up">Group</span><span class="chip">All troops</span><span class="chip">Decoy</span><span class="chip on">Big raid</span><span class="sp"></span><span class="cnt">${SENT} units</span></div>
<div class="srs">${armyRows}</div>
<div class="sga2"><span class="sw2 on"><i></i>Use my ranks</span><span class="tag tl">Raider Might 2 · +10% attack</span></div><div class="sga2 b2"><span class="sw2"><i></i>Morale 75%</span><span class="mut" style="font:500 13.5px/1.2 var(--font)">target under a third of your points</span></div></div>`;
    const defRows = UN.map((u) => { const v = DEFV[u.id] || 0, s = SUPV[u.id] || 0; return `<tr><td><span class="un">${pt(u.id, 30)}${u.n}</span></td><td><span class="inp${v ? '' : ' z'}">${v}</span></td><td><span class="inp${s ? '' : ' z'}">${s}</span></td></tr>`; }).join('');
    const def = `<div class="pn"><div class="ph"><h2>Defender</h2><span class="sub2">from your scouting of Cinderhold</span><span class="sp"></span><span class="btn sm">Clear</span></div>
<div class="wl"><span class="wli">${ic('shield', 26)}<span class="mt"><b>Wall level</b><small>+30% defence · 0 to 20</small></span></span><span class="stp"><span>−</span><b>6</b><span>+</span></span></div>
<table class="dt"><thead><tr><th>Unit</th><th>In the village</th><th>Support</th></tr></thead><tbody>${defRows}</tbody></table>
<div class="bwr"><span class="mt"><b>Bulwark rank</b><small>village · support</small></span><span class="xsel">None${chev(14, 'd')}</span><span class="xsel">None${chev(14, 'd')}</span></div></div>`;
    const res = `<div class="pn"><div class="ph"><h2>Result</h2><span class="sp"></span><span class="sub2">real battle rule · nothing is sent</span></div><div class="rbd">
<div class="lk2b"><div class="lkh"><span class="mt"><b>Luck</b><small>Random in a real fight, from −10% to +10%.</small></span><span class="lkv">${lt(k)}</span></div>
<div class="sl"><div class="slt"></div><span class="slf" style="left:25%;width:25%"></span>${[-10, -5, 0, 5, 10].map((t, i) => `<span class="slk" style="left:${i * 25}%"></span>`).join('')}<span class="slh" style="left:25%"></span></div>
<div class="sll">${[-10, -5, 0, 5, 10].map((t) => `<span${t === k ? ' class="on"' : ''}>${lt(t)}</span>`).join('')}</div></div>
${verdict(L, k)}
<table class="lt2"><tbody><tr class="gh"><td>Your army</td><td>Sent</td><td>Lost</td><td>Left</td></tr>${lossRows(ARMY, L.al)}<tr class="gh"><td>Defender · last row support</td><td>In</td><td>Lost</td><td>Left</td></tr>${lossRows(DEFV, L.dl)}${lossRows(SUPV, L.sl, 'sup')}</tbody></table>
<div class="fx"><div><span class="up">Wall after</span><b>6 → 6</b><small>no change</small></div><div><span class="up">Survivors carry</span><b>${fmt(L.carry)}</b><small>at most, as loot</small></div><div><span class="up">At 0% luck</span><b>${left(LUCK[0])} home</b><small>carry ${LUCK[0].carry}</small></div></div>
</div></div>`;
    page('sim-a-1440', 'army', `<main class="sheetA" style="display:flex;flex-direction:column;gap:12px"><div class="shd"><span class="tk r" style="width:44px;height:44px">${ic('army', 26)}</span><h1>Battle simulator</h1><span class="mut shs">Try a fight before you send it. Same rule as the real battle.</span><span class="sp"></span><span class="lk">${ic('reports', 18)}Fill from a report ${chev(13)}</span><span class="btn">${ic('army', 18)}Send this army</span></div><div class="s3">${army}${def}${res}</div></main>`, `${SIM_CSS}
.shd{display:flex;align-items:center;gap:12px;height:48px;flex:none}.shd h1{font:400 26px/1.35 var(--font-display);color:var(--heading);padding-top:2px}.shs{font:500 15px/1.2 var(--font)}
.s3{display:grid;grid-template-columns:430px 420px 1fr;gap:14px;flex:1;min-height:0}
.sga{display:flex;align-items:center;gap:8px;padding:10px 14px 4px}.sga .up{margin-right:4px}
.srs{display:flex;flex-direction:column;padding:4px 10px;flex:1;justify-content:space-between}.sr{display:flex;align-items:center;gap:10px;height:48px;padding:0 6px;border-radius:12px}.sr:nth-child(odd){background:var(--surface-2)}.sr .mt b{font-size:15px}
.sga2{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:2px solid var(--edge-soft);background:var(--surface-2)}.sga2.b2{border-top:1px solid var(--edge-soft)}
.wl{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:2px solid var(--edge-soft)}.wli{display:flex;align-items:center;gap:10px;flex:1}.wli .mt b{font-size:15px}
.dt{width:100%;border-collapse:collapse}.dt th{font:700 13px/1.2 var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--on-surface-muted);text-align:right;padding:8px 14px 4px}.dt th:first-child{text-align:left}.dt td{height:47px;padding:0 14px;text-align:right}.dt td:first-child{text-align:left}.dt td .inp{width:76px;display:inline-flex}.dt tr:nth-child(odd) td{background:var(--surface-2)}
.bwr{display:flex;align-items:center;gap:8px;margin-top:auto;padding:10px 14px;border-top:2px solid var(--edge-soft);background:var(--surface-2)}.bwr .mt b{font-size:14.5px}.bwr .xsel{width:92px}
.rbd{display:flex;flex-direction:column;gap:10px;padding:12px 14px;flex:1;min-height:0}
.lk2b{display:flex;flex-direction:column;gap:6px;padding:10px 14px 12px;border-radius:14px;background:var(--surface-2);border:2px solid var(--edge-soft)}
.lkh{display:flex;align-items:center;gap:10px}.lkh .mt b{font:400 19px/1.3 var(--font-display);color:var(--heading)}.lkh .mt small{white-space:normal;font-size:13.5px}
.lkv{display:grid;place-items:center;min-width:76px;height:42px;padding:0 10px 1px;border-radius:12px;background:var(--c-ink);color:var(--on-dark);font:400 22px/1.2 var(--font-display)}
.sl{position:relative;height:30px;margin:4px 14px 0}.slt{position:absolute;left:0;right:0;top:10px;height:10px;border-radius:99px;background:linear-gradient(90deg,var(--c-terra-hi),var(--surface-3) 50%,var(--c-leaf));border:2px solid var(--c-ink)}
.slf{position:absolute;top:10px;height:10px;background:rgba(43,33,28,.18)}.slk{position:absolute;top:4px;width:2px;height:22px;margin-left:-1px;background:rgba(43,33,28,.35)}
.slh{position:absolute;top:0;width:30px;height:30px;margin-left:-15px;border-radius:50%;background:var(--c-sun);border:2.5px solid var(--c-ink);box-shadow:inset 0 3px 0 var(--c-sun-hi),0 3px 0 var(--c-ink)}
.sll{position:relative;display:flex;justify-content:space-between;margin:0 -4px;font:600 13px/1.2 var(--font);color:var(--on-surface-muted)}.sll span.on{color:var(--heading);font-weight:700}
.lks{margin-top:4px}.lks span{height:36px;font-size:14px}
.lt2 td{height:29px}.lt2 tr.gh td{height:28px}.cnt{white-space:nowrap}`);
  }

  // ---- Option B: two bands of figures on top; a luck ladder (all five results at once, pick one) and the picked result ----
  {
    const k = 0, L = LUCK[0];
    const aTiles = UN.map((u) => { const v = ARMY[u.id] || 0; return `<div class="bt${v ? ' in' : ''}">${fig(u.id, 60, 40)}<b>${u.n}</b><small>${u.home ? u.home + ' at home' : 'none'}</small><span class="inp${u.id === 'raider' ? ' on' : v ? '' : ' z'}">${v}</span></div>`; }).join('');
    const dTiles = UN.map((u) => { const v = DEFV[u.id] || 0, s = SUPV[u.id] || 0; return `<div class="bt dd${v || s ? ' in' : ''}">${fig(u.id, 50, 34)}<b>${u.n}</b><span class="dv"><span class="inp${v ? '' : ' z'}">${v}</span><span class="inp sp2${s ? '' : ' z'}">${s}</span></span></div>`; }).join('');
    const army = `<div class="pn"><div class="ph"><h2>Your army</h2><span class="cnt">${SENT} units</span><span class="sp"></span><span class="chip">All troops</span><span class="chip">Decoy</span><span class="chip on">Big raid</span><span class="sw2 on" style="margin-left:8px"><i></i>Use my ranks</span><span class="tag tl">Raider Might 2 · +10%</span><span class="sw2"><i></i>Morale 75%</span><span class="btn sm">From home</span><span class="btn sm">Clear</span></div><div class="bts">${aTiles}</div></div>`;
    const def = `<div class="pn"><div class="ph"><h2>Defender</h2><span class="sub2">Cinderhold · from your scouting</span><span class="sp"></span><span class="lgd"><span class="lg1">in the village</span><span class="lg1 s">support</span></span><span class="wlb">${ic('shield', 22)}Wall</span><span class="stp"><span>−</span><b>6</b><span>+</span></span><span class="wlb">Bulwark</span><span class="xsel">None${chev(14, 'd')}</span><span class="btn sm">Clear</span></div><div class="bts">${dTiles}</div></div>`;
    const ladder = `<div class="pn" style="width:500px;flex:none"><div class="ph"><h2>Luck</h2><span class="sp"></span><span class="sub2">random in a real fight · pick one to see it</span></div><div class="lad">${[-10, -5, 0, 5, 10].map((t) => { const R = LUCK[t]; return `<div class="ld${t === k ? ' on' : ''}${R.won ? '' : ' bad'}"><span class="lv2">${lt(t)}</span><span class="mt"><b>${R.won ? 'You win' : 'Defender holds'}</b><small>${R.won ? `${left(R)} of ${SENT} come home` : 'your whole army falls'}</small></span><span class="lc">${R.won ? `${ic('wood', 18)}carry <b>${R.carry}</b>` : '<b>0</b>'}</span><span class="lbar"><i style="width:${Math.round((left(R) / SENT) * 100)}%"></i></span></div>`; }).join('')}</div></div>`;
    const res = `<div class="pn" style="flex:1"><div class="ph"><h2>Result at ${lt(k)} luck</h2><span class="sp"></span><span class="btn sm">${ic('army', 16)}Send this army</span></div><div class="rbd">${verdict(L, k)}<div class="two"><div class="ft3"><table class="lt2"><thead><tr><th>Your army</th><th>Sent</th><th>Lost</th><th>Left</th></tr></thead><tbody>${lossRows(ARMY, L.al)}</tbody></table></div><div class="ft3"><table class="lt2"><thead><tr><th>Defender</th><th>In</th><th>Lost</th><th>Left</th></tr></thead><tbody>${lossRows(DEFV, L.dl)}${lossRows(SUPV, L.sl, 'sup')}</tbody></table></div><div class="fx fxv"><div><span class="up">Wall after</span><b>6 → 6</b><small>no change</small></div><div><span class="up">Survivors carry</span><b>${L.carry}</b><small>at most, as loot</small></div><div><span class="up">Defender left</span><b>0</b><small>village is empty</small></div></div></div></div></div>`;
    page('sim-b-1440', 'army', `<main class="sheetA" style="display:flex;flex-direction:column;gap:12px">${army}${def}<div style="display:flex;gap:14px;flex:1;min-height:0">${ladder}${res}</div></main>`, `${SIM_CSS}
.bts{display:grid;grid-template-columns:repeat(9,1fr);gap:8px;padding:10px}
.bt{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 4px 8px;border-radius:14px;background:var(--surface-2);min-width:0}.bt b{font:700 14px/1.2 var(--font);white-space:nowrap}.bt small{font:500 13px/1.2 var(--font);color:var(--on-surface-muted)}.bt .inp{width:84px;justify-content:center;margin-top:3px}
.bt.in{background:var(--c-sun-hi)}.bt.dd.in{background:var(--info-bg)}.bt:not(.in) .fg{opacity:.55}
.dv{display:flex;gap:4px;margin-top:3px}.dv .inp{width:62px;justify-content:center}.dv .inp.sp2{background:#eef7f1;border-style:dashed}
.lgd{display:inline-flex;align-items:center;gap:6px;margin-right:8px}.lg1{display:inline-flex;align-items:center;height:28px;padding:0 10px 1px;border-radius:8px;border:2px solid var(--edge);background:var(--input-bg);font:600 13px/1.2 var(--font);color:var(--on-surface-muted)}.lg1.s{border-style:dashed;background:#eef7f1}
.wlb{display:inline-flex;align-items:center;gap:6px;font:700 14px/1.2 var(--font);margin-left:6px}
.lad{display:flex;flex-direction:column;gap:6px;padding:10px;flex:1}
.ld{position:relative;display:flex;align-items:center;gap:12px;flex:1;padding:0 14px 4px 10px;border-radius:13px;border:2px solid var(--edge-soft);background:var(--surface-2);overflow:hidden}
.ld .mt b{font:700 15.5px/1.2 var(--font)}.lv2{display:grid;place-items:center;width:62px;height:36px;border-radius:10px;background:var(--surface);border:2px solid var(--edge);font:700 16px/1.2 var(--font);flex:none}
.ld.on{border:2.5px solid var(--c-ink);background:var(--c-sun-hi);box-shadow:0 3px 0 var(--c-ink)}.ld.on .lv2{background:var(--c-ink);color:var(--on-dark);border-color:var(--c-ink)}
.ld.bad{background:var(--danger-bg)}.ld.bad .mt b{color:var(--danger)}
.lc{display:inline-flex;align-items:center;gap:5px;font:600 13.5px/1.2 var(--font);color:var(--on-surface-muted);white-space:nowrap}.lc b{font:700 16px/1.2 var(--font);color:var(--heading)}
.lbar{position:absolute;left:0;right:0;bottom:0;height:5px;background:rgba(43,33,28,.08)}.lbar i{display:block;height:100%;background:var(--c-moss)}
.two{display:flex;gap:10px}.ft3{flex:1;border:2px solid var(--edge);border-radius:12px;overflow:hidden}.ft3 .lt2 th{background:var(--surface-2)}.ft3 .lt2 th:first-child{color:var(--heading)}.sn{padding:6px 10px;font:500 13px/1.2 var(--font);color:var(--on-surface-muted);border-top:1px solid var(--edge-soft)}
.lt2 tr.sup td{background:#eef7f1}
.rbd .vd .mt b{font-size:20px}.rbd{gap:8px;padding:10px 12px}.rbd .lt2 td{height:29px}.rbd .lt2 th{padding:6px 10px 5px}.vd{padding:7px 14px}
.fxv{grid-template-columns:1fr;width:190px;flex:none;gap:6px;align-content:start}.fxv>div{padding:6px 10px;gap:2px}.fxv b{font-size:18px}.fxv small{display:none}`);
  }

  /* ============================== 2 · UNIT INFO CARD (over the Army page) ============================== */
  // Engine config.ts numbers for the Raider; train time at Barracks 8 = 300 s x 0.94^7 (same as the Barracks pictures).
  const RA = { a: 40, di: 10, dc: 5, sp: '10:00', carry: 30, pop: 1, cost: [40, 80, 50, 0], t: '3:14', req: 'Barracks 2' };
  const MAXS = { a: 110, di: 70, dc: 50, carry: 70 }; // Knight, Knight, Knight, Outrider
  {
    // A · small hover card next to the Raider tile (the cursor rests on it); every unit name and picture gets one.
    const card = `<div class="uc"><div class="uch">${fig('raider', 66, 62)}<span class="mt"><span class="ucn"><b>Raider</b><span class="tag ucr">Attack</span></span><small>Foot · trains at the Barracks</small></span></div>
<div class="ucg"><div>${ic('army', 20)}<span>Attack</span><b>${RA.a}</b></div><div>${ic('time', 20)}<span>Speed</span><b>${RA.sp}<small> /field</small></b></div><div>${ic('shield', 20)}<span>Def. vs foot</span><b>${RA.di}</b></div><div>${ic('wood', 20)}<span>Carries</span><b>${RA.carry}</b></div><div>${ic('shield', 20)}<span>Def. vs riders</span><b>${RA.dc}</b></div><div>${ic('pop', 20)}<span>People</span><b>${RA.pop}</b></div></div>
<div class="ucc">${costEl(RA.cost, { s: 20 })}<span class="ucti">${ic('time', 18)}<b>${RA.t}</b> each</span></div>
<div class="ucw"><b>Good for:</b> hitting hard and carrying loot home. Weak when attacked.</div>
<div class="ucf"><span>Barracks 8 · needs Barracks 2</span><span class="sp"></span><span class="lk">Full card ${chev(13)}</span></div></div>`;
    const cursor = `<svg class="cur2" width="26" height="30" viewBox="0 0 26 30"><path d="M3 2l19 15-8.5 1.2 4.8 9.3-3.6 1.8-4.8-9.4L3 25z" fill="#fff" stroke="#2B211C" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
    const s = over('mix-army2-1440', 'unitcard-a-1440', `
.uc{position:absolute;left:556px;top:358px;width:384px;z-index:20;background:var(--surface);border:2.5px solid var(--c-ink);border-radius:16px;box-shadow:0 4px 0 var(--c-ink),0 14px 30px rgba(43,33,28,.28);overflow:hidden}
.uc::before{content:'';position:absolute;left:84px;top:-11px;width:18px;height:18px;background:var(--surface-2);border-left:2.5px solid var(--c-ink);border-top:2.5px solid var(--c-ink);transform:rotate(45deg)}
.uch{display:flex;align-items:center;gap:12px;padding:10px 14px 8px;background:var(--surface-2);border-bottom:2px solid var(--edge-soft)}.ucn{display:flex;align-items:center;gap:8px}.ucn b{font:400 22px/1.3 var(--font-display);color:var(--heading)}.uch .mt small{font-size:13.5px}
.ucr{background:var(--c-terra-hi);color:var(--c-ink)}
.ucg{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;padding:10px 14px}.ucg>div{display:flex;align-items:center;gap:7px;height:34px;padding:0 10px 0 7px;border-radius:10px;background:var(--surface-2);font:600 13.5px/1.2 var(--font);color:var(--on-surface-muted)}.ucg b{margin-left:auto;font:700 16px/1.2 var(--font);color:var(--heading);white-space:nowrap}.ucg b small{font:600 13px/1.2 var(--font);color:var(--on-surface-muted)}
.ucc{display:flex;align-items:center;gap:12px;padding:0 14px 10px}.ucti{display:inline-flex;align-items:center;gap:4px;margin-left:auto;font:600 13.5px/1.2 var(--font);color:var(--on-surface-muted)}.ucti b{color:var(--heading);font-size:14.5px}
.ucw{margin:0 14px 10px;padding:9px 12px;border-radius:11px;background:var(--info-bg);font:500 14px/1.4 var(--font)}
.ucf{display:flex;align-items:center;gap:8px;height:42px;padding:0 14px;border-top:2px solid var(--edge-soft);font:600 13.5px/1.2 var(--font);color:var(--on-surface-muted)}
.cur2{position:absolute;left:660px;top:236px;z-index:21}
.mu2:nth-child(3){background:var(--c-sun-hi)!important;box-shadow:0 0 0 3px var(--c-ink)}`, `${card}${cursor}`);
    writeRaw('unitcard-a-1440', s);
  }
  {
    // B · click card: the Army page dims; one big card with the figure on a stage, bars against the strongest unit, cost and training.
    const bar = (lab, v, max, icn, note = '') => `<div class="sb"><span class="sbl">${ic(icn, 20)}${lab}</span><span class="sbt"><i style="width:${Math.max(3, Math.round((v / max) * 100))}%"></i></span><b>${v}</b><small>${note}</small></div>`;
    const card = `<div class="scrim"></div><div class="ub" role="dialog"><div class="ubs"><div class="stg">${fig('raider', 230, 230)}</div><div class="ubnav"><span class="btn ic">${chev(16, 'l')}</span><span class="mut">3 of 9</span><span class="btn ic">${chev(16, 'r')}</span></div></div>
<div class="ubr"><div class="ubh"><h2>Raider</h2><span class="tag ucr">Attack</span><span class="tag mut">Foot</span><span class="sp"></span><span class="xb">${xI()}</span></div>
<p class="ubw"><b>Good for:</b> hitting hard and carrying loot home. Weak when attacked, so keep defenders at home too.</p>
<div class="sbs"><div class="up">Fighting <span class="mut" style="text-transform:none;letter-spacing:0;font-weight:500">· bar = against the strongest unit</span></div>${bar('Attack', RA.a, MAXS.a, 'army', 'best: Knight 110')}${bar('Defence vs foot', RA.di, MAXS.di, 'shield', 'best: Knight 70')}${bar('Defence vs riders', RA.dc, MAXS.dc, 'shield', 'best: Knight 50')}</div>
<div class="ubg"><div><span class="up">Speed</span><b>${RA.sp}</b><small>minutes per field</small></div><div><span class="up">Carries</span><b>${RA.carry}</b><small>loot per unit</small></div><div><span class="up">People</span><b>${RA.pop}</b><small>per unit</small></div><div><span class="up">Training</span><b>${RA.t}</b><small>each at Barracks 8</small></div></div>
<div class="ubc"><span class="up">Cost</span>${costEl(RA.cost, { s: 24, full: 1 })}<span class="sp"></span><span class="mut">needs Barracks 2 · no research</span></div>
<div class="ust"><span class="up">All units</span>${UN.map((u) => `<span class="usu${u.id === 'raider' ? ' on' : ''}">${pt(u.id, 36)}</span>`).join('')}</div><div class="ubf"><span class="mut"><b>12</b> at home · 4 away · 5 training</span><span class="sp"></span><span class="btn">Close</span><span class="btn g">${ic('army', 18)}Train at the Barracks</span></div></div></div>`;
    const s = over('mix-army2-1440', 'unitcard-b-1440', `
.scrim{position:absolute;inset:0;background:var(--scrim);z-index:20}
.ub{position:absolute;left:220px;top:150px;width:1000px;height:600px;z-index:21;display:flex;background:var(--surface);border:2.5px solid var(--c-ink);border-radius:20px;box-shadow:0 5px 0 var(--c-ink),0 20px 50px rgba(0,0,0,.35);overflow:hidden}
.ubs{width:340px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:var(--surface-2);border-right:2px solid var(--edge-soft)}
.stg{position:relative;display:grid;place-items:end center;width:280px;height:300px}.stg::before{content:'';position:absolute;left:30px;right:30px;bottom:6px;height:44px;border-radius:50%;background:#9cc46a;border:2.5px solid var(--c-ink);box-shadow:0 5px 0 var(--c-moss)}.stg .fg{position:relative;margin-bottom:22px}
.ubnav{display:flex;align-items:center;gap:12px;font:600 14px/1.2 var(--font)}
.ubr{flex:1;display:flex;flex-direction:column;gap:14px;padding:20px 24px 20px}
.ubh{display:flex;align-items:center;gap:10px}.ubh h2{font:400 34px/1.4 var(--font-display);color:var(--heading)}.ucr{background:var(--c-terra-hi);color:var(--c-ink)}
.ubw{font:500 16px/1.45 var(--font);padding:10px 14px;border-radius:12px;background:var(--info-bg)}
.sbs{display:flex;flex-direction:column;gap:8px}.sb{display:grid;grid-template-columns:190px 1fr 44px 130px;align-items:center;gap:10px}.sbl{display:inline-flex;align-items:center;gap:8px;font:600 15px/1.2 var(--font)}
.sbt{height:16px;border-radius:99px;background:var(--surface-3);border:2px solid var(--c-ink);overflow:hidden}.sbt i{display:block;height:100%;background:var(--c-terra-hi)}.sb b{font:700 18px/1.2 var(--font);text-align:right}.sb small{font:500 13px/1.2 var(--font);color:var(--on-surface-muted)}
.ubg{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.ubg>div{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:12px;background:var(--surface-2)}.ubg b{font:400 24px/1.4 var(--font-display);color:var(--heading)}.ubg small{font:600 13px/1.2 var(--font);color:var(--on-surface-muted)}
.ubc{display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:12px;border:2px solid var(--edge-soft)}.ubc .cost b{font-size:16px}.ubc .mut{font:500 14px/1.2 var(--font)}
.ust{display:flex;align-items:center;gap:8px}.ust .up{margin-right:6px}.usu{display:grid;place-items:center;width:46px;height:46px;border-radius:12px;background:var(--surface-2);border:2px solid transparent}.usu.on{background:var(--c-sun-hi);border-color:var(--c-ink)}
.ubf{display:flex;align-items:center;gap:10px;margin-top:auto;padding-top:14px;border-top:2px solid var(--edge-soft)}.ubf .mut{font:500 14.5px/1.2 var(--font)}.ubf b{color:var(--heading)}`, card);
    writeRaw('unitcard-b-1440', s);
  }

  /* ============================== 3 · TOASTS (over the Mail page, after sending to "test") ============================== */
  // Messages are the game's own: the mail error the owner saw, the population refusal, the mail success, the First steps info.
  const TOASTS = [
    ['error', 'There is no player called "test".', ''],
    ['warn', 'Not enough population room. Upgrade the Farm to train more troops.', 'Farm'],
    ['ok', 'Sent to Maerwen.', 'Open'],
    ['info', 'First steps hidden. Bring them back in Settings.', ''],
  ];
  const toTest = (s) => s.replace('<span class="fin">Maerwen</span>', '<span class="fin" style="border-color:var(--danger);box-shadow:0 0 0 3px var(--danger-bg)">test</span>');
  {
    const t = `<div class="tsA">${TOASTS.map(([k, m, a]) => `<div class="ta ${k}">${TI[k](30)}<span class="tm">${m}</span>${a ? `<span class="btn sm">${a}</span>` : ''}<span class="tx">${xI(16)}</span></div>`).join('')}</div>`;
    writeRaw('toast-a-1440', over('mix-mail-compose-1440', 'toast-a-1440', `
.tsA{position:absolute;right:30px;bottom:30px;z-index:30;display:flex;flex-direction:column;gap:10px;width:440px}
.ta{display:flex;align-items:center;gap:12px;min-height:58px;padding:9px 8px 9px 12px;border-radius:15px;border:2.5px solid var(--c-ink);box-shadow:0 4px 0 var(--c-ink),0 10px 24px rgba(43,33,28,.22);color:var(--c-ink)}
.ta .tm{flex:1;font:600 15px/1.35 var(--font)}.ta .btn.sm{min-height:36px}
.tx{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;flex:none;color:var(--c-ink);background:rgba(255,255,255,.55)}
.ta.error{background:var(--danger-bg)}.ta.warn{background:var(--warn-bg)}.ta.ok{background:var(--ok-bg)}.ta.info{background:var(--info-bg)}`, t, toTest));
  }
  {
    const t = `<div class="tsB">${TOASTS.map(([k, m, a], i) => `<div class="tb2 ${k}">${TI[k](30)}<span class="tm">${m}</span>${a ? `<span class="btn sm">${a}</span>` : ''}<span class="tx">${xI(16)}</span><span class="tt"><i style="width:${[78, 52, 30, 12][i]}%"></i></span></div>`).join('')}</div>`;
    writeRaw('toast-b-1440', over('mix-mail-compose-1440', 'toast-b-1440', `
.tsB{position:absolute;left:50%;top:132px;transform:translateX(-50%);z-index:30;display:flex;flex-direction:column;align-items:center;gap:10px}
.tb2{position:relative;display:flex;align-items:center;gap:12px;min-height:56px;max-width:600px;padding:8px 8px 12px 12px;border-radius:24px;border:2.5px solid var(--c-ink);box-shadow:0 4px 0 var(--c-ink),0 10px 24px rgba(43,33,28,.25);overflow:hidden}
.tb2 .tm{font:700 15.5px/1.3 var(--font)}.tb2 .tx{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;flex:none;background:rgba(255,248,232,.22);color:inherit}
.tb2.error{background:var(--strip-danger);color:var(--on-strip)}.tb2.warn{background:var(--c-sun);color:var(--c-ink)}.tb2.warn .tx{background:rgba(43,33,28,.1)}.tb2.ok{background:var(--c-moss-deep);color:var(--on-strip)}.tb2.info{background:var(--c-teal-lo);color:var(--on-strip)}
.tb2 .btn.sm{min-height:36px;border-radius:99px}
.tt{position:absolute;left:24px;right:24px;bottom:4px;height:4px;border-radius:99px;background:rgba(255,248,232,.25)}.tt i{display:block;height:100%;border-radius:99px;background:rgba(255,248,232,.85)}.tb2.warn .tt{background:rgba(43,33,28,.15)}.tb2.warn .tt i{background:rgba(43,33,28,.6)}`, t, toTest));
  }

  /* ============================== 4 · MAIL: CHOOSING WHO TO WRITE TO ============================== */
  // The game sends to ONE player name. It knows: conversation partners (today's To suggestions), tribe members with roles, and a
  // player search (search/villages by player). No friends list exists; Contacts in option B is a NEW feature, labelled.
  const RECENT = [['Maerwen', 'EMB', '12m ago'], ['Corwin', 'EMB', '3h ago'], ['Ysolde_K', 'THN', '5h ago'], ['Brannoch', 'ASH', '1d ago'], ['Ironhart', '', '2d ago']];
  const TRIBE = [['Maerwen', 'officer', 'online'], ['Saffi', 'officer', 'online'], ['Orrin', 'member', 'online'], ['Corwin', 'member', '2h'], ['Wren', 'member', '3h'], ['Barley', 'member', '5h']];
  const ROLE = (r) => `<span class="role ${r}">${{ leader: 'Leader', officer: 'Officer', member: 'Member' }[r]}</span>`;
  const seen = (o) => (o === 'online' ? '<span class="onl"><i></i>online</span>' : `<span class="mut">${o} ago</span>`);
  const ttg = (t) => (t ? `<span class="tag mut">${t}</span>` : '<span class="mut">no tribe</span>');
  const formBits = (sub = 'Tolvek is moving', msg = 'Saw two armies leave Cinderhold. Can you send Pikemen to Emberfold before 15:23?') => ({
    sub: `<label class="fld"><span>Subject</span><span class="fin">${sub}</span></label>`,
    msg: `<label class="fld grow"><span>Message</span><span class="fin ta">${msg}<span class="caret" style="margin-left:1px"></span></span></label>`,
    foot: `<div class="cft"><span class="mut">${msg.length} / 2000</span><span class="sp"></span><span class="btn g">${ic('mail', 18)}Send</span></div>`,
  });
  const toChip = (n) => `<label class="fld"><span>To</span><span class="fin tof"><span class="toc">${av(n, 28)}<b>${n}</b><span class="tag mut">EMB</span>${xI(14)}</span></span></label>`;
  const MT_CSS = `
.onl{display:inline-flex;align-items:center;gap:5px;font:600 13px/1.2 var(--font);color:var(--ok)}.onl i{width:9px;height:9px;border-radius:50%;background:var(--c-moss)}
.tof{gap:8px;padding:0 8px}.toc{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 10px 0 4px;border-radius:99px;background:var(--c-sun-hi);border:2px solid var(--c-ink);font:700 15px/1.2 var(--font)}.toc svg{color:var(--on-surface-muted)}
.prw{display:flex;align-items:center;gap:10px;min-height:48px;padding:0 12px;border-top:1px solid var(--edge-soft)}.prw .mt b{font-size:14.5px}.prw .mt small{font-size:13px}.prw.on{background:var(--c-sun-hi)}
.psec{display:flex;align-items:center;gap:8px;padding:10px 12px 6px}.psec .up{flex:1}
.cmp2 .fin.ta{font:500 15.5px/1.55 var(--font)}
.role{display:inline-flex;align-items:center;height:24px;padding:0 9px 1px;border-radius:99px;font:700 13px/1.2 var(--font);flex:none}.role.leader{background:var(--c-sun)}.role.officer{background:var(--c-teal-hi)}.role.member{background:var(--surface-3)}`;
  const swapCompose = (inner) => (s) => s.replace(/<div class="pn" style="flex:1"><div class="cmp2">[\s\S]*<\/div><\/main>/, `${inner}</div></main>`);
  {
    // A · a "Who to write to" column next to the form: search any player, recent conversations, your tribe with roles.
    const F = formBits();
    const picker = `<div class="pn" style="width:340px;flex:none"><div class="ph"><h2>Who to write to</h2></div><div style="padding:10px 12px 4px"><span class="xsr">${SRCH}Search any player</span></div>
<div class="psec"><span class="up">Recent conversations</span></div>${RECENT.map(([n, t, w], i) => `<div class="prw${i === 0 ? ' on' : ''}">${av(n, 32)}<span class="mt"><b>${n}</b><small>last mail ${w}</small></span>${ttg(t)}</div>`).join('')}
<div class="psec"><span class="up">Your tribe · EMB</span><span class="lk">All 18 ${chev(13)}</span></div>${TRIBE.slice(1).map(([n, r, o]) => `<div class="prw">${av(n, 32)}<span class="mt"><b>${n}</b><small>${seen(o)}</small></span>${ROLE(r)}</div>`).join('')}</div>`;
    const form = `<div class="pn" style="flex:1"><div class="cmp2"><div class="cph"><h2>New mail</h2><span class="sp"></span><span class="btn sm">Cancel</span></div>${toChip('Maerwen')}${F.sub}${F.msg}<div class="emo">${['😀', '🙂', '😉', '👍', '🙏', '🔥', '⚔️', '🛡️'].map((e) => `<span class="eb">${e}</span>`).join('')}<span class="lk" style="margin-left:4px">more</span></div>${F.foot}</div></div>`;
    writeRaw('mailto-a-1440', over('mix-mail-compose-1440', 'mailto-a-1440', `${MT_CSS}.psec+.prw{border-top:0}`, '', swapCompose(picker + form)));
  }
  {
    // B · the To area opens one "choose" band: search with suggestions, then Contacts (NEW) | Recent | Tribe side by side.
    const F = formBits('Re: Truce?', 'A week of truce is fine by me. Stay east of 420 and keep your Raiders off Ashby.');
    const col = (title, extra, rows) => `<div class="pcol"><div class="psec"><span class="up">${title}</span>${extra}</div>${rows}</div>`;
    const crow = (n, sub, right, on) => `<div class="prw${on ? ' on' : ''}">${av(n, 30)}<span class="mt"><b>${n}</b><small>${sub}</small></span>${right}</div>`;
    const band = `<div class="chs3"><div class="chh"><span class="xsr on">${SRCH}<span style="color:var(--on-surface)">Ma</span><span class="caret" style="margin-left:-6px"></span></span><span class="sgs"><span class="up">Players found</span><span class="chip">${av('Maerwen', 24)}Maerwen <small>EMB · Officer</small></span><span class="chip">${av('Maddox', 24)}Maddox <small>THN</small></span><span class="chip">${av('Marlo', 24)}Marlo <small>no tribe</small></span></span></div>
<div class="pcols">${col('Contacts', '<span class="new">NEW</span><span class="sp"></span><span class="lk">Edit</span>', [['Maerwen', 'EMB · pinned'], ['Ysolde_K', 'THN · pinned', 1], ['Corwin', 'EMB · pinned'], ['Saffi', 'EMB · pinned']].map(([n, s, on]) => crow(n, s, PIN(18), on)).join(''))}
${col('Recent', '<span class="sp"></span>', RECENT.slice(0, 4).map(([n, t, w]) => crow(n, `last mail ${w}`, ttg(t))).join(''))}
${col('Tribe · EMB', '<span class="sp"></span><span class="lk">All 18</span>', TRIBE.slice(0, 4).map(([n, r, o]) => crow(n, seen(o), ROLE(r))).join(''))}</div>
<div class="pnote">${PIN(16)}<span><b>Contacts is a new feature:</b> pin any player from their profile, a report or here. Only you see your list.</span></div></div>`;
    const form = `<div class="pn" style="flex:1"><div class="cmp2"><div class="cph"><h2>New mail</h2><span class="sp"></span><span class="btn sm">Cancel</span></div><div class="tor"><span class="tol">To</span><span class="fin tof" style="flex:1"><span class="toc">${av('Ysolde_K', 28)}<b>Ysolde_K</b><span class="tag mut">THN</span>${xI(14)}</span></span></div>${band}<div class="r2">${F.sub}</div>${F.msg}${F.foot}</div></div>`;
    writeRaw('mailto-b-1440', over('mix-mail-compose-1440', 'mailto-b-1440', `${MT_CSS}
.tor{display:flex;align-items:center;gap:12px}.tol{width:62px;font:700 13.5px/1.2 var(--font);color:var(--on-surface-muted)}
.chs3{display:flex;flex-direction:column;border:2px solid var(--edge);border-radius:14px;background:var(--surface);overflow:hidden;flex:none}
.chh{display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface-2);border-bottom:2px solid var(--edge-soft)}.chh .xsr{width:170px;flex:none}.sgs{display:flex;align-items:center;gap:8px}.sgs .up{margin-right:2px}.sgs .chip{padding-left:4px}.sgs .ring{border-width:2px}
.pcols{display:grid;grid-template-columns:repeat(3,1fr)}.pcol{border-left:2px solid var(--edge-soft)}.pcol:first-child{border-left:0}.pcol .psec{padding:8px 12px 4px}.pcol .prw{min-height:44px;padding:0 10px}.psec+.prw{border-top:0}
.pnote{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:2px solid var(--edge-soft);background:#f4ecf1;font:500 13.5px/1.3 var(--font)}
.cmp2{gap:10px}.r2 .fld{gap:4px}`, '', swapCompose(form)));
  }

  /* ============================== 5 · TRIBE WITHOUT A TRIBE + DOMINATION ============================== */
  // Tribe list (Finder): rank, tag, name, members of 30, points, recruitment (open = Join, application = Apply, invite only, Full).
  // PLAYER_MAX_APPLICATIONS 3, TRIBE_FOUND_HALL_LEVEL 3 (Emberfold has Town Hall 12), tag 2-6, name 3-30, application message 300.
  const TL = [
    [1, 'ASH', 'Ashen Pact', 29, 98450, 'application', ''], [2, 'THN', 'Thornmark', 30, 84120, 'application', 'full'], [3, 'CND', 'Cinder Band', 27, 71300, 'invite', ''],
    [4, 'GWO', 'Greywater Oath', 24, 60940, 'open', ''], [5, 'MRL', 'Marsh Lords', 22, 52875, 'application', 'sel'], [6, 'HLW', 'Hollow Watch', 19, 45610, 'application', 'applied'],
    [7, 'EMB', 'Embers of the Fold', 18, 41280, 'application', 'invited'], [8, 'RVN', 'Raven Hollow', 15, 33920, 'open', ''], [9, 'SLT', 'Salt Wardens', 12, 26480, 'application', ''], [10, 'OAK', 'Oakridge Kin', 9, 18200, 'open', ''],
  ];
  const RECR = { open: 'Open to all', application: 'By application', invite: 'Invite only' };
  const act = ([, , , m, , r, st]) => (st === 'invited' ? '<span class="tag tl">Invited</span>' : st === 'applied' ? '<span class="tag won">Applied</span>' : st === 'full' || m >= 30 ? '<span class="tag mut">Full</span>' : r === 'open' ? '<span class="btn g sm">Join</span>' : r === 'application' ? '<span class="btn sm">Apply</span>' : '<span class="tag mut">Invite only</span>');
  const INV = [['EMB', 'Embers of the Fold', 'Maerwen', '6 days left', 18], ['RVN', 'Raven Hollow', 'Tamsin', '2 days left', 15]];
  const head = (right) => `<div class="trh"><span class="ttag nt">${ic('tribe', 30)}</span><span class="trn"><b>Tribes</b><small>You are not in a tribe yet · join one, or found your own</small></span><span class="sp"></span>${right}</div>`;
  const stat = (l, v) => `<span class="tst"><span class="up">${l}</span><b>${v}</b></span>`;
  const domMini = `<span class="tst dmi"><span class="up">Domination</span><span class="dmr"><b>ASH 18.6%</b><span class="dmb2"><s><i style="width:18.6%"></i></s><em style="left:75%"></em></span></span><span class="lk">Details ${chev(13)}</span></span>`;
  const found = (compact) => `<div class="pn"${compact ? '' : ' style="flex:1"'}><div class="ph p2"><h2>Found a tribe</h2><span class="sp"></span><span class="tag won">${CHK(14)}Town Hall 12 of 3</span></div><div class="frm fnd"><div class="r2c"><label class="fld2" style="flex:1"><span>Name <small class="mut">3–30 letters</small></span><span class="fin3 ph0">e.g. Iron Wolves</span></label><label class="fld2" style="width:120px"><span>Tag <small class="mut">2–6</small></span><span class="fin3 ph0">IRW</span></label></div><div class="fld2"><span>Who may join</span><div class="seg3"><span>Open</span><span class="on">By application</span><span>Invite only</span></div></div>${compact ? '' : '<label class="fld2"><span>About <small class="mut">optional</small></span><span class="fin3 ph0">What your tribe is about</span></label>'}<span class="btn g">${ic('tribe', 18)}Found tribe</span></div></div>`;
  const NT_CSS = `
.ttag.nt{background:var(--surface-3);border-color:var(--c-ink)}
.tst small{font:600 13px/1.2 var(--font);color:var(--on-surface-muted)}
.dmi{min-width:250px}.dmr{display:flex;align-items:center;gap:10px}.dmr b{font:700 15px/1.2 var(--font)!important;white-space:nowrap}.dmb2{position:relative;flex:1;height:20px}.dmb2 s{position:absolute;left:0;right:0;top:4px;height:12px;border-radius:99px;border:2px solid var(--c-ink);background:var(--surface-3);overflow:hidden}.dmb2 i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:var(--c-moss)}.dmb2 em{position:absolute;top:0;bottom:0;width:3px;margin-left:-1.5px;background:var(--c-ink);border-radius:2px}
.dmi .lk{position:absolute;right:12px;top:8px}.dmi{position:relative}
.tlt{width:100%;border-collapse:collapse}.tlt th{height:36px;padding:0 14px;text-align:left;font:700 13px/1.2 var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--on-surface-muted);background:var(--surface-2);border-bottom:2px solid var(--edge-soft);white-space:nowrap}
.tlt td{height:49px;padding:0 14px;border-top:1px solid var(--edge-soft);font:500 15px/1.2 var(--font);white-space:nowrap}.tlt tbody tr:first-child td{border-top:0}.tlt .n{text-align:right}.tlt td b{font-weight:700}.tlt tr.sel td{background:var(--c-sun-hi)}
.tlt .tn{display:inline-flex;align-items:center;gap:10px}.tlt .tn b{color:var(--link)}.rkn2{font:700 15px/1.2 var(--font);color:var(--on-surface-muted)}
.mbr{display:inline-flex;align-items:center;gap:8px}.mbr .bar{width:54px;height:7px}.mbr .bar i{background:var(--c-teal)}
.rq{font:600 13.5px/1.2 var(--font);color:var(--on-surface-muted)}
.ivr{display:flex;align-items:center;gap:12px;min-height:64px;padding:8px 18px;border-top:1px solid var(--edge-soft)}.ph+.ivr{border-top:0}.ivr .mt b{font:700 15.5px/1.3 var(--font)}.ivr .mt small{font-size:13.5px}
.ttg2{display:grid;place-items:center;width:52px;height:38px;border-radius:10px;background:var(--dark);color:var(--on-dark);font:400 15px/1.3 var(--font-display);flex:none}
.fnd{gap:12px;padding:14px 18px 16px}.r2c{display:flex;gap:10px}.fnd .fin3{height:44px}.fld2 small{font:500 13px/1.2 var(--font)}`;
  {
    const list = `<div class="pn" style="flex:1"><div class="ph p2"><h2>Find a tribe</h2><span class="cnt">38</span><span class="sp"></span><span class="xsr" style="width:300px">${SRCH}Name or tag</span></div><table class="tlt"><thead><tr><th style="width:64px">Rank</th><th>Tribe</th><th>Members</th><th class="n">Points</th><th>Who may join</th><th class="n" style="width:130px"></th></tr></thead><tbody>${TL.map((t) => { const [r, tag, n, m, p, rc, st] = t; return `<tr class="${st === 'invited' ? 'sel' : ''}"><td><span class="rkn2">#${r}</span></td><td><span class="tn"><span class="ttg2">${tag}</span><b>${n}</b></span></td><td><span class="mbr"><b>${m}</b><span class="mut">/ 30</span><span class="bar"><i style="width:${Math.round((m / 30) * 100)}%"></i></span></span></td><td class="n"><b>${fmt(p)}</b></td><td><span class="rq">${RECR[rc]}</span></td><td class="n">${act(t)}</td></tr>`; }).join('')}</tbody></table><div class="pgr"><span class="mut">1–10 of 38 tribes · click a name for its page</span><span class="sp"></span><span class="pg-b off">${chev(16, 'l')}</span><span class="pg-b">${chev(16, 'r')}</span></div></div>`;
    const inv = `<div class="pn"><div class="ph p2"><h2>Your invitations</h2><span class="cnt">2</span></div>${INV.map(([t, n, by, l]) => `<div class="ivr"><span class="ttg2">${t}</span><span class="mt"><b>${n}</b><small>from ${by} · ${l}</small></span><span class="btn g sm">Accept</span><span class="btn sm">Decline</span></div>`).join('')}</div>`;
    const apps = `<div class="pn"><div class="ph p2"><h2>Your applications</h2><span class="cnt">1 / 3</span></div><div class="ivr"><span class="ttg2">HLW</span><span class="mt"><b>Hollow Watch</b><small>sent yesterday · waiting for an answer</small></span><span class="btn sm">Withdraw</span></div></div>`;
    page('notribe-a-1440', 'tribe', `<main class="sheetA" style="display:flex;flex-direction:column">${head(`${stat('Tribes', '38')}${stat('Invitations', '2')}${stat('Applications', '1 / 3')}${domMini}`)}<div class="tb2" style="margin-top:8px">${list}<div class="col" style="width:470px;flex:none">${inv}${apps}${found(true)}</div></div></main>`, NT_CSS);
  }
  {
    // B · list | the picked tribe's page with the Apply message | invitations and Found a tribe.
    const list = `<div class="pn" style="width:420px;flex:none"><div class="ph p2"><h2>Find a tribe</h2><span class="sp"></span><span class="cnt">38</span></div><div style="padding:10px 12px"><span class="xsr">${SRCH}Name or tag</span></div>${TL.slice(0, 9).map((t) => { const [r, tag, n, m, , rc, st] = t; return `<div class="tl4${st === 'sel' ? ' on' : ''}"><span class="rkn2">#${r}</span><span class="ttg2">${tag}</span><span class="mt"><b>${n}</b><small>${m} / 30 · ${RECR[rc]}</small></span>${st === 'invited' ? '<span class="tag tl">Invited</span>' : st === 'applied' ? '<span class="tag won">Applied</span>' : st === 'full' ? '<span class="tag mut">Full</span>' : ''}${chev(14)}</div>`; }).join('')}</div>`;
    const pub = `<div class="pn" style="flex:1"><div class="pbh"><span class="ttag">MRL</span><span class="trn"><b>Marsh Lords</b><small>By application · founded 12 Oct · leader Halvard</small></span></div><div class="pbs">${[['Rank', '#5'], ['Points', '52,875'], ['Members', '22 / 30'], ['Villages', '31']].map(([l, v]) => `<div><span class="up">${l}</span><b>${v}</b></div>`).join('')}</div><p class="pab">We hold the marshes south of the river. We play in the evenings, answer every call for support and raid abandoned villages only. Officers read every application within a day.</p><div class="pbm"><span class="up">Top members</span>${[['Halvard', 'leader', '11,240'], ['Merrow', 'officer', '10,975'], ['Dagny', 'member', '7,960']].map(([n, r, p]) => `<span class="pmr">${av(n, 30)}<b>${n}</b>${ROLE(r)}<span class="sp"></span><b>${p}</b></span>`).join('')}</div><div class="apf"><div class="fld2"><span>Your application to Marsh Lords</span><span class="fin3 ta2">I'm at 412|388, Town Hall 12, Wall 9. Active every evening and happy to send support.<span class="caret" style="margin-left:1px"></span></span></div><div class="apb"><span class="mut">86 / 300</span><span class="mut">· 1 of 3 open used</span><span class="sp"></span><span class="btn">Cancel</span><span class="btn g">Send application</span></div></div></div>`;
    const inv = `<div class="pn"><div class="ph p2"><h2>Invitations</h2><span class="cnt">2</span></div>${INV.map(([t, n, by, l]) => `<div class="ivr iv2"><span class="ttg2">${t}</span><span class="mt"><b>${n}</b><small>from ${by} · ${l}</small></span></div><div class="ivb"><span class="btn g sm">Accept</span><span class="btn sm">Decline</span></div>`).join('')}</div>`;
    page('notribe-b-1440', 'tribe', `<main class="sheetA" style="display:flex;flex-direction:column">${head(`${stat('Applications', '1 / 3')}${domMini}`)}<div class="tb2" style="margin-top:8px">${list}${pub}<div class="col" style="width:400px;flex:none">${inv}${found(false)}</div></div></main>`, `${NT_CSS}
.tl4{display:flex;align-items:center;gap:10px;height:56px;padding:0 12px;border-top:1px solid var(--edge-soft)}.tl4 .rkn2{width:30px}.tl4 .mt b{font-size:15px}.tl4>svg{color:var(--on-surface-muted)}.tl4.on{background:var(--c-sun-hi)}
.pbh{display:flex;align-items:center;gap:14px;padding:14px 18px 10px}.pbh .trn b{font-size:26px}
.pbs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 18px}.pbs>div{display:flex;flex-direction:column;gap:3px;padding:8px 12px;border-radius:12px;background:var(--surface-2)}.pbs b{font:400 19px/1.3 var(--font-display);color:var(--heading)}
.pab{padding:12px 18px 6px;font:500 15px/1.5 var(--font)}
.pbm{display:flex;flex-direction:column;gap:2px;padding:6px 18px 8px}.pmr{display:flex;align-items:center;gap:10px;height:42px;border-top:1px solid var(--edge-soft)}.up+.pmr{border-top:0}.pmr b{font:700 14.5px/1.2 var(--font)}
.apf{display:flex;flex-direction:column;gap:10px;margin:auto 14px 14px;padding:14px 16px;border-radius:14px;background:var(--surface-2);border:2px solid var(--edge-soft)}.ta2{display:block;height:auto;min-height:72px;padding:10px 14px;white-space:normal;line-height:1.45;border-color:var(--c-ink)!important;box-shadow:0 0 0 3px var(--c-sun-hi)}
.apb{display:flex;align-items:center;gap:8px;font:600 13.5px/1.2 var(--font);white-space:nowrap}
.iv2{border-top:1px solid var(--edge-soft);min-height:56px;padding-bottom:0}.ivb{display:flex;gap:8px;padding:6px 18px 12px 82px}`);
  }

  // ---- Domination (GAME_DESIGN 18.1): one tribe owns >= 75% of all village points owned by players, for 14 days in a row, once the
  // world is 180 days old and enough players are active (max(50, 30% of the peak)). Allies do not add up; abandoned villages do not count.
  // Status in this picture: world 38 days old, 451 active of 154 needed (peak 512), leader ASH 18.6%, no streak.
  const DT = [['ASH', 'Ashen Pact', 18.6, 98450, 'c-sun'], ['THN', 'Thornmark', 15.9, 84120, 'c-teal-hi'], ['CND', 'Cinder Band', 13.5, 71300, 'c-terra-hi'], ['GWO', 'Greywater Oath', 11.5, 60940, 'c-leaf'], ['MRL', 'Marsh Lords', 10.0, 52875, 'c-dust']];
  const COND = [
    ['World age', '38 of 180 days', 38 / 180, 0, 'Domination cannot count before the world is 180 days old.'],
    ['Active players', '451 of 154 needed', 1, 1, 'At least 50, and at least 30% of the most the world ever had (512).'],
    ['One tribe holds 75%', 'leader has 18.6%', 18.6 / 75, 0, 'Only one tribe counts: allies do not add up. Abandoned villages are left out.'],
    ['Held 14 days in a row', 'no streak running', 0, 0, 'Starts when all of the above are true; stops the moment one fails.'],
  ];
  const rkHead = () => `<div class="rkh"><span class="rkt"><span class="tk r" style="width:44px;height:44px">${ic('ranks', 26)}</span><h1>Rankings</h1></span><nav class="sbt2 rks">${['Players', 'Tribes', 'Renown', 'Domination'].map((l) => `<span class="st2${l === 'Domination' ? ' on' : ''}">${l}</span>`).join('')}</nav><span class="sp"></span><span class="mut" style="font:600 14px/1.2 var(--font)">updated 4 min ago</span></div>`;
  const END = [['Orders close', 'No more sends, builds or training. Mail, tribe chat and forum stay open; armies on the way still land.', 'warning'], ['Final tables', 'The tribe and player rankings are saved for good at that moment.', 'ranks'], ['Badges', 'Champion for the winning tribe, Second and Third tribe, Top 10 players, Veteran for everyone still holding a village.', 'renown'], ['Hall of Fame', 'The top three tribes and players of the world are listed there.', 'flame']];
  const DOM_CSS = `
.rkh{display:flex;align-items:center;gap:14px;height:56px;flex:none}.rkt{display:flex;align-items:center;gap:12px}.rkt h1{font:400 26px/1.35 var(--font-display);color:var(--heading);padding-top:2px}
.sbt2.rks{margin:0 0 0 8px}.rks .st2{padding:0 22px 1px;font-size:15px}
.cd4{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:13px;background:var(--surface-2)}.cd4 .mk{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;border:2.5px solid var(--c-ink);background:var(--surface);flex:none;font:700 15px/1 var(--font)}.cd4.ok .mk{background:var(--c-moss);color:#fff}
.cd4 .mt b{font:700 15.5px/1.25 var(--font)}.cd4 .mt small{white-space:normal;font:500 13.5px/1.35 var(--font)}.cd4 .cv{display:flex;flex-direction:column;align-items:flex-end;gap:5px;width:150px;flex:none}.cd4 .cv b{font:700 14.5px/1.2 var(--font);white-space:nowrap}.cd4 .cv .bar{width:100%;height:8px}.cd4 .cv .bar i{background:var(--c-teal)}.cd4.ok .cv .bar i{background:var(--c-moss)}
.en{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--edge-soft)}.en:first-child{border-top:0}.en .mt b{font:700 15px/1.25 var(--font)}.en .mt small{white-space:normal;font:500 13.5px/1.4 var(--font)}
.ttg3{display:grid;place-items:center;width:58px;height:40px;border-radius:10px;border:2.5px solid var(--c-ink);font:400 16px/1.3 var(--font-display);color:var(--c-ink);flex:none}`;
  {
    // A · the race: five tribes as long bars against the 75% line | what must be true | what happens at the end.
    const race = `<div class="pn" style="flex:1"><div class="ph p2"><h2>The race to 75%</h2><span class="sp"></span><span class="sub2">share of all village points owned by players</span></div><div class="rc2"><div class="rsc"><span style="left:0">0%</span><span style="left:25%">25%</span><span style="left:50%">50%</span><span class="w" style="left:75%">75% wins</span><span style="left:100%">100%</span></div>${DT.map(([t, n, s, p, c], i) => `<div class="rr"><span class="ttg3" style="background:var(--${c})">${t}</span><span class="mt"><b>${n}</b><small>${fmt(p)} points</small></span><span class="rtk"><s><i style="width:${s}%;background:var(--${c})"></i></s><em></em></span><b class="rpc">${s}%</b></div>`).join('')}<div class="rr you"><span class="ttg3" style="background:var(--surface-3)">EMB</span><span class="mt"><b>Embers of the Fold</b><small>your tribe · rank 7</small></span><span class="rtk"><s><i style="width:7.8%;background:var(--c-sun-hi)"></i></s><em></em></span><b class="rpc">7.8%</b></div>
</div></div>`;
    const conds = `<div class="pn"><div class="ph p2"><h2>All four must be true</h2><span class="sp"></span><span class="tag mut">1 of 4</span></div><div class="cds">${COND.map(([l, v, f, ok, why]) => `<div class="cd4${ok ? ' ok' : ''}"><span class="mk">${ok ? CHK(16) : '•'}</span><span class="mt"><b>${l}</b><small>${why}</small></span><span class="cv"><b>${v}</b><span class="bar"><i style="width:${Math.max(3, Math.round(f * 100))}%"></i></span></span></div>`).join('')}</div></div>`;
    const end = `<div class="pn"><div class="ph p2"><h2>When a tribe wins</h2><span class="sp"></span><span class="sub2">the world ends</span></div><div class="ens">${END.map(([t, d, i]) => `<div class="en">${ic(i, 26)}<span class="mt"><b>${t}</b><small>${d}</small></span></div>`).join('')}</div></div>`;
    page('domination-a-1440', 'ranks', `<main class="sheetA" style="display:flex;flex-direction:column;gap:10px">${rkHead()}<div class="tb2"><div class="col" style="flex:1">${race}${end}</div><div class="col" style="width:520px;flex:none">${conds}<div class="rnote">${ic('shield', 22)}<span>The leader needs <b>56.4 more points of share</b> to reach the line. Any number of tribes can fight it; only its own villages count.</span></div></div></div></main>`, `${DOM_CSS}
.rc2{display:flex;flex-direction:column;gap:6px;padding:10px 18px 12px;flex:1}
.rsc{position:relative;height:22px;margin-left:308px;margin-right:72px;font:600 13px/1.2 var(--font);color:var(--on-surface-muted)}.rsc span{position:absolute;top:2px;transform:translateX(-50%);white-space:nowrap}.rsc span:first-child{transform:none}.rsc span:last-child{transform:translateX(-100%)}.rsc .w{color:var(--heading);font-weight:700}
.rr{display:flex;align-items:center;gap:12px;height:47px}.rr .mt{flex:none;width:226px}.rr .mt b{font-size:16px}
.rtk{position:relative;flex:1;height:40px}.rtk s{position:absolute;left:0;right:0;top:7px;height:26px;border-radius:99px;background:var(--surface-3);border:2px solid var(--c-ink);overflow:hidden}.rtk i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;border-right:2px solid var(--c-ink)}.rtk em{position:absolute;left:75%;top:0;bottom:0;width:4px;margin-left:-2px;background:var(--c-ink);border-radius:2px}
.rpc{width:60px;text-align:right;font:400 20px/1.3 var(--font-display);color:var(--heading)}
.rr.you{background:var(--c-sun-hi);border-radius:14px;padding:0 0 0 8px;margin:0 -8px}.rr.you .rpc{margin-right:8px}
.rnote{display:flex;align-items:center;gap:10px;margin-top:auto;padding:12px 14px;border-radius:12px;background:var(--info-bg);font:500 15px/1.4 var(--font)}
.cds{display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.ens{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;padding:4px 18px 8px}.ens .en{border-top:0;padding:8px 0}
.cds{flex:1;justify-content:space-between}.rnote{margin-top:0}`);
  }
  {
    // B · the road: the whole world in one bar (each tribe's slice) with the 75% line, then four stepping stones to the end.
    const others = 100 - DT.reduce((a, t) => a + t[2], 0) - 7.8;
    const world = `<div class="pn"><div class="ph p2"><h2>Who owns the world</h2><span class="sp"></span><span class="sub2">all village points owned by players = 529,300 · abandoned villages not counted</span></div><div class="wb"><div class="wbw"><div class="wbar">${DT.map(([t, , s, , c]) => `<span style="width:${s}%;background:var(--${c})"><b>${t}</b>${s}%</span>`).join('')}<span style="width:7.8%;background:var(--c-sun-hi)"><b>EMB</b>7.8%</span><span class="oth" style="width:${others.toFixed(1)}%"><b>31 other tribes and players without a tribe</b>${others.toFixed(1)}%</span></div><em style="left:75%"><i>75% line</i></em></div><div class="wnote">To win, <b>one</b> tribe's own slice must reach the line by itself. Today the biggest, <b>Ashen Pact</b>, has 18.6%.</div></div></div>`;
    const STEPS = [['World is 180 days old', '38 of 180 days', 'about 142 days to go', 38 / 180, 0], ['Enough active players', '451 active', '154 needed · 30% of peak 512', 1, 1], ['One tribe reaches 75%', 'ASH 18.6%', 'needs 56.4 points more', 18.6 / 75, 0], ['Holds it 14 days in a row', 'not started', 'starts when 1–3 are true', 0, 0]];
    const road = `<div class="pn"><div class="ph p2"><h2>The road to the end of the world</h2><span class="sp"></span><span class="sub2">checked every 15 minutes</span></div><div class="road">${STEPS.map(([t, v, s, f, ok], i) => `<div class="stn${ok ? ' ok' : ''}"><span class="sn2">${ok ? CHK(20) : i + 1}</span><b class="st3">${t}</b><span class="sv">${v}</span><span class="bar"><i style="width:${Math.max(3, Math.round(f * 100))}%"></i></span><small>${s}</small></div>${i < 3 ? `<span class="arr">${chev(22)}</span>` : ''}`).join('')}<span class="arr">${chev(22)}</span><div class="stn fin"><span class="sn2">${ic('flame', 24)}</span><b class="st3">World ends</b><span class="sv">winner named</span><small>see below</small></div></div></div>`;
    const end = `<div class="pn" style="flex:1"><div class="ph p2"><h2>When a tribe wins</h2><span class="sp"></span><span class="sub2">the world ends and stays readable</span></div><div class="eg">${END.map(([t, d, i]) => `<div class="en2">${ic(i, 28)}<span class="mt"><b>${t}</b><small>${d}</small></span></div>`).join('')}</div></div>`;
    page('domination-b-1440', 'ranks', `<main class="sheetA" style="display:flex;flex-direction:column;gap:10px">${rkHead()}${world}${road}${end}</main>`, `${DOM_CSS}
.wb{padding:12px 18px 12px}.wbar{position:relative;display:flex;height:58px;border-radius:14px;border:2.5px solid var(--c-ink);overflow:visible;background:var(--surface-3)}
.wbar>span{display:flex;flex-direction:column;justify-content:center;padding:0 8px;border-right:2px solid var(--c-ink);font:600 13px/1.2 var(--font);white-space:nowrap;overflow:hidden;min-width:0}.wbar>span:first-child{border-radius:11px 0 0 11px}.wbar>span b{font:700 14px/1.2 var(--font)}
.wbar>span.oth{border-right:0;border-radius:0 11px 11px 0;background:repeating-linear-gradient(135deg,var(--surface-3) 0 8px,var(--surface-2) 8px 16px);color:var(--on-surface-muted)}
.wbw{position:relative;padding:12px 0}.wbw em{position:absolute;top:0;bottom:0;width:5px;margin-left:-2.5px;background:var(--c-ink);border-radius:3px}.wbw em i{position:absolute;left:8px;top:-2px;font:700 13px/1.2 var(--font);font-style:normal;white-space:nowrap;background:var(--surface);padding:0 4px;border-radius:4px}
.wnote{margin-top:10px;font:500 15px/1.4 var(--font)}
.road{display:flex;align-items:stretch;gap:6px;padding:12px 14px}.stn{flex:1;display:flex;flex-direction:column;gap:5px;padding:10px 14px;border-radius:14px;background:var(--surface-2);border:2px solid var(--edge-soft);min-width:0}
.stn .sn2{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;border:2.5px solid var(--c-ink);background:var(--surface);font:700 16px/1 var(--font)}.stn.ok .sn2{background:var(--c-moss);color:#fff}.stn.ok{background:var(--ok-bg);border-color:#b9d48e}
.st3{font:700 15px/1.25 var(--font)}.sv{font:400 19px/1.3 var(--font-display);color:var(--heading)}.stn small{font:500 13px/1.3 var(--font);color:var(--on-surface-muted)}.stn .bar{height:8px}.stn .bar i{background:var(--c-teal)}.stn.ok .bar i{background:var(--c-moss)}
.stn.fin{flex:.7;background:var(--c-sun-hi);border-color:var(--c-ink)}.stn.fin .sn2{background:var(--c-sun)}
.arr{display:grid;place-items:center;color:var(--on-surface-muted);flex:none}
.dtr{min-height:46px;padding:4px 18px}.dtr .ttg3{width:54px;height:34px;font-size:14px}.dtr .mt b{font-size:15px}.dsh{font:400 18px/1.3 var(--font-display);width:64px;text-align:right}
.eg{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:12px 16px 16px;flex:1}.en2{flex-direction:column}.en2 .mt b{font-size:17px!important}.en2 .mt small{font-size:14.5px!important}.en2{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:var(--surface-2)}.en2 .mt b{font:700 15px/1.25 var(--font)}.en2 .mt small{white-space:normal;font:500 13.5px/1.4 var(--font)}`);
  }

  function writeRaw(name, html) { writeFileSync(join(MOCK, name + '.html'), html); }
}
