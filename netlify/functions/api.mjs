import { getStore } from '@netlify/blobs';
import { getUser, login, logout, admin, verifyRequestOrigin } from '@netlify/identity';
import { blobsStore } from '../lib/core.mjs';
import { route, parseAdmins } from '../lib/router.mjs';

export const config = { path: '/api/*' };

export default async (req) => route(req, {
  store: blobsStore(getStore({ name: 'organigram', consistency: 'strong' })),
  idp: admin,
  adminEmails: parseAdmins(process.env.ADMIN_EMAILS),
  getUser: () => getUser(),
  login: (email, password) => login(email, password),
  logout: () => logout(),
  checkOrigin: (r) => verifyRequestOrigin(r),
});
