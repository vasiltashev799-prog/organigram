// Логика за органиграмите: права, съхранение, проверка на данните.
// Няма зависимост от Netlify – хранилището и потребителят се подават отвън, за да се тества локално.

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

export const MAX_DATA_BYTES = 2_000_000;
export const ROLES = ['editor', 'viewer'];
const CONNS = ['elbow', 'curve', 'straight'];
const ARROWS = ['none', 'end', 'start', 'both'];

export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const isEmail = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* ---------- хранилище ---------- */
// интерфейс: read(key) -> { value, etag } | null ; write(key, value, { ifMatch | ifNew }) -> bool ; remove(key)
export function memoryStore() {
  const m = new Map(); let n = 0;
  return {
    async read(key) { const r = m.get(key); return r ? { value: JSON.parse(r.json), etag: r.etag } : null; },
    async write(key, value, cond = {}) {
      const r = m.get(key);
      if (cond.ifNew && r) return false;
      if (cond.ifMatch && (!r || r.etag !== cond.ifMatch)) return false;
      m.set(key, { json: JSON.stringify(value), etag: String(++n) }); return true;
    },
    async remove(key) { m.delete(key); },
  };
}
export function blobsStore(store) {
  return {
    async read(key) { const r = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' }); return r ? { value: r.data, etag: r.etag } : null; },
    async write(key, value, cond = {}) {
      const r = await store.setJSON(key, value, cond.ifMatch ? { onlyIfMatch: cond.ifMatch } : cond.ifNew ? { onlyIfNew: true } : {});
      return r.modified !== false;
    },
    async remove(key) { await store.delete(key); },
  };
}

// чете, променя и записва с проверка на версията; повтаря при едновременна промяна
async function update(store, key, fn) {
  for (let i = 0; i < 6; i++) {
    const r = await store.read(key);
    const next = fn(r ? r.value : null);
    if (next === undefined) return r ? r.value : null;
    const ok = await store.write(key, next, r ? { ifMatch: r.etag } : { ifNew: true });
    if (ok) return next;
  }
  throw new HttpError(503, 'Системата е заета, опитай пак.');
}

/* ---------- проверка на данните ---------- */
const HEX = /^#[0-9a-fA-F]{6}$/;
const PHOTO = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, d = 0) => (Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : d);

export function sanitizeData(d) {
  if (!d || typeof d !== 'object' || !d.S || !Array.isArray(d.S.nodes) || !Array.isArray(d.S.edges)) throw new HttpError(400, 'Невалидни данни за органиграма.');
  if (d.S.nodes.length > 1000 || d.S.edges.length > 3000) throw new HttpError(400, 'Органиграмата е твърде голяма.');
  const ids = new Set(), nodes = [];
  for (const n of d.S.nodes) {
    const id = str(n && n.id, 24);
    if (!/^[\w-]{1,24}$/.test(id) || ids.has(id)) throw new HttpError(400, 'Невалидно звено.');
    ids.add(id);
    const photo = typeof n.photo === 'string' && n.photo.length <= 80000 && PHOTO.test(n.photo) ? n.photo : '';
    nodes.push({ id, x: num(n.x), y: num(n.y), title: str(n.title, 200), name: str(n.name, 300), note: str(n.note, 2000),
      color: HEX.test(n.color) ? n.color : '#0a6cff', icon: str(n.icon, 8), photo });
  }
  const seen = new Set(), edges = [];
  for (const e of d.S.edges) {
    const id = str(e && e.id, 24);
    if (!/^[\w-]{1,24}$/.test(id) || seen.has(id) || !ids.has(e.a) || !ids.has(e.b)) continue;   // счупени връзки се пропускат
    seen.add(id);
    const port = (p) => (Number.isInteger(p) && p >= 0 && p <= 3 ? p : 0);
    const out = { id, a: e.a, b: e.b, pa: port(e.pa), pb: port(e.pb) };
    if (typeof e.color === 'string' && HEX.test(e.color)) out.color = e.color;
    if (Number.isFinite(e.glow)) out.glow = Math.max(0, Math.min(1, e.glow));
    if (ARROWS.includes(e.arrow)) out.arrow = e.arrow;
    edges.push(out);
  }
  const cfg = d.S.cfg && typeof d.S.cfg === 'object' ? d.S.cfg : {};
  const clean = {
    S: {
      nodes, edges,
      collapsed: (Array.isArray(d.S.collapsed) ? d.S.collapsed : []).filter((id) => ids.has(id)),
      cfg: { color: typeof cfg.color === 'string' && HEX.test(cfg.color) ? cfg.color : null, glow: Number.isFinite(cfg.glow) ? Math.max(0, Math.min(1, cfg.glow)) : 0.35, arrow: ARROWS.includes(cfg.arrow) ? cfg.arrow : 'none' },
    },
    conn: CONNS.includes(d.conn) ? d.conn : 'elbow',
  };
  if (JSON.stringify(clean).length > MAX_DATA_BYTES) throw new HttpError(413, 'Органиграмата е твърде голяма.');
  return clean;
}
const cleanTitle = (t) => { const s = str(t, 120).trim(); return s || 'Нова органиграма'; };

