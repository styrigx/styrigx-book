// functions/api/_auth.js
// 主站四段式 cookie 鉴权（book 2.0）：sgx-verified = role.epoch.exp.sig
// role ∈ {owner, visitor}；sig = Ed25519(SGX_ED25519_PUBLIC, "role.epoch.exp")
// 下划线开头，不会被 Pages 当作路由。

import { err } from './_lib.js';

const COOKIE_NAME = 'sgx-verified';

function b64urlToBytes(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let pubKeyCache = null;
async function getPublicKey(spkiB64) {
  if (pubKeyCache) return pubKeyCache;
  // raw base64 SPKI DER → CryptoKey（无 PEM 头尾）
  const der = b64ToBytes(spkiB64.replace(/\s/g, ''));
  pubKeyCache = await crypto.subtle.importKey(
    'spki',
    der,
    { name: 'Ed25519' },
    false,
    ['verify']
  );
  return pubKeyCache;
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const parts = header.split(';');
  for (const p of parts) {
    const [k, ...v] = p.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/**
 * 验签四段式 cookie，返回 role（'owner' | 'visitor'），无效返回 null。
 * 不抛错，调用方按 null 处理为未登录。
 */
export async function verifyOwnerCookie(request, env) {
  const val = getCookie(request, COOKIE_NAME);
  if (!val || !env.SGX_ED25519_PUBLIC) return null;
  const parts = val.split('.');
  if (parts.length !== 4) return null;
  const [role, epochStr, expStr, sigB64] = parts;
  if (role !== 'owner' && role !== 'visitor') return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;
  let sig;
  try {
    sig = b64urlToBytes(sigB64);
  } catch (e) {
    return null;
  }
  if (sig.length !== 64) return null;
  let ok;
  try {
    const key = await getPublicKey(env.SGX_ED25519_PUBLIC);
    ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      sig,
      new TextEncoder().encode(`${role}.${epochStr}.${expStr}`)
    );
  } catch (e) {
    return null;
  }
  return ok ? role : null;
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
