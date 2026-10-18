// GET /api/private/me — 返回当前登录状态（2.0：主站 cookie 鉴权，无 email）
import { json, methodNotAllowed } from '../_lib.js';
import { requireOwner } from '../_auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const { response } = await requireOwner(context);
  if (response) return response;
  return json({ role: 'owner' });
}
