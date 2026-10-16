// HTTP маршрути на /api. Зависимостите (потребител, вход, хранилище) се подават отвън.
import * as core from './core.mjs';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

export const parseAdmins = (s) => new Set(String(s || '').split(',').map(core.normEmail).filter(Boolean));

/* deps: { store, idp, adminEmails:Set, getUser(req), login(email,pw), logout(), checkOrigin(req) } */
export async function route(req, deps) {
  try {
    const url = new URL(req.url), path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/', m = req.method;
    if (m !== 'GET' && m !== 'HEAD') deps.checkOrigin(req);   // защита от CSRF при промяна на данни
    const body = async () => { try { return (await req.json()) || {}; } catch { throw new core.HttpError(400, 'Невалидна заявка.'); } };

    if (path === '/login' && m === 'POST') {
      const { email, password } = await body(), e = core.normEmail(email);
      if (!core.isEmail(e) || typeof password !== 'string' || !password) throw new core.HttpError(400, 'Въведи имейл и парола.');
      if (await core.loginLocked(deps.store, e)) throw new core.HttpError(429, 'Твърде много опити. Опитай след 15 минути.');
      try { await deps.login(e, password, req); } catch {
        await core.loginFailed(deps.store, e);
        throw new core.HttpError(401, 'Грешен имейл или парола.');
      }
      await core.loginOk(deps.store, e);
      return json(200, { ok: true });
    }
    if (path === '/setup' && m === 'POST') return json(200, await core.setupFirstAdmin(deps.idp, deps.adminEmails, deps.setupToken, await body()));
    if (path === '/logout' && m === 'POST') { await deps.logout(req); return json(200, { ok: true }); }

    const user = await deps.getUser(req);
    if (!user || !user.email) throw new core.HttpError(401, 'Не си влязъл.');
    const email = core.normEmail(user.email), isAdmin = deps.adminEmails.has(email) || (user.roles || []).includes('admin');
    const ctx = { store: deps.store, email, isAdmin, userId: user.id };

    if (path === '/me' && m === 'GET') return json(200, { email, name: user.name || '', isAdmin });

    let r;
    if (path === '/charts' && m === 'GET') r = await core.listCharts(ctx);
    else if (path === '/charts' && m === 'POST') r = await core.createChart(ctx, await body());
    else if (path === '/admin/users' && m === 'GET') r = await core.adminListUsers(ctx, deps.idp);
    else if (path === '/admin/users' && m === 'POST') r = await core.adminCreateUser(ctx, deps.idp, await body());
    else {
      let mm;
      if ((mm = path.match(/^\/charts\/([^/]+)$/))) {
        if (m === 'GET') r = await core.getChart(ctx, mm[1]);
        else if (m === 'PUT') r = await core.saveChart(ctx, mm[1], await body());
        else if (m === 'DELETE') r = await core.deleteChart(ctx, mm[1]);
      } else if ((mm = path.match(/^\/charts\/([^/]+)\/shares$/))) {
        if (m === 'POST') r = await core.shareChart(ctx, mm[1], await body());
        else if (m === 'DELETE') r = await core.unshareChart(ctx, mm[1], await body());
      } else if ((mm = path.match(/^\/admin\/users\/([^/]+)$/))) {
        if (m === 'PUT') r = await core.adminSetPassword(ctx, deps.idp, mm[1], await body());
        else if (m === 'DELETE') r = await core.adminDeleteUser(ctx, deps.idp, mm[1]);
      }
    }
    if (r === undefined) throw new core.HttpError(404, 'Няма такъв адрес.');
    return json(200, r);
  } catch (err) {
    if (err instanceof core.HttpError) return json(err.status, { error: err.message, ...(err.extra || {}) });
    if (err && err.name === 'AuthError' && err.status) return json(err.status === 403 ? 403 : 400, { error: 'Заявката е отказана.' });
    console.error('api error', err);
    return json(500, { error: 'Вътрешна грешка.' });
  }
}
