// Generates the static phone mockups (mockups/<dir>-<screen>.html) from the real tokens in apps/web/src/styles.css.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'mockups');
const css = readFileSync(join(here, '../../../../apps/web/src/styles.css'), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')) + 1);
writeFileSync(join(OUT, 'tokens.css'), root + '\n');
writeFileSync(join(OUT, 'mock.css'), readFileSync(join(here, 'mock.css'), 'utf8'));

const FLAME = (s = 30) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32"><path d="M16 3c6 6 9 11 7 17c-1.4 4-4.4 6-7 6s-5.6-2-7-6c-1.2-3.6 0.4-7 3-9.4c0 2.6 1 4 2.4 3.4c1.4-3.6-0.6-6.6 1.6-11z" fill="#F2B33D" stroke="#2B211C" stroke-width="2" stroke-linejoin="round"/><path d="M16 15c2.4 2.4 3 4.4 2.2 6.2c-0.6 1.4-1.4 2-2.2 2s-1.8-0.6-2.4-2c-0.6-1.6 0.2-3.2 1.2-4c0.2 1 0.6 1.2 0.9 1c0.4-1 0-2 0.3-3.2z" fill="#FFF8E8"/></svg>`;
const CHEV = `<svg class="chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`;
const BACK = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2B211C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`;
const COLORS = ['#5E8C3A', '#2F9AA0', '#C4623A', '#7A3B5E', '#F2B33D'];
const hue = (name) => COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
/** Toy banner: coloured sky, two hills, a sun and a little tent. */
const BAN = (name, cls = 'ban', style = '') => `<div class="${cls}" style="${style}"><svg width="100%" height="100%" viewBox="0 0 200 62" preserveAspectRatio="xMidYMid slice"><rect width="200" height="62" fill="${hue(name)}"/><circle cx="162" cy="16" r="9" fill="#FFDC7A"/><ellipse cx="45" cy="70" rx="90" ry="34" fill="#fff" fill-opacity=".22"/><ellipse cx="150" cy="74" rx="95" ry="32" fill="#2B211C" fill-opacity=".2"/><path d="M84 54l16-26 16 26z" fill="#FFF8E8" stroke="#2B211C" stroke-width="3" stroke-linejoin="round"/><path d="M95 54l5-11 5 11z" fill="#C4623A"/></svg></div>`;
const AV = (name) => BAN(name, 'wav', '');
const tag = (k, t) => `<span class="tag t-${k}">${t}</span>`;

const OPEN = [['Emberfall', 1, 64], ['Thornwick', 2, 118], ['Cinder Vale', 5, 207], ['Mistral Reach', 6, 233], ['Ravenmoor', 8, 251], ['Saltmarsh', 11, 268], ['Duskhollow', 13, 279], ['Greywater', 16, 284], ['Stonebrook', 19, 291]];
const ago = (d) => (d === 1 ? '1 day ago' : `${d} days ago`);
const top3 = OPEN.slice(0, 3);

const page = (name, body, fixed = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=390"><title>${name}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Rubik:wght@400;500;600;700&display=swap"><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="mock.css"></head><body class="${fixed ? 'fixed' : ''}">${body}</body></html>`;
const files = {};

/* ================= A · Game launcher ================= */
const aLogo = `<span class="a-logo">${FLAME(32)}Clanfire</span>`;
files['a-home'] = page('A home', `
<div class="a-hero" style="height:560px"></div>
<div class="a-top">${aLogo}</div>
<div class="a-sheet">
  <div class="a-grab"></div>
  <h1 class="a-h1">Build a village.<br><em>Raid the world.</em></h1>
  <p class="a-sub">Free strategy in your browser.</p>
  <a class="btn btn-primary btn-lg btn-block">Play free</a>
  <a class="btn btn-ghost btn-md btn-block" style="margin-top:12px">I have an account</a>
  <p class="a-foot">9 worlds open now &middot; No download</p>
</div>`, true);

const aFields = (n) => `
<div class="tabs"><div class="tab">Sign in</div><div class="tab on">Create account</div></div>
<div style="display:flex;flex-direction:column;gap:14px;margin-top:18px">
  <label class="field"><span>Username</span><div class="input"></div><small class="hint">3-20 letters, digits, _</small></label>
  <label class="field"><span>Password</span><div class="input"></div><small class="hint">Min 10 characters. Not common, no username.</small></label>
</div>
<a class="btn btn-primary btn-lg btn-block" style="margin-top:20px">Next</a>`;
files['a-signin'] = page('A signin', `
<div class="a-hero" style="height:250px"></div>
<div class="a-top"><a class="btn btn-icon" style="background:var(--surface);border-radius:50%;width:48px;height:48px">${BACK}</a>${aLogo}</div>
<div class="a-sheet" style="top:214px;padding-top:24px"><div class="a-grab"></div>
  <h1 class="a-h1" style="text-align:left;font-size:26px;margin-bottom:14px">Join Clanfire</h1>
  ${aFields()}
</div>`, true);

const aRow = (w, btn) => `<div class="a-row">${AV(w[0])}<div class="mid"><div class="nm">${w[0]}</div><div class="meta">Started ${ago(w[1])}</div></div>${btn}</div>`;
files['a-worlds'] = page('A worlds', `
<div class="a-hero" style="height:250px"></div>
<div class="a-top">${aLogo}<div class="avatar">R</div></div>
<div style="height:218px"></div>
<div class="a-sheet" style="position:relative;bottom:auto;min-height:626px;padding-top:22px">
  <div class="a-grab"></div>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px"><h1 style="font:400 22px/1.1 var(--font-display)">Hi, Rowan_the_Red</h1></div>
  <div style="display:flex;gap:8px;margin:-4px 0 16px">${tag('gold', 'Champion')}<span class="tag" style="background:var(--info-bg);color:var(--info)">Top 10 &middot; #4</span></div>
  <div class="a-card a-cont">
    <div class="pic">${tag('run', 'Running')}</div>
    <div class="body"><h2>Hollow Marsh</h2><div class="meta" style="margin:3px 0 12px">Played 2 days ago</div>
      <a class="btn btn-primary btn-lg btn-block">Continue</a></div>
  </div>
  <div class="a-row" style="margin-top:12px">${AV('First Light')}<div class="mid"><div class="nm">First Light</div><div class="meta">Finished 40 days ago</div></div><a class="btn btn-sm" style="min-height:44px">Results</a></div>
  <div class="label" style="margin:22px 4px 10px">Join a world</div>
  <div style="display:flex;flex-direction:column;gap:10px">${top3.map((w) => aRow(w, '<a class="btn btn-primary" style="font-size:17px;min-width:76px">Join</a>')).join('')}</div>
  <a class="btn btn-md btn-block" style="margin-top:14px;justify-content:space-between;padding:0 16px 3px 18px">All worlds (14)${CHEV}</a>
</div>`);

const aTabs = `<div class="tabs"><div class="tab on">Open <b>9</b></div><div class="tab">Full <b>2</b></div><div class="tab">Finished <b>3</b></div></div>`;
files['a-allworlds'] = page('A all worlds', `
<div class="bar"><a class="btn btn-icon" style="background:var(--surface)">${BACK}</a><span class="logo" style="font-size:24px;flex:1">All worlds</span></div>
<div style="padding:18px 14px 24px">${aTabs}
<div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">${OPEN.map((w) => aRow(w, '<a class="btn btn-primary" style="font-size:17px;min-width:76px">Join</a>')).join('')}</div>
<p class="meta" style="text-align:center;margin-top:16px">Worlds you play are on the first page.</p></div>`);

/* ================= B · Clean list ================= */
const bBar = (right) => `<div class="bar"><span class="logo">${FLAME(30)}Clanfire</span>${right}</div>`;
const bRow = (w, k, t, meta) => `<div class="row">${AV(w).replace('class="wav"', 'class="wav" style="width:40px;height:40px;border-radius:12px;border-width:2px"')}<div class="mid"><div class="l1"><span class="nm">${w}</span>${tag(k, t)}</div><div class="meta">${meta}</div></div>${CHEV}</div>`;
const bOpenRow = (w) => bRow(w[0], 'open', 'Open', `Started ${ago(w[1])} &middot; ${w[2]} players`);
files['b-home'] = page('B home', `
${bBar('<a class="btn" style="min-height:44px">Sign in</a>')}
<div class="b-banner" style="height:190px"></div>
<div class="b-pad">
  <h1 style="font:400 25px/1.15 var(--font-display);margin-top:18px">Build a village.<br><span style="color:var(--accent)">Raid the world.</span></h1>
  <p class="muted" style="margin:6px 0 16px">Free strategy in your browser.</p>
  <a class="btn btn-primary btn-md btn-block" style="min-height:58px;font-size:22px">Play free</a>
  <div class="label grp-label">Open worlds</div>
  <div class="group">${top3.map(bOpenRow).join('')}<div class="row link" style="justify-content:space-between">All worlds (14)${CHEV}</div></div>
  <p class="meta" style="text-align:center;margin-top:16px">No download &middot; Phone and computer &middot; Free</p>
</div>`, true);

files['b-signin'] = page('B signin', `
<div class="bar"><a class="btn btn-icon" style="background:var(--surface)">${BACK}</a><span class="logo" style="font-size:24px;flex:1">Join Clanfire</span></div>
<div class="b-pad" style="padding-top:20px">
  <div class="tabs"><div class="tab">Sign in</div><div class="tab on">Create account</div></div>
  <div class="label grp-label">Account</div>
  <div class="group" style="padding:4px 14px 14px">
    <label class="field" style="margin-top:12px"><span>Username</span><div class="input"></div><small class="hint">3-20 letters, digits, _</small></label>
    <label class="field" style="margin-top:14px"><span>Password</span><div class="input"></div><small class="hint">Min 10 characters. Not common, no username.</small></label>
  </div>
  <a class="btn btn-primary btn-md btn-block" style="min-height:60px;font-size:22px;margin-top:22px">Next</a>
  <p class="meta" style="text-align:center;margin-top:16px">Step 1 of 2 &middot; Pick your chieftain next</p>
</div>`, true);

files['b-worlds'] = page('B worlds', `
${bBar('<div class="avatar">R</div>')}
<div class="b-pad">
  <div style="margin:18px 4px 0"><h1 style="font:400 22px/1.1 var(--font-display)">Hi, Rowan_the_Red</h1><div style="display:flex;gap:8px;margin-top:8px">${tag('gold', 'Champion')}<span class="tag" style="background:var(--info-bg);color:var(--info)">Top 10 &middot; #4</span></div></div>
  <div class="label grp-label">Your worlds</div>
  <div class="group">
    ${bRow('Hollow Marsh', 'run', 'Running', 'Played 2 days ago')}
    ${bRow('First Light', 'done', 'Finished', 'Ended 40 days ago &middot; View results')}
  </div>
  <div class="label grp-label">Join a world</div>
  <div class="group">${top3.map(bOpenRow).join('')}<div class="row link" style="justify-content:space-between">All worlds (14)${CHEV}</div></div>
  <div class="group" style="margin-top:20px"><div class="row link" style="justify-content:space-between">Hall of Fame${CHEV}</div><div class="row link" style="justify-content:space-between">Sign out${CHEV}</div></div>
</div>`);

files['b-allworlds'] = page('B all worlds', `
<div class="bar"><a class="btn btn-icon" style="background:var(--surface)">${BACK}</a><span class="logo" style="font-size:24px;flex:1">All worlds</span></div>
<div class="b-pad" style="padding-top:18px;padding-bottom:24px">${aTabs}
<div class="group" style="margin-top:16px">${OPEN.map(bOpenRow).join('')}</div>
<p class="meta" style="text-align:center;margin-top:16px">Worlds you play are on the first page.</p></div>`);

/* ================= C · World cards ================= */
const cSm = (w) => `<div class="c-card c-sm">${BAN(w[0])}<div class="bd"><h3>${w[0]}</h3><div>${tag('open', 'Open')}</div><div class="meta">Started ${ago(w[1])}</div><a class="btn btn-primary">Join</a></div></div>`;
const cMore = `<div class="c-card c-more"><b>14</b><span>All worlds</span>${CHEV.replace('class="chev"', '')}</div>`;
files['c-home'] = page('C home', `
<div class="c-head" style="padding-bottom:0"><div style="display:flex;align-items:center;justify-content:space-between"><span class="logo" style="font-size:28px">${FLAME(34)}Clanfire</span><a class="btn" style="min-height:44px">Sign in</a></div></div>
<div style="padding:14px 14px 0"><div class="c-card c-big"><div class="ban" style="height:190px"></div>
  <div class="bd" style="padding:14px"><h1 style="font:400 26px/1.12 var(--font-display)">Build a village.<br><span style="color:var(--accent)">Raid the world.</span></h1>
  <p class="muted" style="margin:6px 0 14px">Free strategy in your browser.</p>
  <a class="btn btn-primary btn-lg btn-block" style="min-height:64px">Play free</a></div></div></div>
<div style="padding:0 14px"><h2 class="c-sec">Open now</h2>
<div class="c-grid">${top3.slice(0, 2).map(cSm).join('')}</div>
<a class="btn btn-md btn-block" style="margin-top:14px;justify-content:space-between;padding:0 16px 3px 18px">All worlds (14)${CHEV}</a></div>`, true);

files['c-signin'] = page('C signin', `
<div style="height:210px;position:relative;background:${COLORS[1]};border-bottom:3px solid var(--c-ink);overflow:hidden">
  <svg width="100%" height="100%" viewBox="0 0 390 210" preserveAspectRatio="xMidYMid slice" style="position:absolute;inset:0"><circle cx="320" cy="50" r="26" fill="#FFDC7A"/><ellipse cx="90" cy="250" rx="240" ry="100" fill="#fff" fill-opacity=".2"/><ellipse cx="330" cy="250" rx="220" ry="90" fill="#2B211C" fill-opacity=".2"/></svg>
  <a class="btn btn-icon" style="position:absolute;left:14px;top:14px;background:var(--surface);border-radius:50%;width:48px;height:48px">${BACK}</a>
  <div style="position:absolute;left:0;right:0;top:56px;text-align:center"><div style="display:inline-block;filter:drop-shadow(0 3px 0 #2B211C)">${FLAME(64)}</div><div style="font:400 38px/1.1 var(--font-display);color:var(--c-cream);text-shadow:0 3px 0 var(--c-ink);margin-top:4px">Clanfire</div></div>
</div>
<div style="padding:0 14px;margin-top:-34px;position:relative"><div class="c-card" style="padding:16px 16px 18px">
  <div class="tabs"><div class="tab">Sign in</div><div class="tab on">Create account</div></div>
  <div style="display:flex;flex-direction:column;gap:14px;margin-top:18px">
    <label class="field"><span>Username</span><div class="input"></div><small class="hint">3-20 letters, digits, _</small></label>
    <label class="field"><span>Password</span><div class="input"></div><small class="hint">Min 10 characters. Not common, no username.</small></label>
  </div>
  <a class="btn btn-primary btn-lg btn-block" style="margin-top:20px">Next</a></div></div>`, true);

files['c-worlds'] = page('C worlds', `
<div class="bar"><span class="logo">${FLAME(30)}Clanfire</span><div class="avatar">R</div></div>
<div style="padding:0 14px 24px">
  <h2 class="c-sec" style="margin-top:20px">Your worlds</h2>
  <div class="c-card c-big"><div class="ban">${tag('run', 'Running')}</div>
    <div class="bd"><h2>Hollow Marsh</h2><div class="meta" style="margin:3px 0 12px">Played 2 days ago</div><a class="btn btn-primary btn-lg btn-block" style="min-height:64px">Play</a></div>
    <div class="row" style="background:var(--surface-2);border-top:2.5px solid var(--c-ink);padding:8px 12px 8px 14px">${AV('First Light').replace('class="wav"', 'class="wav" style="width:40px;height:40px;border-radius:12px;border-width:2px"')}<div class="mid"><div class="l1"><span class="nm">First Light</span>${tag('done', 'Finished')}</div><div class="meta">Ended 40 days ago</div></div><a class="btn">Results</a></div>
  </div>
  <h2 class="c-sec">Join a world</h2>
  <div class="c-grid">${top3.map(cSm).join('')}${cMore}</div>
</div>`);

files['c-allworlds'] = page('C all worlds', `
<div class="bar"><a class="btn btn-icon" style="background:var(--surface)">${BACK}</a><span class="logo" style="font-size:24px;flex:1">All worlds</span></div>
<div style="padding:18px 14px 24px">${aTabs}
<div class="c-grid" style="margin-top:16px">${OPEN.map(cSm).join('')}</div></div>`);

for (const [k, v] of Object.entries(files)) writeFileSync(join(OUT, k + '.html'), v);
console.log(Object.keys(files).length, 'pages');
