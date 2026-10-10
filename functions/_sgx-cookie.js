// functions/_sgx-cookie.js
// 主站四段式 cookie 共享验签：sgx-verified = role.epoch.exp.sig
// role ∈ {owner, visitor}；sig = Ed25519(SGX_ED25519_PUBLIC, "role.epoch.exp")
// 供 functions/_middleware.js 和 functions/api/_auth.js 共用。
// SGX_ED25519_PUBLIC 支持 PEM（含头尾）或 raw base64 SPKI DER。

const SESSION_ROLES = new Set(['owner', 'visitor']);
const COOKIE_NAME = 'sgx-verified';

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function keyToDer(keyB64) {
  // 去掉 PEM 头尾（如有），剩余为标准 base64
  const b64 = keyB64
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

let publicKeyPromise = null;
let cachedKeyInput = null;
function getPublicKey(keyB64) {
  if (!publicKeyPromise || cachedKeyInput !== keyB64) {
    cachedKeyInput = keyB64;
    publicKeyPromise = crypto.subtle.importKey(
      'spki',
      keyToDer(keyB64),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
  }
  return publicKeyPromise;
}

/* 解析会话 cookie：四段式 role.epoch.exp.sig。
   旧三段式（无 role）一律视为无效，不留兼容层。 */
export function parseSessionCookie(value) {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [role, epochStr, expStr, sigB64] = parts;
  if (!SESSION_ROLES.has(role)) return null;
  const epoch = Number(epochStr);
  const exp = Number(expStr);
  if (!Number.isFinite(epoch) || !Number.isFinite(exp)) return null;
  if (exp <= Date.now()) return null;
  let sig;
  try {
    sig = b64urlToBytes(sigB64);
  } catch (e) {
    return null;
  }
  if (sig.length !== 64) return null;
  return { role, epochStr, expStr, epoch, sig };
}

/* 验签单个 cookie：成功返回 role（'owner' | 'visitor'），失败返回 null。
   签名 payload 为 "role.epoch.exp"（与主站 functions/_kernel/session.js 对应）。 */
export async function verifySessionCookie(cookieValue, publicKeyB64) {
  if (!publicKeyB64) return null;
  const parsed = parseSessionCookie(cookieValue);
  if (!parsed) return null;
  let ok;
  try {
    const key = await getPublicKey(publicKeyB64);
    ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      parsed.sig,
      new TextEncoder().encode(parsed.role + '.' + parsed.epochStr + '.' + parsed.expStr),
    );
  } catch (e) {
    return null;
  }
  return ok ? parsed.role : null;
}

export function getCookieValue(request, name = COOKIE_NAME) {
  const header = request.headers.get('Cookie') || '';
  const parts = header.split(';');
  for (const p of parts) {
    const [k, ...v] = p.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export { COOKIE_NAME, SESSION_ROLES };
