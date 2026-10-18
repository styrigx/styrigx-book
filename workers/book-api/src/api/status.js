// GET /api/status — 公开状态（无需 Access）
// → {storage_enabled: bool}：R2 存储是否启用。前端据此显示「上传暂未开放」。
import { json, methodNotAllowed, storageEnabled } from './_lib.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return methodNotAllowed('GET');
  return json({ storage_enabled: storageEnabled(env) });
}
