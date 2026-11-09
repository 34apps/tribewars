// Builds the comparison boards with headless Chrome (@2x):
//   board-<page>.png  2x2 grid per page: Now (top-left), A, B, C; frames 940 px wide, big label + one plain line each
//   board-all.png     rows = the 4 pages, columns = Now / A / B / C at 520 px (overview)
//   board-mix-<page>.png  A, C and the owner's Mix (A's tabs + C's parts) side by side, 940 px each (village, building)
// Usage: node tooling/board.mjs [name filter]   e.g. `node tooling/board.mjs mix` builds only board-mix-village.
// "Now" pictures come from now/<page>-1440.png (written by tooling/now-shot.mjs); a missing one shows a placeholder.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const ROOT = join(here, '..');
const SCALE = 2;
const PAGES = [['village', 'Village'], ['building', 'Building (Barracks)'], ['army', 'Army'], ['reports', 'Reports']];
const K = ['Now', 'A', 'B', 'C'];
const LAB = { Now: 'Now', A: 'A · Classic tabs', B: 'B · Side rail', C: 'C · Village column', Mix: "Mix: A's tabs + C's village parts" };
const LINE = {
  village: {
    Now: 'Village art fills the whole screen; floating pills on top and a floating dock at the bottom.',
    A: 'Top bar and folder tabs. Production, queue and troops left; picture with all 13 buildings under it; movements right.',
    B: 'Menu rail on the left. Big picture with the build queue under it; building tiles with their costs on the right.',
    C: 'Tabs in the top bar. A fixed left column (mini picture, queue, movements, production) stays on every page.',
  },
  building: {
    Now: 'The Barracks opens as a small floating card over the village; recruiting lives on another page.',
    A: 'Header with art, level and the upgrade box; a recruit table with one row per unit; training queue on the right.',
    B: 'All 13 buildings listed on the left to jump between; a card per unit to train; queue on the right.',
    C: 'Building card and upgrade box on top; one wide row per unit with its full figure; queue on the right.',
  },
  army: {
    Now: 'One sheet over the village that runs off the screen; sending troops is a separate pop-up.',
    A: 'Three columns: troops at home | movements and support | send troops.',
    B: 'Big unit tiles (home, away, training); movements and send troops on the right.',
    C: 'All nine figures in one muster row; send troops and support side by side below it.',
  },
  reports: {
    Now: 'Scrolling list on a sheet over the village; the right half stays empty until you pick a report.',
    A: 'Type tabs over a table of reports and the open report beside it; 12 per page with arrows.',
    B: 'Like a mail program: report folders | list | open report, all at once.',
    C: 'Type chips over the list and the open report beside it; the village column stays on the left.',
  },
};
const missing = [];
const src = (k, page) => {
  if (k !== 'Now') return `${k.toLowerCase()}-${page}-1440.png`;
  if (existsSync(join(ROOT, 'now', `${page}-1440.png`))) return `now/${page}-1440.png`;
  missing.push(page); return null;
};
const frame = (k, page, w) => { const s = src(k, page); return s ? `<div class="fr" style="width:${w + 4}px"><img src="${s}" style="width:${w}px"></div>` : `<div class="fr ph" style="width:${w + 4}px;height:${Math.round((w * 900) / 1440) + 4}px">Now: picture pending</div>`; };
const CSS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Rubik:wght@400;500;600;700&display=swap"><style>
body{margin:0;background:#eadcbc;font-family:Rubik,sans-serif;color:#2b211c;padding:34px 40px 44px;width:max-content}
h1{font:400 38px/1.3 'Bagel Fat One';margin:0}.sub{font:500 18px/1.4 Rubik;color:#4a3a2f;margin:2px 0 26px}
.lab{display:inline-block;font:400 30px/1.3 'Bagel Fat One';background:#f2b33d;border:3px solid #2b211c;border-radius:16px;padding:4px 16px 6px;box-shadow:0 4px 0 #2b211c}.lab.now{background:#fffaf0}
.lab.mix{background:#7ad3cd}.lab.s{font-size:22px;padding:3px 12px 5px;border-radius:13px}
.line{font:600 17px/1.35 Rubik;color:#3e3028;margin:12px 0 14px;min-height:46px;max-width:940px}
.fr{border:3px solid #2b211c;border-radius:6px;overflow:hidden;line-height:0;background:#fff;box-shadow:0 6px 0 rgba(43,33,28,.35)}.fr img{display:block}
.fr.ph{display:grid;place-items:center;line-height:1.3;font:700 24px Rubik;color:#5d4838;background:#f6ecd4}
.g2{display:grid;grid-template-columns:repeat(2,946px);gap:34px 44px}.g3{display:grid;grid-template-columns:repeat(3,946px);gap:34px 44px}
.g4t{display:grid;grid-template-columns:repeat(4,524px);gap:30px 26px}.g4{display:grid;grid-template-columns:64px repeat(4,526px);gap:26px 26px;align-items:start}
.rl{font:400 28px/1 'Bagel Fat One';writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;align-self:center;justify-self:center}
.mini{font:600 14px/1.35 Rubik;color:#3e3028;margin:0 0 10px;min-height:38px}
</style>`;
const boards = [];
for (const [page, name] of PAGES) {
  const cells = K.map((k) => `<div><span class="lab${k === 'Now' ? ' now' : ''}">${LAB[k]}</span><div class="line">${LINE[page][k]}</div>${frame(k, page, 940)}</div>`).join('');
  boards.push([`board-${page}`, `<h1>${name} page · desktop 1440 × 900</h1><div class="sub">Today's screen and three new layouts. Same village and numbers in every picture. Each page fits the screen: no scrolling, no inner scroll boxes.</div><div class="g2">${cells}</div>`]);
}
{
  const heads = `<div></div>` + K.map((k) => `<div><span class="lab s${k === 'Now' ? ' now' : ''}">${LAB[k]}</span></div>`).join('');
  const rows = PAGES.map(([page, name]) => `<div class="rl">${name.replace(' (Barracks)', '')}</div>` + K.map((k) => `<div><div class="mini">${LINE[page][k]}</div>${frame(k, page, 520)}</div>`).join('')).join('');
  boards.push(['board-all', `<h1>All four pages · Now vs A, B, C</h1><div class="sub">Rows: Village, Building, Army, Reports. Columns: today, then the three layouts. Desktop 1440 × 900, everything visible at once.</div><div class="g4">${heads}${rows}</div>`]);
}
{
  const MIXLINE = {
    village: {
      A: 'Top bar and folder tabs; production, queue and troops left; picture with the building list under it; movements right.',
      C: 'Tabs inside one top bar; a fixed left column with a mini picture, queue, movements and production; buildings list on the right.',
      Mix: "A's top bar and folder tabs; C's left column (queue, movements, production, no mini picture) and C's picture, troop row and buildings list.",
    },
    building: {
      A: 'Header with art, level and the upgrade box; a recruit table with one row per unit; training queue on the right.',
      C: 'Left village column; building card and upgrade box on top; one wide row per unit with its full figure; queue on the right.',
      Mix: "A's top bar and tabs with a Village › Barracks trail and a ‹ 8 of 13 › switch; C's village column and C's Barracks body.",
    },
    army: {
      A: 'Three columns: troops at home | movements and support | send troops.',
      C: 'Left village column with movements; a muster row of all nine figures, then send troops and support side by side.',
      Mix: "A's top bar and tabs; C's village column (with training per building) and muster row; a movements table, support and send troops.",
    },
    reports: {
      A: 'Type tabs over a table of reports and the open report beside it; 12 per page with arrows.',
      C: 'Left village column; type chips over the list and the open report beside it.',
      Mix: "A's top bar and tabs; C's village column; chips with unread counts, the list, and the open report with forces, loot and notes.",
    },
  };
  const TITLE = { village: 'Village page, step 1 of the mix', building: 'Barracks page, step 2 of the mix', army: 'Army page, step 3 of the mix', reports: 'Reports page, step 4 of the mix' };
  const SUB = { village: "A and C as before, and the new Mix: A's tabs on top, C's village parts below. Same data; nothing scrolls.", building: "A and C as before, and the new Mix: A's tabs on top, C's village column and Barracks body below. Same data; nothing scrolls.", army: "A and C as before, and the new Mix: troops and trips only (recruiting lives on the Barracks and Stables pages). Same data; nothing scrolls.", reports: "A and C as before, and the new Mix. Only actions the game has today: Simulate and map links. Same data; nothing scrolls." };
  for (const page of ['village', 'building', 'army', 'reports']) {
    const cells = ['A', 'C', 'Mix'].map((k) => `<div><span class="lab${k === 'Mix' ? ' mix' : ''}">${LAB[k]}</span><div class="line">${MIXLINE[page][k]}</div>${frame(k, page, 940)}</div>`).join('');
    boards.push([`board-mix-${page}`, `<h1>${TITLE[page]} · desktop 1440 × 900</h1><div class="sub">${SUB[page]}</div><div class="g3">${cells}</div>`]);
  }
}
boards.push(['board-mix-army2', `<h1>Army page, mix version 2 · desktop 1440 × 900</h1><div class="sub">C (the owner's favourite body), the first Mix, and Mix 2: C's big troop row and send panel, with Movements and Support in their own clear panels. Nothing scrolls.</div><div class="g3">${[
  ['C', 'army', LAB.C, 'Left village column with movements; big troop row, then send troops and support side by side.'],
  ['Mix', 'army', 'Mix 1', "A's bar and tabs; smaller troop row; a movements table, support and a narrow send form."],
  ['Mix', 'army2', "Mix 2: A's tabs + C's Army body", "A's bar and tabs; C's big troop row; send troops left; Movements (attack first, in red) above Support on the right; training in the left column."],
].map(([k, pg, lab, line], i) => `<div><span class="lab${i ? ' mix' : ''}">${lab}</span><div class="line">${line}</div>${frame(k, pg, 940)}</div>`).join('')}</div>`]);
boards.push(['board-mix-reports2', `<h1>Reports: bigger battle and scouting, before and after</h1><div class="sub">Left: the first try (with the village column). Right: the new version: no village column, a clearer battle panel, both siege kinds at once, and the top scouting rank line.</div><div class="g2">${[
  ['mix-reports-big-1440.png', 'Before · big battle', 'Village column on the left; Battle, Siege and Loot as small plain boxes.'],
  ['mix-reports2-big-1440.png', 'After · big battle', 'Full width. Head-to-head strength bar with the winner, chips for luck, wall and renown, siege as before → after level chips, loot as four tiles.'],
  ['mix-reports-scout-1440.png', 'Before · scouting', 'Village column on the left; resources, troops and buildings in a narrow column.'],
  ['mix-reports2-scout-1440.png', 'After · scouting', 'Full width; plus one new line at the top scouting rank: the total of the village\'s troops outside it.'],
].map(([f, lab, line], i) => `<div><span class="lab${i % 2 ? ' mix' : ' now'}">${lab}</span><div class="line">${line}</div><div class="fr" style="width:944px"><img src="${f}" style="width:940px"></div></div>`).join('')}</div>`]);
boards.push(['board-mix-mail', `<h1>Mail page in the mix · desktop 1440 × 900</h1><div class="sub">A's top bar and tabs, full width like Reports. Only what the game's Mail has today: Inbox and Sent, New mail, Reply, Report, Delete, and the write form with its emoji buttons. A and B have no Mail page, so the two Mix states are shown.</div><div class="g2">${[
  ['mix-mail-1440.png', 'Mix · message open', 'Inbox list with unread dot, sender, time, subject and first line; 10 per page with arrows. The open message beside it with Reply, Report and Delete.'],
  ['mix-mail-compose-1440.png', 'Mix · writing a mail', 'New mail (or Reply) turns the right side into the form: To, Subject, Message, emoji buttons, a letter count and Send.'],
].map(([f, lab, line]) => `<div><span class="lab mix">${lab}</span><div class="line">${line}</div><div class="fr" style="width:944px"><img src="${f}" style="width:940px"></div></div>`).join('')}</div>`]);
boards.push(['board-mix-mail2', `<h1>Mail: letters vs conversations</h1><div class="sub">Mix 1 opens one letter at a time. Mix 2 groups mail by player: the whole exchange as letter cards, theirs left and yours right; only this thread pane scrolls.</div><div class="g2">${[
  ['mix-mail-1440.png', 'Mix 1 · one letter at a time', 'Inbox / Sent list; the open letter beside it with Reply, Report and Delete.'],
  ['mix-mail2-1440.png', 'Mix 2 · conversations', 'One row per player with unread count; the thread scrolls (scrollbar shows the middle of a long exchange); a reply box stays at the bottom.'],
].map(([f, lab, line], i) => `<div><span class="lab${i ? ' mix' : ' now'}">${lab}</span><div class="line">${line}</div><div class="fr" style="width:944px"><img src="${f}" style="width:940px"></div></div>`).join('')}</div>`]);
boards.push(['board-tribe-tabs', `<h1>Tribe sub-tabs in the mix · desktop 1440 × 900</h1><div class="sub">Same header and sub-tabs on every page; calm blocks, big type, at most three columns. Only the chat and the forum thread scroll inside their pane.</div><div class="g4t">${[
  ['mix-tribe-alerts-1440.png', 'Alerts', 'Attacks on members, soonest first, with Watchtower details; villages with the hearth out.'],
  ['mix-tribe-diplomacy-1440.png', 'Diplomacy', 'Relations with Cancel / End war; proposals; the New relation form.'],
  ['mix-tribe-projects-1440.png', 'Projects', 'Tribe Store, Roads / Watchtower / Wards with cost and build, who gave.'],
  ['mix-tribe-recruit-1440.png', 'Recruit', 'Applications with Accept / Decline; invite by name; open invitations.'],
  ['mix-tribe-chat-1440.png', 'Chat', 'One big chat; the message list scrolls, the box stays at the bottom.'],
  ['mix-tribe-forum-1440.png', 'Forum', 'Boards, threads, and the open thread with posts and a reply box.'],
  ['mix-tribe-log-1440.png', 'Log', 'Everything that happened in the tribe, 11 per page.'],
  ['mix-tribe2-1440.png', 'Overview (approved)', 'For comparison: the calm Overview.'],
].map(([f, lab, line], i) => `<div><span class="lab s${i === 7 ? ' now' : ' mix'}">${lab}</span><div class="mini" style="margin-top:8px">${line}</div><div class="fr" style="width:524px"><img src="${f}" style="width:520px"></div></div>`).join('')}</div>`]);
// Ranks and Map (full width, A's top bar and tabs): two options each, side by side.
const pair = (name, title, sub, items) => boards.push([name, `<h1>${title}</h1><div class="sub">${sub}</div><div class="g2">${items.map(([f, lab, line]) => `<div><span class="lab">${lab}</span><div class="line">${line}</div><div class="fr" style="width:944px"><img src="${f}" style="width:940px"></div></div>`).join('')}</div>`]);
pair('board-ranks', 'Ranks page · desktop 1440 × 900', "A's top bar and tabs, full width. Only what today's Rankings has: Players / Tribes / Renown, top three, search, Jump to me, 20 per page, Domination bar. Nothing scrolls.", [
  ['a-ranks-1440.png', 'A · Big rows', 'Top three, the world numbers and Domination in a band on top; the 20 places of a page as two columns of 10 big rows. Shown after Jump to me (your row lit).'],
  ['b-ranks-1440.png', 'B · List + your card', 'One list of all 20 places on the left; on the right a card with your own rank and player facts, then the top three and Domination.'],
]);
pair('board-map', 'Map page · desktop 1440 × 900', "A's top bar and tabs, full width. Same map controls as today (zoom, centre on my village, go to x|y; map key closed). An abandoned village is selected; nothing scrolls.", [
  ['a-map-1440.png', 'A · Side panel', 'Big map on the left; the selected place opens in a panel on the right: details, mission, troop groups, troops at home, travel and Send.'],
  ['b-map-1440.png', 'B · Bottom strip', 'The map runs the full width; the selected place opens as one strip under it: details | mission and all troops in a row | travel and Send.'],
]);
// Owner feedback 2026-11-09 (tooling/more-pages.mjs): simulator, unit card, toasts, mail recipients, tribe without a tribe, Domination.
pair('board-sim', 'Battle simulator · desktop 1440 × 900', "Everything on one screen and the luck is yours to set. Same army in both: a saved group of 82 against Cinderhold (Wall 6, 15 Pikemen of support). All results are the game's real battle rule; luck runs from −10% to +10%.", [
  ['sim-a-1440.png', 'A · Three columns', 'Your army | Defender | Result. A luck slider sits on top of the result; the result is one clear answer (who wins, losses per unit for both sides, Wall after, what survivors can carry). Shown at −5%: a narrow win.'],
  ['sim-b-1440.png', 'B · Figures + luck ladder', 'Both armies as rows of figures on top. Below, all five luck steps at once (−10% loses, the rest win) with what comes home; click one to see its full result beside it. Shown at 0%.'],
]);
pair('board-unitcard', 'Unit info card · over the Army page', 'Hover or click any unit picture or name: Army, Barracks and Stables, map send form, simulator, reports. The game\'s own numbers.', [
  ['unitcard-a-1440.png', 'A · Small hover card', 'Pops up next to the picture while the pointer rests on it: all numbers in a 2 × 3 grid, cost and training time, one line on what it is good for, and a link to the full card.'],
  ['unitcard-b-1440.png', 'B · Big click card', 'A click opens one card over the dimmed page: the figure on a stage, bars against the strongest unit, speed, carry, people, training, cost, all nine units to flip through, and Train.'],
]);
pair('board-toast', 'Alerts (toasts) · their own design', 'One family in four kinds: error, warning, success, info. Each has its own colour and badge, short text, an optional button and a close. All four are shown at once only for this picture; the texts are the game\'s own messages.', [
  ['toast-a-1440.png', 'A · Soft cards, bottom right', 'Light tinted cards with dark text (easy to read) and a coloured badge, stacked bottom right where toasts sit today. Calm; the error stays until closed.'],
  ['toast-b-1440.png', 'B · Bold pills, top centre', 'Strong filled pills with light text (dark text on the yellow warning), dropping from under the tabs; a thin line shows when each one fades. Louder, and never over the Send button.'],
]);
pair('board-mailto', 'Mail · choosing who to write to', 'The game has no friends list. What it does have: the players you have mailed with, your tribe members (with role) and a player search. A mail still goes to one player.', [
  ['mailto-a-1440.png', 'A · Picker column', 'A “Who to write to” column between the list and the form: search any player, recent conversations, your tribe with roles and who is online. Click a name and it fills To.'],
  ['mailto-b-1440.png', 'B · Choose band + Contacts (NEW)', 'Under To, one band: search with suggestions as you type, then Contacts | Recent | Tribe side by side. Contacts (players you pin) is a NEW feature, marked NEW, for you to decide.'],
]);
boards.push(['board-tribe-more', `<h1>Tribe without a tribe, and the Domination screen</h1><div class="sub">Top: the Tribe tab when you are in no tribe (same header style as the member pages). Bottom: Domination details, opened from the Domination bar; drawn as a new Domination switch on Ranks. Only rules the game has.</div><div class="g2">${[
  ['notribe-a-1440.png', 'A · List + side column', 'All tribes in one ranked table with Join / Apply / Invite only / Full right on each row; your invitations, your applications (1 of 3) and Found a tribe (needs Town Hall 3) beside it.'],
  ['notribe-b-1440.png', 'B · List | tribe page | invites', 'Pick a tribe on the left and its page opens in the middle (numbers, about, top members) with the application message ready to send; invitations and Found a tribe on the right.'],
  ['domination-a-1440.png', 'A · The race', 'Each big tribe as a long bar against the 75% line (yours lit); the four conditions with ticks and progress; what happens when a tribe wins.'],
  ['domination-b-1440.png', 'B · The road', 'The whole world in one bar, split by tribe, with the 75% line; four stepping stones to the end of the world (1 of 4 done); what the end brings.'],
].map(([f, lab, line]) => `<div><span class="lab">${lab}</span><div class="line">${line}</div><div class="fr" style="width:944px"><img src="${f}" style="width:940px"></div></div>`).join('')}</div>`]);
// Ranks B · Top three card: today's plaques ("now") and three redraws, as close-ups of B's right column (x 975–1418, y 196–880).
{
  const Z = 1.25, X0 = 975, Y0 = 196, CW = 443, CH = 684;
  const crop = (f) => `<div class="fr" style="width:${Math.round(CW * Z) + 4}px;height:${Math.round(CH * Z) + 4}px;position:relative"><img src="${f}" style="position:absolute;width:${1440 * Z}px;left:${-X0 * Z}px;top:${-Y0 * Z}px"></div>`;
  boards.push(['board-ranks-top3', `<h1>Ranks B · the Top three card</h1><div class="sub">Close-ups of the right column at 1.25×, same data everywhere. Each option is drawn in the full page at 1440 × 900 (ranks-top3-a/b/c-1440.png) and still fits with no scrolling.</div><div style="display:grid;grid-template-columns:repeat(4,${Math.round(CW * Z) + 4}px);gap:34px 36px">${[
    ['b-ranks-1440.png', 'Now', 'Three tan plaques with crowns; they read like heavy buttons.', ' now'],
    ['ranks-top3-a-1440.png', 'A · Mini leaderboard', 'Three calm rows: medal, portrait, name, tribe tag, points on the right.', ''],
    ['ranks-top3-b-1440.png', 'B · Toy podium', 'Three small stone steps, 2-1-3, portraits standing on them; name and points under.', ''],
    ['ranks-top3-c-1440.png', 'C · Winner first', 'The leader big, with tribe and lead over #2; #2 and #3 small side by side.', ''],
  ].map(([f, lab, line, cls]) => `<div><span class="lab${cls}">${lab}</span><div class="line" style="max-width:${Math.round(CW * Z)}px">${line}</div>${crop(f)}</div>`).join('')}</div>`]);
}
const only = process.argv[2] || '';
const PROFILE = '/private/tmp/claude-501/ingame-pages-board'; rmSync(PROFILE, { recursive: true, force: true });
const PORT = 9492;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0; const pend = new Map();
for (let i = 0; i < 50; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
try {
  await send('Page.enable'); await send('Runtime.enable');
  for (const [name, body] of boards.filter(([n]) => n.includes(only))) {
    const f = join(ROOT, 'mockups', `${name}.html`); writeFileSync(f, `<!doctype html><meta charset="utf-8"><base href="../">${CSS}${body}`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: SCALE, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(f).href });
    await sleep(600); await ev('document.fonts.ready.then(()=>true)'); await ev('Promise.all([...document.images].map(i=>i.decode().catch(()=>0)))'); await sleep(600);
    const m = await ev('({w: document.body.scrollWidth, h: document.body.scrollHeight})');
    await send('Emulation.setDeviceMetricsOverride', { width: m.w, height: m.h, deviceScaleFactor: SCALE, mobile: false });
    await sleep(400);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(ROOT, `${name}.png`), Buffer.from(r.data, 'base64'));
    console.log(name, m.w * SCALE, 'x', m.h * SCALE);
  }
  if (missing.length) console.log('MISSING now/ pictures (placeholder used):', [...new Set(missing)].join(', '));
} finally { chrome.kill(); }
