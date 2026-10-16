// Локален сървър за проба БЕЗ Netlify: същият /api код, но с памет вместо Blobs и фалшив вход.
// Старт: npm run dev  ->  http://localhost:8899   (ana@test.bg / bob@test.bg / eve@test.bg, парола: parola123)
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { memoryStore, createChart, shareChart } from '../netlify/lib/core.mjs';
import { route, parseAdmins } from '../netlify/lib/router.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8899), ORIGIN = `http://localhost:${PORT}`;
const users = new Map([['ana@test.bg', { id: '1' }], ['bob@test.bg', { id: '2' }], ['eve@test.bg', { id: '3' }]]);
const pass = new Map([...users.keys()].map((e) => [e, 'parola123']));
const store = memoryStore();

const cookieUser = (req) => { const m = /(?:^|; )dev=([^;]+)/.exec(req.headers.get('cookie') || ''); return m ? decodeURIComponent(m[1]) : null; };
const deps = {
  store, adminEmails: parseAdmins('ana@test.bg'),
  getUser: async (req) => { const e = cookieUser(req); return e && users.has(e) ? { id: users.get(e).id, email: e } : null; },
  login: async (e, p) => { if (pass.get(e) !== p) throw new Error('bad'); },
  logout: async () => {},
  checkOrigin: (req) => { if (req.headers.get('origin') !== ORIGIN) { const e = new Error('csrf'); e.name = 'AuthError'; e.status = 403; throw e; } },
  idp: {
    listUsers: async () => [...users].map(([email, u]) => ({ id: u.id, email })),
    createUser: async ({ email, password }) => { users.set(email, { id: String(users.size + 1) }); pass.set(email, password); return { id: String(users.size), email }; },
    updateUser: async (id, { password }) => { for (const [e, u] of users) if (u.id === id) pass.set(e, password); },
    deleteUser: async (id) => { for (const [e, u] of users) if (u.id === id) users.delete(e); },
  },
};

// малко данни за проба
const node = (id, title, name, x, y, color) => ({ id, x, y, title, name, note: '', color, icon: '', photo: '' });
const seed = { S: { nodes: [node('a', 'Управление', 'Мария Георгиева', 0, 0, '#0a6cff'), node('b', 'Продажби', 'Иван Петров', -160, 170, '#00b4e6'), node('c', 'Производство', 'Стоян Димитров', 160, 170, '#6d5dfc')],
  edges: [{ id: 'e1', a: 'a', b: 'b', pa: 2, pb: 0 }, { id: 'e2', a: 'a', b: 'c', pa: 2, pb: 0 }], collapsed: [], cfg: { color: null, glow: 0.35 } }, conn: 'elbow' };
const ana = { store, email: 'ana@test.bg' };
const { id } = await createChart(ana, { title: 'Компания 2026', data: seed });
await shareChart(ana, id, { email: 'bob@test.bg', role: 'viewer' });
await shareChart(ana, id, { email: 'eve@test.bg', role: 'editor' });
await createChart(ana, { title: 'Само за Ана', data: seed });

http.createServer(async (rq, rs) => {
  try {
    if (!rq.url.startsWith('/api/')) { rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); rs.end(readFileSync(join(root, 'ropes/index.html'))); return; }
    const chunks = []; for await (const c of rq) chunks.push(c);
    const req = new Request(ORIGIN + rq.url, { method: rq.method, headers: rq.headers, body: ['GET', 'HEAD'].includes(rq.method) ? undefined : Buffer.concat(chunks) });
    const res = await route(req, deps), text = await res.text(), headers = Object.fromEntries(res.headers);
    const p = new URL(req.url).pathname;
    if (p === '/api/login' && res.status === 200) headers['set-cookie'] = `dev=${encodeURIComponent(JSON.parse(Buffer.concat(chunks).toString()).email.trim().toLowerCase())}; Path=/; HttpOnly; SameSite=Lax`;
    if (p === '/api/logout') headers['set-cookie'] = 'dev=; Path=/; Max-Age=0';
    rs.writeHead(res.status, headers); rs.end(text);
  } catch (e) { console.error(e); rs.writeHead(500); rs.end('error'); }
}).listen(PORT, () => console.log(`Проба: ${ORIGIN}  (ana@test.bg е администратор; парола parola123)`));