/* ---------- права ---------- */
export const roleOf = (chart, email) => (chart.owner === email ? 'owner' : chart.shares[email] || null);
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);

async function index(store, email, fn) {
  await update(store, 'idx/' + email, (cur) => { const ids = new Set((cur && cur.ids) || []); fn(ids); return { ids: [...ids] }; });
}

// ctx = { store, email }
async function load(ctx, id) {
  const r = typeof id === 'string' && /^[a-z0-9]{6,20}$/.test(id) ? await ctx.store.read('chart/' + id) : null;
  const role = r ? roleOf(r.value, ctx.email) : null;
  if (!role) throw new HttpError(404, 'Органиграмата не е намерена.');   // 404 и при липса на достъп – не издаваме, че съществува
  return { chart: r.value, etag: r.etag, role };
}

export async function createChart(ctx, { title, data }) {
  const now = new Date().toISOString(), id = newId();
  const chart = { id, owner: ctx.email, title: cleanTitle(title), data: sanitizeData(data), shares: {}, rev: 1, createdAt: now, updatedAt: now, updatedBy: ctx.email };
  if (!(await ctx.store.write('chart/' + id, chart, { ifNew: true }))) throw new HttpError(500, 'Не успя да се създаде.');
  await index(ctx.store, ctx.email, (s) => s.add(id));
  return { id, rev: 1 };
}

export async function listCharts(ctx) {
  const idx = await ctx.store.read('idx/' + ctx.email);
  const rows = await Promise.all(((idx && idx.value.ids) || []).map((id) => ctx.store.read('chart/' + id)));
  const charts = [];
  for (const r of rows) {
    if (!r) continue;
    const c = r.value, role = roleOf(c, ctx.email);
    if (!role) continue;
    charts.push({ id: c.id, title: c.title, owner: c.owner, role, updatedAt: c.updatedAt, updatedBy: c.updatedBy, sharedWith: Object.keys(c.shares).length });
  }
  charts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { charts };
}

export async function getChart(ctx, id) {
  const { chart, role } = await load(ctx, id);
  const out = { id: chart.id, title: chart.title, owner: chart.owner, role, rev: chart.rev, data: chart.data, updatedAt: chart.updatedAt, updatedBy: chart.updatedBy };
  if (role === 'owner') out.shares = chart.shares;
  return out;
}

export async function saveChart(ctx, id, { data, title, baseRev, force }) {
  const clean = data === undefined ? undefined : sanitizeData(data);
  for (let i = 0; i < 5; i++) {
    const { chart, etag, role } = await load(ctx, id);
    if (role === 'viewer') throw new HttpError(403, 'Имаш достъп само за четене.');
    if (!force && baseRev !== chart.rev) throw new HttpError(409, 'Някой друг е запазил по-нова версия.', { rev: chart.rev, updatedBy: chart.updatedBy });
    const next = { ...chart, rev: chart.rev + 1, updatedAt: new Date().toISOString(), updatedBy: ctx.email };
    if (clean !== undefined) next.data = clean;
    if (title !== undefined) next.title = cleanTitle(title);
    if (await ctx.store.write('chart/' + id, next, { ifMatch: etag })) return { rev: next.rev, updatedAt: next.updatedAt };
  }
  throw new HttpError(409, 'Някой друг е запазил по-нова версия.');
}

export async function deleteChart(ctx, id) {
  const { chart, role } = await load(ctx, id);
  if (role !== 'owner') throw new HttpError(403, 'Само собственикът може да изтрива.');
  await ctx.store.remove('chart/' + id);
  for (const email of [chart.owner, ...Object.keys(chart.shares)]) await index(ctx.store, email, (s) => s.delete(id));
  return { ok: true };
}

