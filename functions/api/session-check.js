// GET /api/session-check — 锁屏会话确认（L6 前端 visibilitychange / pageshow 调用）
//
// 会话有效（owner 或 visitor，五段式 by.role.epoch.exp.sig，验签 + exp + epoch
// 均通过，epoch 检查 fail closed）→ 200 {ok:true}；否则 → 401 {ok:false}。
// 未启用锁屏（SGX_SITE !== 'book'）→ 200 {ok:true}，与 middleware 放行一致。
// 一律 Cache-Control: no-store。
// 注意：middleware 白名单放行此路径，由本接口自己验签、自己返回 401
// （而不是 302 到锁屏），前端才能区分“已锁定”（→ reload 走 302 到主站锁屏）
// 与“网络错误”（→ fail open，不 reload）。
//
// 不碰 D1：本接口只验签 cookie，不读 styrigx-books。
import { json, methodNotAllowed } from './_lib.js';
import { verifySessionCookieStrict, getCookieValue } from '../_sgx-cookie.js';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const { env } = context;
  /* 未启用锁屏：直接通过，与 middleware 放行逻辑一致 */
  if (!env || env.SGX_SITE !== 'book') return json({ ok: true }, 200, NO_STORE);
  const cookieValue = getCookieValue(context.request);
  const role = await verifySessionCookieStrict(cookieValue, env.SGX_LOCK_PUBLIC);
  const ok = role === 'owner' || role === 'visitor';
  return json({ ok }, ok ? 200 : 401, NO_STORE);
}
