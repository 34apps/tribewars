// After world-finish: each account takes a fresh entry pass so the world stores `bdg` (badge summary) on its player.
const BASE = 'http://127.0.0.1:5410', PW = 'e2e-Passw0rd-badges';
const h = { 'content-type': 'application/json', origin: BASE };
for (const n of ['kestrel', 'raven', 'thistle']) {
  let r = await fetch(BASE + '/lobby/api/auth/login', { method: 'POST', headers: h, body: JSON.stringify({ username: n, password: PW }) });
  const c = r.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ');
  const me = await (await fetch(BASE + '/lobby/api/auth/me', { headers: { ...h, cookie: c } })).json();
  console.log(n, 'lobby badges', me.account.badges.map((b) => b.badge + (b.place ? '#' + b.place : '')).join(',') || '(none)');
  r = await fetch(BASE + '/lobby/api/worlds/w1/enter', { method: 'POST', headers: { ...h, cookie: c }, body: '{}' });
  const { pass } = await r.json();
  r = await fetch(BASE + '/w/w1/api/auth/enter', { method: 'POST', headers: h, body: JSON.stringify({ pass }) });
  console.log(n, 'enter', r.status);
}
