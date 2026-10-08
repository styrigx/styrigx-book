// GET /api/private/me — 返回当前登录用户的 email（JWT claims）
import { json, methodNotAllowed } from '../_lib.js';
import { requireAccess } from '../_access.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const { claims, response } = await requireAccess(context);
  if (response) return response;
  return json({ email: claims.email || '' });
}
