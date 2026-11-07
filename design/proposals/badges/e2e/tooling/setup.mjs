// Register accounts in the throwaway lobby, enter world w1 with each (real entry pass), found a tribe. Ports: via vite proxy 5410.
const BASE = 'http://127.0.0.1:5410';
const PW = 'e2e-Passw0rd-badges';
const names = ['ember_fox', 'kestrel', 'raven', 'thistle'];
async function call(jar, method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', cookie: jar.c || '', origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) { const m = new Map(); for (const s of sc) { const [k, v] = s.split(';')[0].split('='); m.set(k, v); } jar.c = [...m].filter(([, v]) => v).map(([k, v]) => k + '=' + v).join('; '); }
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return j;
}
const jars = {};
for (const n of names) {
  const lj = {}; const wj = {};
  try { await call(lj, 'POST', '/lobby/api/auth/register', { username: n, password: PW }); } catch { await call(lj, 'POST', '/lobby/api/auth/login', { username: n, password: PW }); }
  const { pass } = await call(lj, 'POST', '/lobby/api/worlds/w1/enter', {});
  const me = await call(wj, 'POST', '/w/w1/api/auth/enter', { pass });
  jars[n] = wj;
  console.log('entered', n, JSON.stringify(me).slice(0, 120));
}
const only = process.argv[2]; const t = await call(jars.ember_fox, 'POST', '/w/w1/api/tribes', { name: 'Ember Foxes', tag: 'EMF', description: 'e2e', recruitment: 'open' });
const tid = t.tribe?.id ?? t.id;
console.log('tribe', JSON.stringify(t).slice(0, 150), tid);
await call(jars.kestrel, 'POST', `/w/w1/api/tribes/${tid}/join`);
await call(jars.thistle, 'POST', `/w/w1/api/tribes/${tid}/join`);
console.log('joined');
