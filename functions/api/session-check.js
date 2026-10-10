// GET /api/session-check — 锁屏会话确认（L6 前端 visibilitychange / pageshow 调用）
//
// sgx-verified cookie 验签为 owner（四段式 role.epoch.exp.sig）→ 200 {ok:true}；
// 否则 → 401 {ok:false}。book 主人专属：visitor 也视为未通过。
// 一律 Cache-Control: no-store。
// 注意：middleware 白名单放行此路径，由本接口自己验签、自己返回 401
// （而不是 302 到锁屏），前端才能区分“已锁定”（→ reload 走 302 到主站锁屏）
// 与“网络错误”（→ fail open，不 reload）。
//
// 不碰 D1：本接口只验签 cookie，不读 styrigx-books。
import { json, methodNotAllowed } from './_lib.js';
import { verifySessionCookie } from '../_middleware.js';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const ok = await verifySessionCookie(context.request, context.env);
  return json({ ok }, ok ? 200 : 401, NO_STORE);
}
