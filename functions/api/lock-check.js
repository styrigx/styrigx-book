/**
 * GET /api/lock-check
 * 供已打开的标签页主动检查会话是否仍然有效。
 * 不在白名单里，走和页面完全相同的中间件校验逻辑。
 * 通过返回 204，失败返回 401 {ok:false, why}（不要 302，fetch 会跟随跳转）。
 * Cache-Control: no-store。
 */
import { verifySessionCookieStrict, getCookieValue } from '../_sgx-cookie.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env || env.SGX_SITE !== 'book') {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const publicKeyPem = env.SGX_LOCK_PUBLIC;
  if (!publicKeyPem) {
    return Response.json(
      { ok: false, why: 'no-config' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const val = getCookieValue(request);
  if (!val) {
    return Response.json(
      { ok: false, why: 'no-cookie' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  /* 与 middleware 完全相同的校验逻辑（含 epoch，fail closed） */
  const role = await verifySessionCookieStrict(val, publicKeyPem);
  if (!role) {
    return Response.json(
      { ok: false, why: 'sig' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
