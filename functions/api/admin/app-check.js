// GET /api/admin/app-check — sgx-app 通行证预检（轻量）。
// 前端在打开上传弹层、用户选文件之前先调：通行证无效时直接跳主站复验，
// 而不是传到一半再跳。只验 owner + sgx-app，不做任何重操作。
// → {ok:true}；缺/无效通行证 → 403（app-token-required / app-token-invalid）
import { json, methodNotAllowed } from '../_lib.js';
import { requireOwner, requireAppToken } from '../_auth.js';

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const { response } = await requireOwner(context);
  if (response) return response;
  const { response: appResp } = await requireAppToken(context);
  if (appResp) return appResp;
  return json({ ok: true });
}
