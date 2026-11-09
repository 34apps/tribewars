// Ranks and Map pages in the mix frame (A's top bar + folder tabs, full width, no village column): two options each.
//   a-ranks-1440 / b-ranks-1440   a-map-1440 / b-map-1440
// Called from gen.mjs (inside its Mix block) with the shared helpers. Content follows today's client only:
//   Ranks = views/RankingsView.tsx (Players / Tribes / Renown, podium, tiles, search, Jump to me, 20 per page, Sample data,
//           player sheet facts + Show on map / View tribe, compact Domination bar with Details).
//   Map   = views/MapView.tsx + map/TilePanel.tsx (zoom in / out, centre on my village, go to x|y; map key button, closed;
//           selected tile: stage card, Location / Distance / Terrain / Strength, mission switch, troop groups, units at home,
//           Strike offer, Simulate, Travel / Arrives / Carry, Send attack).
// The map picture is drawn from the game's own map sprites (copied to mockups/map/) the way map/render.ts places them.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));

export default function ranksMap(h) {
  const { write, topA, tabRowA, ic, chev, xI, fmt, pt, MIX_CSS, T_CSS, TT_CSS } = h;
  const page = (name, act, body, css) => write(name, 'A', `${topA()}${tabRowA(act)}${body}`, `${MIX_CSS}${T_CSS}${TT_CSS}${css}`);

  /* ============================== RANKS ============================== */
  const TRIBES = { ASH: 'Ashen Pact', THN: 'Thornmark', CND: 'Cinder Band', GWO: 'Greywater Oath', MRL: 'Marsh Lords', EMB: 'Embers of the Fold', HLW: 'Hollow Watch' };
  // Page 1 (ranks 1–20): name, tribe tag, villages, points
  const TOP = [['Brannoch', 'ASH', 9, 14920], ['Ysolde_K', 'THN', 8, 13605], ['Tolvek', 'CND', 7, 12880], ['Halvard', 'ASH', 7, 11240], ['Merrow', 'GWO', 6, 10975], ['Ironhart', null, 6, 10410], ['Fennick', 'THN', 5, 9860], ['Odalys', 'CND', 5, 9325], ['Gerrit', 'MRL', 5, 8990], ['Quillon', 'HLW', 5, 8415], ['Dagny', 'GWO', 4, 7960], ['Sorrel', 'ASH', 4, 7530], ['Lorcan', null, 4, 7105], ['Maerwen', 'EMB', 4, 6840], ['Ashby_J', 'THN', 4, 6610], ['Vey', 'CND', 3, 6215], ['Corwin', 'EMB', 3, 5920], ['Hesketh', 'HLW', 3, 5680], ['Saffi', 'EMB', 3, 5410], ['Tamberlin', 'MRL', 3, 5265]];
  // Page 11 (ranks 201–220) after "Jump to me": Rowan (you) is #214
  const P11N = ['Aldric_7', 'Bexley', 'Caddock', 'Dorran', 'Elsin', 'Faro', 'Gwyl', 'Hesper', 'Idris_B', 'Jory', 'Kellan', 'Liesl', 'Mabon', 'Rowan', 'Nessa', 'Oskar_W', 'Perrin', 'Rhosyn', 'Sten', 'Tamsin'];
  const P11T = ['GWO', null, 'MRL', 'HLW', null, 'THN', null, 'CND', 'ASH', null, 'MRL', null, 'HLW', 'EMB', null, 'GWO', null, 'THN', null, null];
  const P11 = P11N.map((n, i) => [n, P11T[i], i % 5 === 2 ? 2 : 1, n === 'Rowan' ? 1284 : Math.round(1352 - i * 5.25 - (i > 13 ? 1 : 0)), n === 'Rowan']);
  const medal = (r) => (r <= 3 ? `<span class="md g${r}">${r}</span>` : `<span class="rkn">${r}</span>`);
  const tribeCell = (t) => (t ? `<span class="ttl">[${t}]</span>` : '<span class="mut">—</span>');
  const row = (r, [n, t, v, p, me]) => `<tr class="${me ? 'me' : ''}"><td class="c-r">${medal(r)}</td><td><span class="pn2"><b>${n}</b>${me ? '<span class="tag dk you">you</span>' : ''}</span></td><td>${tribeCell(t)}</td><td class="n">${v}</td><td class="n"><b>${fmt(p)}</b></td></tr>`;
  const thead = `<thead><tr><th class="c-r">Rank</th><th>Player</th><th>Tribe</th><th class="n">Villages</th><th class="n">Points</th></tr></thead>`;
  const pages = (cur) => `<span class="pg-b${cur === 1 ? ' off' : ''}">${chev(16, 'l')}</span>${(cur === 1 ? [1, 2, 3, '…', 25] : [1, '…', 10, 11, 12, '…', 25]).map((p) => (p === '…' ? '<span class="pgd">…</span>' : `<span class="pg-b pgn${p === cur ? ' on' : ''}">${p}</span>`)).join('')}<span class="pg-b">${chev(16, 'r')}</span>`;
  const crown = (t, w = 34) => { const f = t === 1 ? '#f2b33d' : t === 2 ? '#d9d5cc' : '#c98a52'; return `<svg width="${w}" height="${Math.round((w * 48) / 64)}" viewBox="0 0 64 48"><path d="M6 40 L2 12 L18 24 L32 6 L46 24 L62 12 L58 40z" fill="${f}" stroke="#2b211c" stroke-width="3" stroke-linejoin="round"/><rect x="6" y="40" width="52" height="6" rx="2" fill="${f}" stroke="#2b211c" stroke-width="3"/><circle cx="32" cy="30" r="3" fill="#c4623a" stroke="#2b211c" stroke-width="1.5"/></svg>`; };
  const podium = (w) => `<div class="pod">${[1, 0, 2].map((i) => { const [n, t, , p] = TOP[i]; return `<div class="plq p${i + 1}" style="width:${w}px">${crown(i + 1, i ? 30 : 36)}<b>${n}</b><small>${fmt(p)} pts</small></div>`; }).join('')}</div>`;
  const header = (jump = true) => `<div class="rkh"><span class="rkt"><span class="tk r" style="width:44px;height:44px">${ic('ranks', 26)}</span><h1>Rankings</h1></span><nav class="sbt2 rks">${[['Players', 1], ['Tribes'], ['Renown']].map(([l, on]) => `<span class="st2${on ? ' on' : ''}">${l}</span>`).join('')}</nav><span class="sp"></span><span class="srch"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 6 6"/></svg>Find a player or tribe tag</span>${jump ? '<span class="btn">Jump to me</span>' : ''}<span class="tgl"><i></i>Sample data</span></div>`;
  const DOM = { lead: 'Ashen Pact [ASH] holds 18.6% of all village points', share: 18.6 };
  const domBar = () => `<div class="dwr"><div class="dbar"><i style="width:${DOM.share}%"></i></div><span class="dln" style="left:75%"></span></div><div class="dsc"><span>0%</span><span>${DOM.share}% now</span><span>100%</span><em style="left:75%">75% wins</em></div>`;
  const RK_CSS = `
.rkh{display:flex;align-items:center;gap:14px;height:56px;flex:none}
.rkt{display:flex;align-items:center;gap:12px}.rkt h1{font:400 26px/1.35 var(--font-display);color:var(--heading);padding-top:2px}
.sbt2.rks{margin:0 0 0 8px}.rks .st2{padding:0 22px 1px;font-size:15px}
.srch{display:flex;align-items:center;gap:9px;width:290px;height:42px;padding:0 14px;border-radius:12px;border:2px solid var(--edge);background:var(--input-bg);font:500 15px/1.2 var(--font);color:#8a7a68;flex:none}.srch svg{color:var(--on-surface-muted)}
.tgl{display:inline-flex;align-items:center;gap:9px;height:40px;font:600 14px/1.2 var(--font);color:var(--on-surface-muted);white-space:nowrap}.tgl i{position:relative;width:44px;height:26px;border-radius:99px;background:var(--surface-3);border:2px solid var(--edge)}.tgl i::after{content:'';position:absolute;left:2px;top:2px;width:18px;height:18px;border-radius:50%;background:#fff;border:2px solid var(--edge)}
.rt3{width:100%;border-collapse:collapse}
.rt3 th{height:36px;padding:0 16px;text-align:left;font:700 13px/1.2 var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--on-surface-muted);background:var(--surface-2);border-bottom:2px solid var(--edge-soft);white-space:nowrap}
.rt3 td{padding:0 16px;border-top:1px solid var(--edge-soft);font:500 15px/1.2 var(--font);white-space:nowrap}.rt3 tbody tr:first-child td{border-top:0}
.rt3 .n{text-align:right}.rt3 td b{font-weight:700}.rt3 .c-r{width:76px}
.rt3 tr.me td{background:var(--c-sun-hi)}
.md{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;border:2px solid var(--c-ink);font:700 14px/1 var(--font);color:var(--c-ink);box-shadow:0 2px 0 var(--c-ink)}.md.g1{background:#f2b33d}.md.g2{background:#d9d5cc}.md.g3{background:#c98a52}
.rkn{display:inline-block;min-width:30px;text-align:center;font:700 15px/1.2 var(--font);color:var(--on-surface-muted)}
.pn2{display:inline-flex;align-items:center;gap:8px}.pn2 b{font:700 15.5px/1.2 var(--font);color:var(--link)}.tag.you{height:22px;padding:0 8px 1px}
.ttl{font:700 14.5px/1.2 var(--font);color:var(--link)}
.pgr .pgd{width:22px;text-align:center;font:700 15px/1 var(--font);color:var(--on-surface-muted)}.pg-b.pgn{font:700 15px/1 var(--font)}.pg-b.pgn.on{background:var(--c-ink);color:var(--on-dark)}
.pod{display:flex;align-items:flex-end;justify-content:center;gap:10px}
.plq{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 6px 9px;border-radius:14px;border:2.5px solid var(--c-ink);background:var(--c-wood-board);box-shadow:inset 0 3px 0 #ddb27a,inset 0 -4px 0 var(--c-wood-line),0 3px 0 var(--c-ink);color:var(--c-ink);white-space:nowrap}
.plq.p1{padding-top:12px;padding-bottom:14px}.plq b{font:400 17px/1.3 var(--font-display)}.plq small{font:700 13px/1.2 var(--font)}
.tl3{display:flex;flex-direction:column;justify-content:center;gap:4px;padding:0 14px;white-space:nowrap;border-radius:12px;background:var(--surface-2)}.tl3 b{font:400 22px/1.3 var(--font-display);color:var(--heading)}.tl3 small{font:600 13px/1.2 var(--font);color:var(--on-surface-muted)}
.dh{display:block;font:700 15.5px/1.25 var(--font);color:var(--heading)}.dl{display:block;font:500 13.5px/1.3 var(--font);color:var(--on-surface-muted);margin-top:3px}
.dwr{position:relative;height:28px;margin-top:10px}.dbar{position:absolute;left:0;right:0;top:5px;height:18px;border-radius:99px;background:var(--surface-3);border:2px solid var(--c-ink);overflow:hidden}.dbar i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:var(--c-moss)}
.dln{position:absolute;top:0;bottom:0;width:4px;margin-left:-2px;background:var(--c-ink);border-radius:2px}
.dsc{position:relative;display:flex;justify-content:space-between;height:18px;margin-top:3px;font:600 13px/1.2 var(--font);color:var(--on-surface-muted)}.dsc em{position:absolute;top:0;transform:translateX(-50%);font:700 13px/1.2 var(--font);font-style:normal;color:var(--heading);white-space:nowrap}`;

  // Ranks A: one sheet; a band with the top three, the three numbers and the Domination bar; then all 20 places of the page in
  // two side-by-side columns of 10 (big rows). Shown after "Jump to me": page 11 with your row lit.
  {
    const half = (from, rows) => `<table class="rt3 big">${thead}<tbody>${rows.map((r, i) => row(from + i, r)).join('')}</tbody></table>`;
    const band = `<div class="band"><div class="pn bnd"><div class="bhd"><h2>Top three</h2></div>${podium(150)}</div>
<div class="pn bnd tls"><div class="tl3"><span class="up">Players</span><b>486</b><small>in this world</small></div><div class="tl3"><span class="up">Top player</span><b>Brannoch</b><small>14,920 pts</small></div><div class="tl3"><span class="up">Average</span><b>1,032</b><small>per player</small></div></div>
<div class="pn bnd dom"><div class="bhd"><h2>Domination</h2><span class="sp"></span><span class="btn sm">Details</span></div><div class="dmb"><span class="dh">No tribe dominates the world</span><span class="dl">${DOM.lead}</span>${domBar()}</div></div></div>`;
    const tbl = `<div class="pn" style="flex:1"><div class="halves">${half(201, P11.slice(0, 10))}${half(211, P11.slice(10))}</div><div class="pgr"><span class="mut">201–220 of 486</span><span class="sp"></span>${pages(11)}</div></div>`;
    page('a-ranks-1440', 'ranks', `<main class="sheetA" style="display:flex;flex-direction:column;gap:12px">${header()}${band}${tbl}</main>`, `${RK_CSS}
.band{display:flex;gap:12px;height:166px;flex:none}.bnd{padding:10px 16px 12px}.bhd{display:flex;align-items:center;gap:10px;height:36px;margin-bottom:6px}.bhd h2{font:400 18px/1.35 var(--font-display);color:var(--heading)}
.bnd:first-child{width:530px;flex:none}.tls{flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:12px}.dom{width:450px;flex:none}
.halves{display:flex;flex:1;min-height:0}.halves table{flex:1}.halves table+table{border-left:2px solid var(--edge-soft)}
.rt3.big td{height:39px}.rt3.big .pn2 b{font-size:16px}`);
  }

  // Ranks B: one long list of 20 (page 1, medals for the top three) and a right column: your own standing (the facts and
  // buttons of today's player sheet, for you), the top-three plaques and the compact Domination bar.
  {
    const tbl = `<div class="pn" style="flex:1"><table class="rt3 lst">${thead}<tbody>${TOP.map((r, i) => row(i + 1, r)).join('')}</tbody></table><div class="pgr"><span class="mut">1–20 of 486 players · average 1,032 points</span><span class="sp"></span>${pages(1)}</div></div>`;
    const facts = [['Points', '1,284'], ['Villages', '1'], ['Renown', '340 · #188'], ['Tribe', '[EMB] · Leader'], ['Joined', '28 Oct'], ['Protection', 'None']];
    const you = `<div class="pn"><div class="ph"><h2>You</h2><span class="sp"></span><span class="mut" style="font:600 13px/1.2 var(--font)">This is you</span></div><div class="yb"><div class="yh"><span class="ring" style="width:56px;height:56px"><img src="avatar.svg" alt=""></span><span class="mt"><b class="yn">Rowan</b><small>Embers of the Fold [EMB]</small></span><span class="yr"><span class="up">Rank</span><b>#214</b><small>of 486</small></span></div><div class="yf">${facts.map(([l, v]) => `<div><span class="up">${l}</span><b>${v}</b></div>`).join('')}</div><div class="yact"><span class="btn g sm">Jump to me</span><span class="btn sm">Show on map</span><span class="btn sm">View tribe</span></div></div></div>`;
    const top3 = `<div class="pn"><div class="ph"><h2>Top three</h2></div><div style="padding:10px 12px 12px">${podium(128)}</div></div>`;
    const dom = `<div class="pn" style="flex:1"><div class="ph"><h2>Domination</h2><span class="sp"></span><span class="btn sm">Details</span></div><div class="dmb" style="padding:8px 16px 10px"><span class="dh">No tribe dominates the world</span><span class="dl">${DOM.lead}</span>${domBar()}</div></div>`;
    const bPage = (name, t3, css = '') => page(name, 'ranks', `<main class="sheetA" style="display:flex;flex-direction:column;gap:12px">${header(false)}<div class="tbody">${tbl}<div class="col" style="width:430px;flex:none">${you}${t3}${dom}</div></div></main>`, `${RK_CSS}
.rt3.lst td{height:29px}.rt3.lst th{height:33px}.rt3.lst .md{width:26px;height:26px;font-size:13.5px;box-shadow:none}
.yb{display:flex;flex-direction:column;gap:10px;padding:10px 16px 12px}.yh{display:flex;align-items:center;gap:12px}.yn{font:400 20px/1.35 var(--font-display)!important}
.yr{display:flex;flex-direction:column;align-items:flex-end;gap:2px;padding:6px 12px;border-radius:12px;background:var(--c-sun-hi)}.yr b{font:400 24px/1.4 var(--font-display);color:var(--heading)}.yr small{font:600 13px/1.2 var(--font);color:var(--on-surface-muted)}
.yf{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.yf div{display:flex;flex-direction:column;gap:4px;padding:6px 10px;border-radius:11px;background:var(--surface-2)}.yf b{font:700 14.5px/1.2 var(--font);white-space:nowrap}
.yact{display:flex;gap:8px}.yact .btn{flex:1}${css}`);
    bPage('b-ranks-1440', top3);

    // Top three redraws for B (owner: today's tan plaques look like heavy buttons). Same column, same data; each name/row
    // opens the player as today. Portraits are the game's chieftain medallions (mockups/chieftains, as in Mail).
    const POR = { Brannoch: 'brannoc-one-eye', Ysolde_K: 'hild-ironveil', Tolvek: 'wren-the-huntress' };
    const por = (n, sz) => `<img class="por" src="chieftains/${POR[n]}.svg" width="${sz}" height="${sz}" alt="">`;
    const T3 = TOP.slice(0, 3).map(([n, t, v, p], i) => ({ r: i + 1, n, t, v, p }));
    const ttag = (t) => `<span class="tag mut">${t}</span>`;
    const card = (body, cls) => `<div class="pn ${cls}"><div class="ph"><h2>Top three</h2><span class="sp"></span><span class="mut" style="font:600 13px/1.2 var(--font)">Points</span></div>${body}</div>`;
    const T3_CSS = `.por{display:block;flex:none}.t3 .tag.mut{height:22px;padding:0 8px 1px;font-size:13px}`;

    // a · mini leaderboard: three calm rows, filled medal, portrait, name + tribe, points right.
    bPage('ranks-top3-a-1440', card(`<div class="t3a">${T3.map(({ r, n, t, p }) => `<div class="t3r"><span class="md g${r}">${r}</span>${por(n, 32)}<b class="t3n">${n}</b>${ttag(t)}<span class="sp"></span><b class="t3p">${fmt(p)}</b></div>`).join('')}</div>`, 't3'), `${T3_CSS}
.t3a{display:flex;flex-direction:column;padding:3px 8px 4px}
.t3r{display:flex;align-items:center;gap:10px;height:38px;padding:0 8px;border-top:1px solid var(--edge-soft)}.t3r:first-child{border-top:0}
.t3a .md{width:26px;height:26px;font-size:13.5px;box-shadow:none}.t3a .t3n{min-width:92px;font:700 15.5px/1.2 var(--font);color:var(--link)}.t3p{font:700 15.5px/1.2 var(--font);color:var(--heading)}`);

    // b · toy podium: three stone steps (2-1-3) in the Toy Diorama look, portraits standing on them, names and points under.
    const TINT = { 1: ['#f7d77f', '#fdf0c4'], 2: ['#dcd8cf', '#f3f1ec'], 3: ['#deae84', '#f5dcc4'] };
    const step = (r, front) => { const w = 120, top = 7, h = top + front + 3, [fc, tc] = TINT[r]; return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="M3 ${top + 1.5}h${w - 6}v${front - 3}q0 3 -3 3h-${w - 12}q-3 0 -3 -3z" fill="${fc}" stroke="#2b211c" stroke-width="2.5" stroke-linejoin="round"/><path d="M8 1.5h${w - 16}l5 ${top}h-${w - 6}z" fill="${tc}" stroke="#2b211c" stroke-width="2.5" stroke-linejoin="round"/><path d="M6 ${top + front - 2}h${w - 12}" stroke="#2b211c" stroke-opacity=".14" stroke-width="3" stroke-linecap="round"/><text x="${w / 2}" y="${top + front / 2 + 6}" text-anchor="middle" font-family="Rubik" font-weight="700" font-size="${r === 1 ? 17 : 15}" fill="#2b211c">${r}</text></svg>`; };
    const FRONT = { 1: 28, 2: 21, 3: 15 }, P1 = 40;
    const podCol = ({ r, n, p }) => `<div class="pc p${r}">${por(n, r === 1 ? P1 : 34)}${step(r, FRONT[r])}<b class="t3n">${n}</b><small>${fmt(p)}</small></div>`;
    bPage('ranks-top3-b-1440', card(`<div class="t3b"><div class="pdm">${[1, 0, 2].map((i) => podCol(T3[i])).join('')}</div></div>`, 't3'), `${T3_CSS}
.t3b{padding:4px 14px 6px}.pdm{position:relative;display:flex;align-items:flex-end;justify-content:center;gap:0}
.pdm::before{content:'';position:absolute;left:6px;right:6px;top:${P1 - 3 + 7 + FRONT[1] - 2}px;height:6px;border-radius:99px;background:var(--c-leaf);opacity:.55}
.pc{position:relative;display:flex;flex-direction:column;align-items:center;width:126px}.pc .por{margin-bottom:-3px;position:relative;z-index:1}.pc svg{display:block}
.pc .t3n{margin-top:4px;font:700 14.5px/1.2 var(--font);color:var(--link)}.pc small{font:600 13px/1.25 var(--font);color:var(--on-surface-muted)}`);

    // c · winner first: #1 big (portrait, name, tribe, points, lead over #2), then #2 and #3 as two small lines.
    const [w1, w2, w3] = T3;
    const small = ({ r, n, t, p }) => `<div class="t3s"><span class="md g${r}">${r}</span>${por(n, 30)}<span class="sm2"><b class="t3n">${n}</b><small>${ttag(t)}${fmt(p)}</small></span></div>`;
    bPage('ranks-top3-c-1440', card(`<div class="t3c"><div class="win"><span class="wp">${por(w1.n, 52)}<span class="md g1">1</span></span><span class="wm"><b class="wn">${w1.n}</b><span class="wt">${ttag(w1.t)}<span>${TRIBES[w1.t]} · ${w1.v} villages</span></span></span><span class="wr"><b>${fmt(w1.p)}</b><small>${fmt(w1.p - w2.p)} ahead</small></span></div><div class="two">${small(w2)}${small(w3)}</div></div>`, 't3'), `${T3_CSS}
.t3c{display:flex;flex-direction:column;gap:2px;padding:7px 10px 2px}
.win{display:flex;align-items:center;gap:12px;height:66px;padding:0 12px 0 8px;border-radius:12px;background:var(--surface-2)}
.wp{position:relative;flex:none}.wp .md{position:absolute;right:-5px;bottom:0;width:24px;height:24px;font-size:13px;box-shadow:none}
.wm{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}.wn{font:400 20px/1.35 var(--font-display);color:var(--link)}
.wt{display:flex;align-items:center;gap:7px;font:500 13px/1.2 var(--font);color:var(--on-surface-muted);white-space:nowrap}
.wr{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex:none}.wr b{font:400 22px/1.35 var(--font-display);color:var(--heading)}.wr small{font:600 13px/1.2 var(--font);color:var(--c-moss-deep)}
.two{display:grid;grid-template-columns:1fr 1fr}.t3s{display:flex;align-items:center;gap:9px;height:46px;padding:0 8px}.t3s+.t3s{border-left:1px solid var(--edge-soft);padding-left:14px}
.t3s .md{width:24px;height:24px;font-size:13px;box-shadow:none}.sm2{display:flex;flex-direction:column;gap:2px;min-width:0}.sm2 .t3n{font:700 15px/1.2 var(--font);color:var(--link)}.sm2 small{display:flex;align-items:center;gap:7px;font:700 14px/1.2 var(--font);color:var(--heading)}`);
  }

  /* ============================== MAP ============================== */
  const T = 84, S = T / 96; // DEFAULT_TILE; sprites are drawn for a 96-wide tile
  const OWN = [412, 388];
  const hsh = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
  const uv = (x, y) => { const dx = x - OWN[0], dy = y - OWN[1]; return [dx - dy, dx + dy]; };
  // Terrain codes as terrain.ts: 0 grass, 1 forest, 2 hills, 3 mountain, 4 lake.
  const FOREST = [[-11, 8, 3.4], [-14, -5, 2.6], [12, -12, 2.4], [14, 9, 2.9], [-3, 17, 2.2], [17, -2, 2]];
  const terr = (x, y) => {
    const [u, v] = uv(x, y); const n = hsh(x, y);
    if (v < -8 && u < -1 && (-v - 8) * 0.55 + (-u - 1) * 0.5 + n * 2.2 > 3.4) return 3;
    if (v < -6 && u < 1 && n < 0.32) return 2;
    if (Math.hypot(u - 5, (v - 5) / 2) < 1.25) return 4;
    for (const [cu, cv, r] of FOREST) if (Math.hypot(u - cu, (v - cv) / 2) < r + n * 0.9) return 1;
    return n < 0.05 ? 2 : 0;
  };
  const TILES = [['tile-grass-0', 'tile-grass-1', 'tile-grass-2', 'tile-grass-3'], ['tile-forest-0', 'tile-forest-1'], ['tile-hills-0'], ['tile-mountain-0', 'tile-mountain-1'], ['tile-lake-0', 'tile-lake-1']];
  const CLEARED = ['tile-grass-0', 'tile-forest-clear', 'tile-hills-clear', 'tile-grass-0', 'tile-grass-0'];
  const STAGE = ['stage-1-hamlet', 'stage-2-palisade-village', 'stage-3-stockade-town', 'stage-4-stone-walled-town', 'stage-5-fortified-town', 'stage-6-castle-with-moat'];
  const RUIN = ['abandoned-stage-1-hamlet', 'abandoned-stage-2-palisade-village', 'abandoned-stage-3-stockade-town', 'abandoned-stage-4-stone-walled-town', 'abandoned-stage-5-fortified-town', 'abandoned-stage-6-castle'];
  const BANNER_BASE = [[25, -6], [18.2, -26.4], [0, -57.8], [15.4, -54.4], [3.4, -66.5], [0, -63.4]];
  const AL = { own: ['#F2B33D', ''], tribe: ['#5E8C3A', ''], ally: ['#2F9AA0', ''], nap: ['#B86C92', '9 5'], enemy: ['#C4623A', ''], neutral: ['#A39E94', '3 5'], abandoned: ['#6E675E', '6 6'] };
  const RING = 'M-5.4 -19.9Q0 -22.6 5.4 -19.9L39.8 -2.7Q45.1 0 39.8 2.7L5.4 19.9Q0 22.6 -5.4 19.9L-39.8 2.7Q-45.1 0 -39.8 -2.7Z';
  const SELECT = 'M-7.2 -22.3Q0 -25.9 7.2 -22.3L44.7 -3.6Q51.8 0 44.7 3.6L7.2 22.3Q0 25.9 -7.2 22.3L-44.7 3.6Q-51.8 0 -44.7 -3.6Z';
  const VIL = [
    { x: 412, y: 388, al: 'own', st: 4, name: 'Emberfold' },
    { x: 409, y: 392, al: 'abandoned', st: 1, sel: 1 },
    { x: 405, y: 381, al: 'enemy', st: 4, tag: 'CND' },
    { x: 415, y: 384, al: 'tribe', st: 5, tag: 'EMB' },
    { x: 418, y: 392, al: 'tribe', st: 3, tag: 'EMB' },
    { x: 403, y: 387, al: 'neutral', st: 3 },
    { x: 412, y: 379, al: 'ally', st: 4, tag: 'ASH' },
    { x: 416, y: 397, al: 'nap', st: 2, tag: 'MRL' },
    { x: 420, y: 387, al: 'neutral', st: 2 },
    { x: 408, y: 387, al: 'abandoned', st: 2 },
    { x: 422, y: 393, al: 'abandoned', st: 3 },
    { x: 406, y: 395, al: 'abandoned', st: 1 },
    { x: 424, y: 381, al: 'enemy', st: 3, tag: 'CND' },
    { x: 399, y: 391, al: 'neutral', st: 1 },
    { x: 426, y: 390, al: 'ally', st: 2, tag: 'ASH' },
    { x: 401, y: 396, al: 'abandoned', st: 2 },
  ];
  const SITES = [{ x: 402, y: 383, k: 'lookout', lab: 'Lookout 2' }, { x: 423, y: 389, k: 'great_fire', lab: 'Great Fire' }, { x: 410, y: 395, k: 'shrine', lab: 'Shrine 3' }, { x: 412, y: 383, k: 'waymark', lab: 'Waymark 1' }];
  const sa = readFileSync(join(here, '../../../../apps/web/src/map/siteArt.ts'), 'utf8').replace(/export interface[\s\S]*?\n}\n/, '').replace(/export /g, '').replace(/: readonly ArtOp\[\]/g, '').replace(/: Record<[^>]*>/g, '');
  const UTIL = new Function(`${sa}; return UTILITY_ART;`)();
  const stone = (x, y, hh) => `<path d="M${x - 6} ${y}L${x - 4.5} ${y - hh + 6}Q${x} ${y - hh - 4} ${x + 4.5} ${y - hh + 6}L${x + 6} ${y}Z" fill="#BDB5A6"/>`;
  const siteArt = (k) => {
    if (k === 'lookout' || k === 'waymark') return `<g stroke="#2B211C" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" fill="none"><ellipse cx="3" cy="4" rx="34" ry="17" fill="rgba(43,33,28,0.28)" stroke="none"/>${UTIL[k].map((o) => `<path d="${o.d}" fill="${o.fill ?? 'none'}" stroke="${o.stroke ?? '#2B211C'}" stroke-width="${o.sw ?? 3}"/>`).join('')}</g>`;
    const great = k === 'great_fire'; const fl = 'M0 -2C-14 -14 -8 -34 0 -50C8 -34 14 -14 0 -2Z';
    return `<g stroke="#2B211C" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><ellipse cx="3" cy="4" rx="34" ry="17" fill="rgba(43,33,28,0.28)" stroke="none"/>${stone(0, -14, 30)}<path d="M-32 -12V0A32 16 0 0 0 32 0V-12A32 16 0 0 1 -32 -12Z" fill="#8E8678"/><ellipse cx="0" cy="-12" rx="32" ry="16" fill="#D8D1C2"/><ellipse cx="0" cy="-12" rx="20" ry="10" fill="#BDB5A6" stroke-width="2"/><path d="M-13 -19Q-12 -4 0 -3Q12 -4 13 -19Z" fill="#5A4A40"/><ellipse cx="0" cy="-19" rx="13" ry="5" fill="#3E3028"/><g transform="translate(0 -19) scale(${great ? 1.2 : 1})"><ellipse cx="0" cy="-17" rx="26" ry="28" fill="rgba(242,179,61,0.26)" stroke="none"/><path d="${fl}" fill="#E0703F"/><path d="${fl}" fill="#F2B33D" stroke="none" transform="scale(0.72)"/><path d="${fl}" fill="#FFF1B8" stroke="none" transform="scale(0.4)"/></g>${stone(-27, -4, 24)}${stone(27, -4, 24)}${great ? `${stone(-14, 9, 18)}${stone(14, 9, 18)}<path d="M-32 -12A32 16 0 0 0 32 -12" fill="none" stroke="#F2B33D"/>` : ''}</g>`;
  };
  // Label pill like render.ts pill(): rounded, ink edge, drop shadow; optional tribe-tag chip.
  const cw = (c) => (/[0-9]/.test(c) ? 7.7 : c === '|' ? 3.4 : c === ' ' ? 3.3 : c === '·' ? 4 : /[A-Z]/.test(c) ? 8.6 : /[il]/.test(c) ? 3.6 : 7.1);
  const tw = (s) => [...s].reduce((a, c) => a + cw(c), 0);
  const pill = (text, cx, cy, bg = '#2B211C', fg = '#FFF8E8', chip) => {
    const w0 = tw(text), cwid = chip ? tw(chip.t) * 0.9 + 12 : 0, hh = 23, w = w0 + 18 + (chip ? cwid + 5 : 0), x = cx - w / 2, y = cy - hh / 2;
    return `<g font-family="Rubik" font-weight="600" font-size="13"><rect x="${x.toFixed(1)}" y="${(y + 2).toFixed(1)}" width="${w.toFixed(1)}" height="${hh}" rx="${hh / 2}" fill="rgba(18,12,9,0.55)"/><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${hh}" rx="${hh / 2}" fill="${bg}" stroke="#2B211C" stroke-width="1.5"/><text x="${(x + 9).toFixed(1)}" y="${(cy + 4.6).toFixed(1)}" fill="${fg}">${text}</text>${chip ? `<rect x="${(x + 9 + w0 + 5).toFixed(1)}" y="${(y + 3).toFixed(1)}" width="${cwid.toFixed(1)}" height="${hh - 6}" rx="${(hh - 6) / 2}" fill="${chip.c}"/><text x="${(x + 9 + w0 + 11).toFixed(1)}" y="${(cy + 4.2).toFixed(1)}" fill="#FFF8E8" font-weight="700" font-size="11.5">${chip.t}</text>` : ''}</g>`;
  };
  const dots = (ax, ay, bx, by, fill, op = 1) => { const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.floor(L / (T * 0.2))); let o = ''; for (let i = 0; i <= n; i++) { const f = 1 - i / n; o += `<circle cx="${(ax + (bx - ax) * f).toFixed(1)}" cy="${(ay + (by - ay) * f).toFixed(1)}" r="3.4" fill="${fill}" stroke="#2B211C" stroke-width="1.3" opacity="${op}"/>`; } return o; };
  const pawn = (x, y, m, color, incoming) => `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" stroke="#2B211C" stroke-width="${(m * 0.06).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"><ellipse cx="${m * 0.08}" cy="${m * 0.06}" rx="${m * 0.52}" ry="${m * 0.2}" fill="rgba(43,33,28,0.3)" stroke="none"/><ellipse rx="${m * 0.44}" ry="${m * 0.18}" fill="${color}"/><path d="M${m * 0.32} ${-m * 0.05}V${-m * 1.45}" stroke-width="${m * 0.084}"/><path d="M${m * 0.34} ${-m * 1.45}L${m * 0.8} ${-m * 1.3}L${m * 0.34} ${-m * 1.12}Z" fill="${color}"/><rect x="${-m * 0.24}" y="${-m * 0.88}" width="${m * 0.48}" height="${m * 0.82}" rx="${m * 0.2}" fill="${color}"/><rect x="${-m * 0.22}" y="${-m * 0.5}" width="${m * 0.44}" height="${m * 0.1}" fill="#714B29" stroke="none"/><circle cy="${-m * 1.02}" r="${m * 0.21}" fill="#F3BE95"/><path d="M${-m * 0.23} ${-m * 1.06}A${m * 0.23} ${m * 0.23} 0 0 1 ${m * 0.23} ${-m * 1.06}Z" fill="#A39E94"/>${incoming ? `<circle cx="${-m * 0.44}" cy="${-m * 1.25}" r="${m * 0.2}" fill="#C4623A"/><text x="${-m * 0.44}" y="${-m * 1.25 + m * 0.11}" fill="#FFF8E8" stroke="none" font-family="Rubik" font-weight="700" font-size="${Math.round(m * 0.3)}" text-anchor="middle">!</text>` : ''}</g>`;
  // The map picture: W x H, centred on the world point (OWN + offset), drawn back to front row by row like render.ts.
  const isoMap = (W, H, o = {}) => {
    const [cu, cv] = o.c || [0, 0];
    const sx = (u, v) => [W / 2 + ((u - cu) * T) / 2, H / 2 + ((v - cv) * T) / 4];
    const vk = (x, y) => `${x}|${y}`;
    const vmap = new Map(VIL.map((v) => [vk(v.x, v.y), v])); const smap = new Map(SITES.map((s) => [vk(s.x, s.y), s]));
    const uMin = Math.floor(cu - W / T - 2), uMax = Math.ceil(cu + W / T + 2), vMin = Math.floor(cv - (2 * H) / T - 3), vMax = Math.ceil(cv + (2 * H) / T + 6);
    let g = '';
    const labels = [];
    for (let v = vMin; v <= vMax; v++) {
      for (let u = uMin; u <= uMax; u++) {
        if (((u + v) & 1) !== 0) continue;
        const x = OWN[0] + (u + v) / 2, y = OWN[1] + (v - u) / 2; const [px, py] = sx(u, v);
        if (px < -60 || px > W + 60 || py < -50 || py > H + 90) continue;
        const code = terr(x, y); const key = vk(x, y);
        const name = vmap.has(key) || smap.has(key) ? CLEARED[code] : TILES[code][Math.floor(hsh(x + 3, y + 7) * TILES[code].length)];
        g += `<image href="map/${name}.svg" x="${(px - 48 * S).toFixed(1)}" y="${(py - 80 * S).toFixed(1)}" width="${(96 * S).toFixed(1)}" height="${(120 * S).toFixed(1)}"/>`;
      }
      for (let u = uMin; u <= uMax; u++) {
        if (((u + v) & 1) !== 0) continue;
        const x = OWN[0] + (u + v) / 2, y = OWN[1] + (v - u) / 2; const [px, py0] = sx(u, v); const key = vk(x, y);
        const vil = vmap.get(key), site = smap.get(key);
        if (!vil && !site) continue;
        const py = py0 - (terr(x, y) === 2 ? 12 * S : 0);
        if (px < -80 || px > W + 80 || py < -60 || py > H + 120) continue;
        if (site) { g += `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) scale(${S})">${siteArt(site.k)}</g>`; labels.push(pill(site.lab, px, py + 24)); continue; }
        const ab = vil.al === 'abandoned'; const [col, dash] = AL[vil.al];
        if (vil.sel) g += `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) scale(${S})"><path d="${SELECT}" fill="rgba(255,220,122,0.35)" stroke="#2B211C" stroke-width="7"/><path d="${SELECT}" fill="none" stroke="#F2B33D" stroke-width="4"/></g>`;
        g += `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) scale(${S})" fill="none" stroke-linejoin="round">${ab ? `<path d="${RING}" transform="scale(0.94)" stroke="rgba(110,103,94,0.9)" stroke-width="2.6" stroke-dasharray="${dash}"/>` : `<path d="${RING}" stroke="rgba(255,248,232,0.95)" stroke-width="6.5" stroke-dasharray="${dash}"/><path d="${RING}" stroke="${col}" stroke-width="3.6" stroke-dasharray="${dash}"/>`}</g>`;
        g += `<image href="map/${(ab ? RUIN : STAGE)[vil.st - 1]}.svg" x="${(px - 64 * S).toFixed(1)}" y="${(py - 116 * S).toFixed(1)}" width="${(128 * S).toFixed(1)}" height="${(156 * S).toFixed(1)}"/>`;
        if (!ab) { const b = BANNER_BASE[vil.st - 1], k = 1.15 * S; g += `<image href="map/banner-${vil.al}.svg" x="${(px + b[0] * S - 14 * k).toFixed(1)}" y="${(py + b[1] * S - 50 * k).toFixed(1)}" width="${(48 * k).toFixed(1)}" height="${(56 * k).toFixed(1)}"/>`; }
        if (vil.sel) g += `<g transform="translate(${px.toFixed(1)} ${(py - 38 * S - 14).toFixed(1)})"><path d="M-11 -10H11L0 5Z" fill="#F2B33D" stroke="#2B211C" stroke-width="2.4" stroke-linejoin="round"/></g>`;
        const lab = vil.al === 'own' ? `${vil.name} ${vil.x}|${vil.y}` : `${vil.x}|${vil.y}`;
        labels.push(vil.al === 'own' ? pill(lab, px, py + 27, '#F2B33D', '#2B211C') : pill(lab, px, py + 25, vil.sel ? '#F2B33D' : '#2B211C', vil.sel ? '#2B211C' : '#FFF8E8', vil.tag ? { t: vil.tag, c: col } : null));
      }
    }
    const P = (x, y) => sx(...uv(x, y));
    const [ox, oy] = P(...OWN), [tx, ty] = P(409, 392), [ex, ey] = P(405, 381), [mx, my] = P(415, 384);
    // Route preview to the selected tile, an incoming attack from Cinderhold and my support on its way to Maerwen.
    let ov = dots(ox - 16, oy + 2, tx + 30, ty - 2, '#FFF8E8');
    const off = T * 0.5, ia = [ex, ey + off], ib = [ox, oy - off], f = 0.45, ax = ia[0] + (ib[0] - ia[0]) * f, ay = ia[1] + (ib[1] - ia[1]) * f;
    ov += dots(ia[0], ia[1], ax, ay, '#FFF8E8', 0.45) + dots(ax, ay, ib[0], ib[1], '#EF9C6E') + pawn(ax, ay, 22, '#C4623A', true);
    labels.push(pill('Attack on 412|388 · 18:42', ax, ay - 22 * 1.55 - 13, '#C4623A', '#FFF8E8'));
    const L = Math.hypot(mx - ox, my - oy), ux = (mx - ox) / L, uy = (my - oy) / L, sa0 = [ox + ux * off, oy + uy * off], sb = [mx - ux * off, my - uy * off], g2 = 0.5, bx = sa0[0] + (sb[0] - sa0[0]) * g2, by = sa0[1] + (sb[1] - sa0[1]) * g2;
    ov += dots(sa0[0], sa0[1], bx, by, '#FFF8E8', 0.45) + dots(bx, by, sb[0], sb[1], '#FFDC7A') + pawn(bx, by, 22, '#2F9AA0', false);
    labels.push(pill('Support to 415|384 · 31:05', bx, by - 22 * 1.55 - 13, '#F2B33D', '#2B211C'));
    return `<svg class="wmap" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#8DB651"/>${g}${ov}${labels.join('')}</svg>`;
  };
  const mb = (inner, cls = '') => `<span class="mb${cls}">${inner}</span>`;
  const IC = {
    plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    centre: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    find: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 6 6"/></svg>',
    key: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
    swords: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l11 11M20 4 9 15M6 18l-2 2M18 18l2 2M13 17l4 4M11 17l-4 4"/></svg>',
  };
  const ctlCol = () => `<div class="mctl">${mb(IC.plus)}${mb(IC.minus)}${mb(IC.centre, ' sun')}${mb(IC.find)}</div><div class="mkey">${mb(IC.key)}</div>`;
  // Selected tile pieces (TilePanel): abandoned hamlet at 409|392, 42 pts; troops at home from the shared demo data.
  const HOME = h.UN.filter((u) => u.home > 0);
  const tHead = () => `<div class="tph"><div class="tpt"><h2>Abandoned village</h2><div class="own"><span class="alw">Abandoned</span><span class="mut">· no owner</span></div></div><span class="xb">${xI()}</span></div>`;
  const stageCard = () => `<div class="stc"><span class="thb" style="background-image:url(map/abandoned-stage-1-hamlet.svg)"></span><div><span class="up">Ruin 1/6</span><b>Abandoned hamlet · 42 pts</b><span class="ral"><i></i>Abandoned</span></div></div>`;
  const facts = (cols) => `<div class="fx" style="grid-template-columns:repeat(${cols},1fr)"><div><span class="up">Location</span><b>409|392</b></div><div><span class="up">Distance</span><b>5.0 fields</b></div><div><span class="up">Terrain</span><b>Grassland</b></div><div class="${cols === 3 ? 'w3' : ''}"><span class="up">Strength</span><b><span class="tag won">Weak</span> <span class="mut" style="font-weight:600">≤ 12 troops</span></b></div></div>`;
  const missionSeg = () => `<div class="seg3 ms"><span class="on">Attack</span><span>Scout</span></div><span class="hlp">?</span>`;
  const groups = () => `<div class="grp"><span class="gch">All troops</span><span class="gch">Decoy</span><span class="gch on">Raid party</span><span class="sp"></span><span class="mx">Clear</span></div>`;
  const units = (cols) => `<div class="su" style="grid-template-columns:repeat(${cols},1fr)">${HOME.map((u) => { const v = h.SEND[u.id] || 0; return `<div class="sx">${pt(u.id, 32)}<span class="mt"><b>${u.n}</b><small><span class="all">all ${u.home}</span></small></span><span class="inp${v ? ' on' : ' z'}">${v}</span></div>`; }).join('')}</div>`;
  const strikeLine = () => `<div class="sln"><span class="mut">Strike: +1 Chieftain + escort</span><span class="sp"></span><span class="mx">Simulate</span></div>`;
  const sum = () => `<div class="sm4"><div><span class="up">Travel</span><b>50:00</b></div><div><span class="up">Arrives</span><b>15:55</b></div><div><span class="up">Carry</span><b>800</b></div></div>`;
  const sendBtn = () => `<span class="btn g sbig">${IC.swords}Send attack</span>`;
  const MP_CSS = `
.sheetA.mp{padding:0;display:flex;overflow:hidden}
.mapw{position:relative;flex:none;overflow:hidden}.wmap{display:block}
.mctl{position:absolute;right:14px;top:14px;display:flex;flex-direction:column;gap:10px}.mkey{position:absolute;left:14px;bottom:14px}
.mb{display:grid;place-items:center;width:48px;height:48px;border-radius:14px;border:2.5px solid var(--c-ink);background:var(--surface);box-shadow:0 3px 0 var(--c-ink);color:var(--c-ink)}.mb.sun{background:var(--c-sun)}
.tph{display:flex;align-items:flex-start;gap:10px}.tpt{flex:1;min-width:0}.tpt h2{font:400 22px/1.35 var(--font-display);color:var(--heading)}
.own{display:flex;align-items:center;gap:6px;margin-top:3px;font:600 14px/1.2 var(--font)}.alw{color:#5f584f;font-weight:700}
.stc{display:flex;align-items:center;gap:12px;padding:8px 12px 8px 8px;border-radius:14px;background:var(--surface-2)}.thb{width:64px;height:64px;border-radius:12px;background-color:#a6c964;background-repeat:no-repeat;background-size:122px 149px;background-position:-29px -66px;border:2px solid var(--edge);flex:none}
.stc>div{display:flex;flex-direction:column;gap:4px}.stc b{font:700 15px/1.2 var(--font)}.ral{display:inline-flex;align-items:center;gap:7px;font:600 13.5px/1.2 var(--font);color:var(--on-surface-muted)}.ral i{width:22px;height:12px;border-radius:50%;border:2.5px dashed #6e675e}
.fx{display:grid;gap:8px}.fx>div{display:flex;flex-direction:column;gap:5px;padding:8px 10px;border-radius:11px;background:var(--surface-2)}.fx b{font:700 15px/1.2 var(--font);white-space:nowrap;display:flex;align-items:center;gap:6px}.fx .w3{grid-column:span 3;flex-direction:row;align-items:center;gap:12px}
.sendh{display:flex;align-items:center;gap:10px}.seg3.ms{flex:1}.seg3.ms span.on{background:var(--c-sun)}
.hlp{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;border:2px solid var(--edge);background:var(--surface);font:700 16px/1 var(--font);color:var(--on-surface-muted);flex:none}
.grp{display:flex;align-items:center;gap:7px}.gch{display:inline-flex;align-items:center;height:36px;padding:0 12px 1px;border-radius:11px;border:2px solid var(--edge);background:var(--surface);font:700 14px/1.2 var(--font);white-space:nowrap}.gch.on{border-color:var(--c-ink);background:var(--c-sun-hi)}
.sln{display:flex;align-items:center;gap:8px;font:600 14px/1.2 var(--font)}
.sm4{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.sm4 div{display:flex;flex-direction:column;gap:4px;padding:7px 10px;border-radius:11px;background:var(--info-bg)}.sm4 b{font:700 17px/1.2 var(--font);color:var(--heading)}
.btn.sbig{min-height:50px;font-size:19px;border-radius:14px}`;

  // Map A: big map on the left, the selected tile's panel on the right (everything in TilePanel, no inner scroll).
  {
    const PW = 432, W = 1407 - PW, H = 763;
    const panel = `<aside class="tpA">${tHead()}${stageCard()}${facts(3)}<div class="sdiv"></div><div class="sendh">${missionSeg()}</div>${groups()}${units(2)}${strikeLine()}<div class="tfoot">${sum()}${sendBtn()}</div></aside>`;
    page('a-map-1440', 'map', `<main class="sheetA mp"><div class="mapw" style="width:${W}px;height:${H}px;border-radius:15.5px 0 0 15.5px">${isoMap(W, H, { c: [1, 0] })}${ctlCol()}</div>${panel}</main>`, `${h.SEND_CSS}${MP_CSS}
.tpA{width:${PW}px;flex:none;display:flex;flex-direction:column;gap:8px;padding:14px 16px 16px;background:var(--surface);border-left:2.5px solid var(--c-ink)}
.sdiv{height:2px;background:var(--edge-soft);margin:2px -16px}.tfoot{display:flex;flex-direction:column;gap:10px;margin-top:auto}
.tpA .su{gap:6px 8px}.tpA .sx{min-height:44px}`);
  }

  // Map B: the map runs the full width; the selected tile opens as one strip along the bottom (info | troops | send).
  {
    const SH = 236, W = 1407, H = 763 - SH;
    const factsB = `<div class="fxb"><div><span class="up">Location</span><b>409|392</b></div><div><span class="up">Distance</span><b>5.0 fields</b></div><div><span class="up">Terrain</span><b>Grassland</b></div><div><span class="up">Strength</span><b><span class="tag won">Weak</span> <span class="mut" style="font-weight:600">≤ 12 troops</span></b></div></div>`;
    const unitsRow = `<div class="urow">${HOME.map((u) => { const v = h.SEND[u.id] || 0; return `<div class="uc">${pt(u.id, 34)}<b>${u.n}</b><span class="inp${v ? ' on' : ' z'}">${v}</span><span class="all">all ${u.home}</span></div>`; }).join('')}</div>`;
    const strip = `<section class="stB"><div class="sc1">${tHead()}${stageCard()}${factsB}</div><div class="sc2"><div class="sendh">${missionSeg()}<span class="sp"></span>${groups()}</div>${unitsRow}</div><div class="sc3">${sum()}${sendBtn()}${strikeLine()}</div></section>`;
    page('b-map-1440', 'map', `<main class="sheetA mp" style="flex-direction:column"><div class="mapw" style="width:${W}px;height:${H}px;border-radius:15.5px 15.5px 0 0">${isoMap(W, H, { c: [-2, -3] })}${ctlCol()}</div>${strip}</main>`, `${h.SEND_CSS}${MP_CSS}
.stB{height:${SH}px;flex:none;display:flex;background:var(--surface);border-top:2.5px solid var(--c-ink)}
.stB>div{display:flex;flex-direction:column;gap:10px;padding:12px 16px 14px;min-width:0}.stB>div+div{border-left:2px solid var(--edge-soft)}
.sc1{width:410px;flex:none}.sc1 .tpt h2{font-size:20px}.sc1 .stc{padding:4px 12px 4px 4px}.sc1 .thb{width:52px;height:52px;background-size:104px 127px;background-position:-26px -58px}
.fxb{display:grid;grid-template-columns:1fr 1.25fr;gap:4px 14px}.fxb>div{display:flex;align-items:center;gap:8px;height:26px}.fxb .up{width:74px}.fxb b{display:flex;align-items:center;gap:6px;font:700 14.5px/1.2 var(--font);white-space:nowrap}.fxb .tag{height:22px}
.sc2{flex:1}.sc2 .seg3.ms{flex:none;width:220px}.sc2 .grp{gap:6px}
.urow{display:grid;grid-template-columns:repeat(8,1fr);gap:8px;flex:1}.uc{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border-radius:12px;background:var(--surface-2);padding:6px 4px}
.uc b{font:700 13.5px/1.2 var(--font);white-space:nowrap}.uc .inp{width:60px;justify-content:center}.uc .all{font:700 13px/1.2 var(--font);color:var(--link);text-decoration:underline;text-underline-offset:2px}
.sc3{width:330px;flex:none}.sc3 .sm4 div{padding:7px 9px}.sc3 .sln{font-size:13.5px}`);
  }
}
