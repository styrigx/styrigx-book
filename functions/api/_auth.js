// functions/api/_auth.js
// 主站五段式 cookie 鉴权（book 2.0/2.11）：sgx-verified = by.role.epoch.exp.sig
// 使用 functions/_sgx-cookie.js 的共享验签逻辑。
// 下划线开头，不会被 Pages 当作路由。

import { err } from './_lib.js';
import { verifySessionCookieStrict, getCookieValue, fetchSessionEpoch, fetchAppEpochFresh } from '../_sgx-cookie.js';
import { getAppCookieValue, parseAppToken, verifyAppToken, APP_AUD } from '../_app-token.js';

/**
 * 验签五段式 cookie，返回 role（'owner' | 'visitor'），无效返回 null。
 * 严格验签：by/role 白名单 + 签名 + exp + epoch（epoch 拿不到则 fail closed）。
 * 不抛错，调用方按 null 处理为未登录。
 */
export async function verifyOwnerCookie(request, env) {
  const val = getCookieValue(request);
  if (!val) return null;
  return verifySessionCookieStrict(val, env.SGX_LOCK_PUBLIC);
}

/**
 * 要求 owner 身份。用于 /api/admin/*（上传/管理）。
 * - 未登录/无效 cookie → 401
 * - visitor → 403（只读，无管理权限）
 * - owner → 通过（严格验签已检查签名 / exp / epoch，epoch 拿不到则 fail closed）
 * 用法：const { response } = await requireOwner(context); if (response) return response;
 */
export async function requireOwner(context) {
  const role = await verifyOwnerCookie(context.request, context.env);
  if (role === 'owner') {
    return { response: null };
  }
  if (role === 'visitor') {
    return { response: err('forbidden', 403) };
  }
  return { response: err('unauthorized', 401) };
}

/**
 * 要求有效的 sgx-app 通行证。用于书架 FAB 上传入口（/api/admin/upload/*、删除、换封面）。
 * 2.10.0：校验 SGX_APP_PUBLIC 验签 + aud=book + scope=upload + exp 有效 +
 *          session epoch 与主站当前一致 + appEpoch 不低于主站当前 app.book。
 * 缺失或无效一律 403（fail closed）。不区分 visitor/未登录，统一 403。
 * appEpoch 用强制刷新（不走 60 秒缓存）：init 必须看到最新值，
 * 过期 token 在 init 即 403 app-token-invalid，而不是放行后在 part 才 403。
 * 用法：const { response } = await requireAppToken(context); if (response) return response;
 */
export async function requireAppToken(context) {
  const { request, env } = context;
  const val = getAppCookieValue(request);
  if (!val) {
    return { response: err('app-token-required', 403) };
  }
  const latestEpoch = await fetchSessionEpoch();
  const latestAppEpoch = await fetchAppEpochFresh(APP_AUD);
  const ok = await verifyAppToken(val, env.SGX_APP_PUBLIC, latestEpoch, latestAppEpoch);
  if (!ok) {
    return { response: err('app-token-invalid', 403) };
  }
  // 成功时附带解析后的 token（调用方取 appEpoch 建上传会话；verifyAppToken 已全量校验过）
  return { response: null, app: parseAppToken(val) };
}