export async function shareChart(ctx, id, { email, role }) {
  const target = normEmail(email);
  if (!isEmail(target)) throw new HttpError(400, 'Невалиден имейл.');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Ролята трябва да е „editor“ или „viewer“.');
  const { chart, role: mine } = await load(ctx, id);
  if (mine !== 'owner') throw new HttpError(403, 'Само собственикът може да споделя.');
  if (target === chart.owner) throw new HttpError(400, 'Собственикът вече има достъп.');
  const next = await update(ctx.store, 'chart/' + id, (c) => { if (!c) throw new HttpError(404, 'Органиграмата не е намерена.'); return { ...c, shares: { ...c.shares, [target]: role } }; });
  await index(ctx.store, target, (s) => s.add(id));
  return { shares: next.shares };
}

export async function unshareChart(ctx, id, { email }) {
  const target = normEmail(email);
  const { chart, role } = await load(ctx, id);
  if (role !== 'owner' && target !== ctx.email) throw new HttpError(403, 'Нямаш право.');   // всеки може да напусне споделена органиграма
  if (target === chart.owner) throw new HttpError(400, 'Собственикът не може да бъде премахнат.');
  const next = await update(ctx.store, 'chart/' + id, (c) => {
    if (!c) throw new HttpError(404, 'Органиграмата не е намерена.');
    const shares = { ...c.shares }; delete shares[target]; return { ...c, shares };
  });
  await index(ctx.store, target, (s) => s.delete(id));
  return { shares: role === 'owner' ? next.shares : undefined };
}

/* ---------- защита срещу налучкване на парола ---------- */
const LOCK_AFTER = 8, WINDOW_MS = 15 * 60_000;
export async function loginLocked(store, email, now = Date.now()) {
  const r = await store.read('rl/' + email);
  return !!(r && r.value.until && r.value.until > now);
}
export async function loginFailed(store, email, now = Date.now()) {
  await update(store, 'rl/' + email, (c) => {
    const recent = c && c.first && now - c.first < WINDOW_MS && !(c.until && c.until <= now);
    const fails = recent ? c.fails + 1 : 1, first = recent ? c.first : now;
    return { fails, first, until: fails >= LOCK_AFTER ? now + WINDOW_MS : 0 };
  });
}
export const loginOk = (store, email) => store.remove('rl/' + email);

/* ---------- администрация (idp = Identity admin API) ---------- */
const needAdmin = (ctx) => { if (!ctx.isAdmin) throw new HttpError(403, 'Само за администратор.'); };
export async function adminListUsers(ctx, idp) {
  needAdmin(ctx);
  const users = await idp.listUsers({ perPage: 200 });
  return { users: users.map((u) => ({ id: u.id, email: u.email, createdAt: u.createdAt, lastSignInAt: u.lastSignInAt })).sort((a, b) => String(a.email).localeCompare(String(b.email))) };
}
export async function adminCreateUser(ctx, idp, { email, password }) {
  needAdmin(ctx);
  const e = normEmail(email);
  if (!isEmail(e)) throw new HttpError(400, 'Невалиден имейл.');
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Паролата трябва да е поне 8 символа.');
  const u = await idp.createUser({ email: e, password });
  return { id: u.id, email: u.email };
}
export async function adminSetPassword(ctx, idp, id, { password }) {
  needAdmin(ctx);
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Паролата трябва да е поне 8 символа.');
  await idp.updateUser(id, { password });
  return { ok: true };
}
export async function adminDeleteUser(ctx, idp, id) {
  needAdmin(ctx);
  if (id === ctx.userId) throw new HttpError(400, 'Не можеш да изтриеш собствения си акаунт.');
  await idp.deleteUser(id);
  return { ok: true };
}

// Еднократна първоначална настройка: създава първия администратор, само ако още няма потребители.
const sameStr = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
export async function setupFirstAdmin(idp, adminEmails, setupToken, { email, password, token }) {
  const e = normEmail(email);
  if (!setupToken || typeof token !== 'string' || !sameStr(token, setupToken)) throw new HttpError(403, 'Грешен код за настройка.');
  if (!adminEmails.has(e)) throw new HttpError(403, 'Този имейл не е в списъка на администраторите (ADMIN_EMAILS).');
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Паролата трябва да е поне 8 символа.');
  if ((await idp.listUsers({ perPage: 1 })).length) throw new HttpError(409, 'Настройката вече е направена.');
  const u = await idp.createUser({ email: e, password });
  return { id: u.id, email: u.email };
}
