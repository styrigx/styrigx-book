// workers/book-api/src/api/_auth.js
// 书库接口鉴权：本 Worker 不持任何钥匙，把浏览器带来的 Cookie 头交给主站鉴权网关验
// （服务绑定 env.AUTH → styrigx-auth-gateway 的 RPC 入口 SessionVerifier）。
// 网关用自己的公钥验签、用 KV 的 epoch 核对，只回结论 {ok, role} / {ok, appEpoch}。
// fail closed：回答格式不对一律当未通过。会话检查时绑定缺失或网关出错直接抛错（调用方回 500），
// 不回 401——401 会让前端当成「已锁定」去刷新页面，网关临时故障不该把人踢去锁屏。
// 下划线开头：不是接口，只供其它接口 import（路由表见 src/routes.js）。
import { err } from './_lib.js';

export const APP_AUD = 'book';
export const APP_SCOPE = 'upload';

function cookieHeader(request) {
  return request.headers.get('Cookie') || '';
}

function gateway(env) {
  const a = env && env.AUTH;
  return a && typeof a.session === 'function' ? a : null;
}

/**
 * 会话角色：'owner' | 'visitor'；会话无效返回 null；绑定缺失或网关出错抛错。
 * @param {Request} request
 * @param {Record<string, any>} env
 */
export async function verifySession(request, env) {
  const auth = gateway(env);
  if (!auth) {
    console.error('[book-auth] AUTH binding missing');
    throw new Error('auth-binding-missing');
  }
  const r = await auth.session(cookieHeader(request));
  if (r && r.ok === true && (r.role === 'owner' || r.role === 'visitor')) return r.role;
  return null;
}

/* 兼容旧名：只认 owner/visitor */
export const verifyOwnerCookie = verifySession;

/**
 * 要求 owner 身份。用于 /api/admin/*、/api/private/*。
 * - 未登录/无效 → 401；visitor → 403（只读）；owner → 通过
 * 用法：const { response } = await requireOwner(context); if (response) return response;
 */
export async function requireOwner(context) {
  const role = await verifySession(context.request, context.env);
  if (role === 'owner') return { response: null };
  if (role === 'visitor') return { response: err('forbidden', 403) };
  return { response: err('unauthorized', 401) };
}

/**
 * 要求有效的 sgx-app 通行证（aud=book、scope=upload）。用于上传、删除、换封面。
 * 网关核对：验签 + aud/scope + exp + session epoch + appEpoch 不低于当前。
 * 缺失 → 403 app-token-required；其余无效 → 403 app-token-invalid。
 * 成功时带 app.appEpoch（上传会话绑定用）。
 */
export async function requireAppToken(context) {
  const auth = gateway(context.env);
  if (!auth || typeof auth.appPass !== 'function') return { response: err('app-token-invalid', 403) };
  let r;
  try {
    r = await auth.appPass(cookieHeader(context.request), APP_AUD, APP_SCOPE);
  } catch (e) {
    console.error('[book-auth] gateway error: ' + (e && e.name ? e.name : 'error'));
    return { response: err('app-token-invalid', 403) };
  }
  if (r && r.ok === true && Number.isFinite(r.appEpoch)) {
    return { response: null, app: { appEpoch: r.appEpoch } };
  }
  if (r && r.reason === 'no-pass') return { response: err('app-token-required', 403) };
  return { response: err('app-token-invalid', 403) };
}

/**
 * 书库应用当前纪元（上传中途核对；删过 book 的应用通行密钥后加一）。拿不到返回 null（调用方 fail closed）。
 * @param {Record<string, any>} env
 */
export async function currentAppEpoch(env) {
  const auth = gateway(env);
  if (!auth || typeof auth.appEpoch !== 'function') return null;
  try {
    const r = await auth.appEpoch(APP_AUD);
    return r && r.ok === true && Number.isFinite(r.appEpoch) ? r.appEpoch : null;
  } catch (e) {
    return null;
  }
}
