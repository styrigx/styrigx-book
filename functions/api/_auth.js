// functions/api/_auth.js
// 主站四段式 cookie 鉴权（book 2.0）：sgx-verified = role.epoch.exp.sig
// 使用 functions/_sgx-cookie.js 的共享验签逻辑。
// 下划线开头，不会被 Pages 当作路由。

import { err } from './_lib.js';
import { verifySessionCookie, getCookieValue } from '../_sgx-cookie.js';

/**
 * 验签四段式 cookie，返回 role（'owner' | 'visitor'），无效返回 null。
 * 不抛错，调用方按 null 处理为未登录。
 */
export async function verifyOwnerCookie(request, env) {
  const val = getCookieValue(request);
  if (!val) return null;
  return verifySessionCookie(val, env.SGX_ED25519_PUBLIC);
}

/**
 * 要求 owner 身份。非 owner（含未登录、visitor）返回 401 Response，调用方直接 return。
 * 用法：const { response } = await requireOwner(context); if (response) return response;
 */
export async function requireOwner(context) {
  const role = await verifyOwnerCookie(context.request, context.env);
  if (role !== 'owner') {
    return { response: err('unauthorized', 401) };
  }
  return { response: null };
}
