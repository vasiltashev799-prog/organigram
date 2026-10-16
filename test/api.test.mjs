import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, sanitizeData } from '../netlify/lib/core.mjs';
import { route, parseAdmins } from '../netlify/lib/router.mjs';

// Подправен свят: сесията е в заглавие x-user, паролите са в Map
function world() {
  const store = memoryStore(), pw = new Map([['ana@x.bg', 'secret123'], ['bob@x.bg', 'secret123'], ['eve@x.bg', 'secret123']]);
  const users = new Map([['ana@x.bg', { id: '1' }], ['bob@x.bg', { id: '2' }], ['eve@x.bg', { id: '3' }]]);
  const deps = {
    store, adminEmails: parseAdmins('Ana@x.bg'),
    getUser: async (req) => { const e = req.headers.get('x-user'); return e && users.has(e) ? { id: users.get(e).id, email: e } : null; },
    login: async (e, p) => { if (pw.get(e) !== p) throw new Error('bad'); },
    logout: async () => {},
    checkOrigin: (req) => { if (req.headers.get('origin') !== 'https://t.test') { const e = new Error('csrf'); e.name = 'AuthError'; e.status = 403; throw e; } },
    idp: {
      listUsers: async () => [...users].map(([email, u]) => ({ id: u.id, email })),
      createUser: async ({ email }) => { users.set(email, { id: 'n' + users.size }); return { id: 'n', email }; },
      updateUser: async () => {}, deleteUser: async (id) => { for (const [e, u] of users) if (u.id === id) users.delete(e); },
    },
  };
  const call = async (as, method, path, body) => {
    const headers = { origin: 'https://t.test', 'content-type': 'application/json' }; if (as) headers['x-user'] = as;
    const res = await route(new Request('https://t.test/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), deps);
    return { status: res.status, body: await res.json() };
  };
  return { call, deps };
}
const data = (n = 2) => ({ S: { nodes: Array.from({ length: n }, (_, i) => ({ id: 'n' + i, x: i * 10, y: 0, title: 'T' + i, name: '', note: '', color: '#0a6cff', icon: '', photo: '' })), edges: n > 1 ? [{ id: 'e1', a: 'n0', b: 'n1', pa: 2, pb: 0 }] : [], collapsed: [], cfg: { color: null, glow: 0.35 } }, conn: 'elbow' });

test('без вход няма достъп', async () => {
  const { call } = world();
  assert.equal((await call(null, 'GET', '/charts')).status, 401);
  assert.equal((await call(null, 'GET', '/me')).status, 401);
});

test('собственикът създава, чете, записва; другите не виждат нищо', async () => {
  const { call } = world();
  const c = await call('ana@x.bg', 'POST', '/charts', { title: 'Моята', data: data() });
  assert.equal(c.status, 200);
  const id = c.body.id;
  assert.equal((await call('ana@x.bg', 'GET', '/charts')).body.charts.length, 1);
  assert.equal((await call('bob@x.bg', 'GET', '/charts')).body.charts.length, 0);
  assert.equal((await call('bob@x.bg', 'GET', '/charts/' + id)).status, 404);          // не издаваме, че съществува
  assert.equal((await call('bob@x.bg', 'PUT', '/charts/' + id, { data: data(), baseRev: 1 })).status, 404);
  assert.equal((await call('bob@x.bg', 'DELETE', '/charts/' + id)).status, 404);
  const g = await call('ana@x.bg', 'GET', '/charts/' + id);
  assert.equal(g.body.role, 'owner'); assert.equal(g.body.data.S.nodes.length, 2);
});

test('споделяне: viewer чете, не пише; editor пише, не споделя и не трие', async () => {
  const { call } = world();
  const id = (await call('ana@x.bg', 'POST', '/charts', { title: 'A', data: data() })).body.id;
  assert.equal((await call('ana@x.bg', 'POST', `/charts/${id}/shares`, { email: ' BOB@x.bg ', role: 'viewer' })).status, 200);
  assert.equal((await call('ana@x.bg', 'POST', `/charts/${id}/shares`, { email: 'eve@x.bg', role: 'editor' })).status, 200);
  assert.equal((await call('bob@x.bg', 'GET', '/charts')).body.charts[0].role, 'viewer');
  const b = await call('bob@x.bg', 'GET', '/charts/' + id);
  assert.equal(b.body.role, 'viewer'); assert.equal(b.body.shares, undefined);          // само собственикът вижда списъка
  assert.equal((await call('bob@x.bg', 'PUT', '/charts/' + id, { data: data(3), baseRev: 1 })).status, 403);
  assert.equal((await call('eve@x.bg', 'PUT', '/charts/' + id, { data: data(3), baseRev: 1 })).status, 200);
  assert.equal((await call('eve@x.bg', 'POST', `/charts/${id}/shares`, { email: 'bob@x.bg', role: 'editor' })).status, 403);
  assert.equal((await call('eve@x.bg', 'DELETE', `/charts/${id}`)).status, 403);
  // сменя ролята и отнема достъпа
  await call('ana@x.bg', 'POST', `/charts/${id}/shares`, { email: 'bob@x.bg', role: 'editor' });
  assert.equal((await call('bob@x.bg', 'PUT', '/charts/' + id, { data: data(3), baseRev: 2 })).status, 200);
  await call('ana@x.bg', 'DELETE', `/charts/${id}/shares`, { email: 'bob@x.bg' });
  assert.equal((await call('bob@x.bg', 'GET', '/charts/' + id)).status, 404);
  assert.equal((await call('bob@x.bg', 'GET', '/charts')).body.charts.length, 0);
});

test('напускане на споделена органиграма; чужд не може да маха други', async () => {
  const { call } = world();
  const id = (await call('ana@x.bg', 'POST', '/charts', { data: data() })).body.id;
  await call('ana@x.bg', 'POST', `/charts/${id}/shares`, { email: 'bob@x.bg', role: 'viewer' });
  await call('ana@x.bg', 'POST', `/charts/${id}/shares`, { email: 'eve@x.bg', role: 'viewer' });
  assert.equal((await call('bob@x.bg', 'DELETE', `/charts/${id}/shares`, { email: 'eve@x.bg' })).status, 403);
  assert.equal((await call('bob@x.bg', 'DELETE', `/charts/${id}/shares`, { email: 'bob@x.bg' })).status, 200);
  assert.equal((await call('bob@x.bg', 'GET', '/charts/' + id)).status, 404);
  assert.equal((await call('eve@x.bg', 'GET', '/charts/' + id)).status, 200);
});

test('конфликт при запис: втори редактор с остаряла версия получава 409', async () => {
  const { call } = world();
  const id = (await call('ana@x.bg', 'POST', '/charts', { data: data() })).body.id;
  await call('ana@x.bg', 'POST', `/charts/${id}/shares`, { email: 'bob@x.bg', role: 'editor' });
  assert.equal((await call('ana@x.bg', 'PUT', '/charts/' + id, { data: data(3), baseRev: 1 })).body.rev, 2);
  const r = await call('bob@x.bg', 'PUT', '/charts/' + id, { data: data(4), baseRev: 1 });
  assert.equal(r.status, 409); assert.equal(r.body.rev, 2);
  assert.equal((await call('bob@x.bg', 'PUT', '/charts/' + id, { data: data(4), baseRev: 1, force: true })).status, 200);
  assert.equal((await call('ana@x.bg', 'GET', '/charts/' + id)).body.data.S.nodes.length, 4);
});

test('споделянето не чупи записа на друг (само промяна на достъпа, не на версията)', async () => {
  const { call } = world();
  const id = (await call('ana@x.bg', 'POST', '/charts', { data: data() })).body.id;
  await call('ana@x.bg', 'POST', `/charts/${id}/shares`, { email: 'bob@x.bg', role: 'editor' });
  assert.equal((await call('bob@x.bg', 'PUT', '/charts/' + id, { data: data(), baseRev: 1 })).status, 200);
});

test('изтриване от собственика чисти индексите', async () => {
  const { call } = world();
  const id = (await call('ana@x.bg', 'POST', '/charts', { data: data() })).body.id;
  await call('ana@x.bg', 'POST', `/charts/${id}/shares`, { email: 'bob@x.bg', role: 'viewer' });
  assert.equal((await call('ana@x.bg', 'DELETE', '/charts/' + id)).status, 200);
  assert.equal((await call('ana@x.bg', 'GET', '/charts')).body.charts.length, 0);
  assert.equal((await call('bob@x.bg', 'GET', '/charts')).body.charts.length, 0);
  assert.equal((await call('bob@x.bg', 'GET', '/charts/' + id)).status, 404);
});

test('валидация на споделяне', async () => {
  const { call } = world();
  const id = (await call('ana@x.bg', 'POST', '/charts', { data: data() })).body.id;
  assert.equal((await call('ana@x.bg', 'POST', `/charts/${id}/shares`, { email: 'не-имейл', role: 'viewer' })).status, 400);
  assert.equal((await call('ana@x.bg', 'POST', `/charts/${id}/shares`, { email: 'bob@x.bg', role: 'owner' })).status, 400);
  assert.equal((await call('ana@x.bg', 'POST', `/charts/${id}/shares`, { email: 'ana@x.bg', role: 'viewer' })).status, 400);
});

test('данните се почистват: лоши цветове, снимки, счупени връзки, дублирани id', () => {
  const d = data(); d.S.nodes[0].color = 'red;background:url(x)'; d.S.nodes[0].photo = 'javascript:alert(1)'; d.S.nodes[1].photo = 'data:image/png;base64,AAAA';
  d.S.edges.push({ id: 'e2', a: 'n0', b: 'липсва', pa: 9, pb: 0 });
  const c = sanitizeData(d);
  assert.equal(c.S.nodes[0].color, '#0a6cff'); assert.equal(c.S.nodes[0].photo, ''); assert.equal(c.S.nodes[1].photo, 'data:image/png;base64,AAAA');
  assert.equal(c.S.edges.length, 1);
  const dup = data(); dup.S.nodes[1].id = 'n0';
  assert.throws(() => sanitizeData(dup), /Невалидно звено/);
  assert.throws(() => sanitizeData({}), /Невалидни данни/);
});

test('CSRF: заявка за промяна без правилен Origin се отказва', async () => {
  const { deps } = world();
  const res = await route(new Request('https://t.test/api/charts', { method: 'POST', headers: { 'x-user': 'ana@x.bg', origin: 'https://evil.test' }, body: '{}' }), deps);
  assert.equal(res.status, 403);
});

test('заключване след много грешни пароли', async () => {
  const { call } = world();
  for (let i = 0; i < 8; i++) assert.equal((await call(null, 'POST', '/login', { email: 'bob@x.bg', password: 'грешна' + i })).status, 401);
  assert.equal((await call(null, 'POST', '/login', { email: 'bob@x.bg', password: 'secret123' })).status, 429);   // дори с вярната
  assert.equal((await call(null, 'POST', '/login', { email: 'eve@x.bg', password: 'secret123' })).status, 200);   // други не са засегнати
});

test('администрация: само за админ', async () => {
  const { call } = world();
  assert.equal((await call('bob@x.bg', 'GET', '/admin/users')).status, 403);
  assert.equal((await call('bob@x.bg', 'POST', '/admin/users', { email: 'n@x.bg', password: '12345678' })).status, 403);
  assert.equal((await call('ana@x.bg', 'GET', '/admin/users')).body.users.length, 3);
  assert.equal((await call('ana@x.bg', 'POST', '/admin/users', { email: 'N@x.bg', password: 'къс' })).status, 400);
  assert.equal((await call('ana@x.bg', 'POST', '/admin/users', { email: 'N@x.bg', password: 'дълга-парола-1' })).status, 200);
  assert.equal((await call('ana@x.bg', 'DELETE', '/admin/users/1')).status, 400);                                  // не себе си
  assert.equal((await call('ana@x.bg', 'DELETE', '/admin/users/2')).status, 200);
  assert.equal((await call('bob@x.bg', 'GET', '/me')).status, 401);                                                // изтрит
  assert.equal((await call('ana@x.bg', 'GET', '/me')).body.isAdmin, true);
});

test('първоначална настройка: само с код, само за админ имейл, само веднъж', async () => {
  const { call, deps } = world(); deps.setupToken = 'tajen-kod';
  deps.idp.listUsers = async () => [];
  assert.equal((await call(null, 'POST', '/setup', { email: 'ana@x.bg', password: '12345678', token: 'грешен' })).status, 403);
  assert.equal((await call(null, 'POST', '/setup', { email: 'bob@x.bg', password: '12345678', token: 'tajen-kod' })).status, 403);   // не е админ
  assert.equal((await call(null, 'POST', '/setup', { email: 'ana@x.bg', password: 'къс', token: 'tajen-kod' })).status, 400);
  assert.equal((await call(null, 'POST', '/setup', { email: 'ana@x.bg', password: '12345678', token: 'tajen-kod' })).status, 200);
  deps.idp.listUsers = async () => [{ id: '1', email: 'ana@x.bg' }];
  assert.equal((await call(null, 'POST', '/setup', { email: 'ana@x.bg', password: '12345678', token: 'tajen-kod' })).status, 409);     // вече има потребители
  deps.setupToken = '';
  assert.equal((await call(null, 'POST', '/setup', { email: 'ana@x.bg', password: '12345678', token: '' })).status, 403);               // без зададен код е изключено
});

test('стрелките се запазват, а невалидни стойности се отхвърлят', () => {
  const d = data(); d.S.cfg.arrow = 'both'; d.S.edges[0].arrow = 'start';
  let c = sanitizeData(d);
  assert.equal(c.S.cfg.arrow, 'both'); assert.equal(c.S.edges[0].arrow, 'start');
  d.S.cfg.arrow = '<img>'; d.S.edges[0].arrow = 'x';
  c = sanitizeData(d);
  assert.equal(c.S.cfg.arrow, 'none'); assert.equal(c.S.edges[0].arrow, undefined);
});
