// functions/_app-token.js
// sgx-app 通行证验签（book 端）。
// 主站签发格式：owner.epoch.iat.exp.aud.scope.Ed25519(SGX_APP_PRIVATE, "owner.epoch.iat.exp.aud.scope")
// book 只持 SGX_APP_PUBLIC（Cloudflare Text），验签 + 校验 aud/scope/exp/epoch。
// 缺 SGX_APP_PUBLIC、验签失败、过期、aud/scope 不符、epoch 落后一律返回 null（fail closed）。

const APP_COOKIE_NAME = 'sgx-app';
const APP_ROLE = 'owner';
const APP_AUD = 'book';
const APP_SCOPE = 'upload';

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
function getAppPublicKey(keyB64) {
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

export function getAppCookieValue(request, name = APP_COOKIE_NAME) {
  const header = request.headers.get('Cookie') || '';
  const parts = header.split(';');
  for (const p of parts) {
    const [k, ...v] = p.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/* 解析 sgx-app token：7 段式 owner.epoch.iat.exp.aud.scope.sig */
export function parseAppToken(val) {
  if (!val || typeof val !== 'string') return null;
  const parts = val.split('.');
  if (parts.length !== 7) return null;
  if (parts[0] !== APP_ROLE) return null;
  const epoch = Number(parts[1]);
  const iat = Number(parts[2]);
  const exp = Number(parts[3]);
  if (!Number.isFinite(epoch) || !Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  if (exp <= Date.now()) return null; // 已过期
  const aud = parts[4];
  const scope = parts[5];
  if (aud !== APP_AUD || scope !== APP_SCOPE) return null;
  let sig;
  try {
    sig = b64urlToBytes(parts[6]);
  } catch (e) {
    return null;
  }
  if (sig.length !== 64) return null;
  return { role: parts[0], epoch, iat, exp, aud, scope, sig, payload: parts.slice(0, 6).join('.') };
}

/**
 * 验签 sgx-app token。
 * @param {string} cookieValue - sgx-app cookie 值
 * @param {string} publicKeyB64 - SGX_APP_PUBLIC
 * @param {number} latestEpoch - 主站当前 session epoch（调用方从 fetchSessionEpoch 获取）
 * @returns {Promise<boolean>} 有效返回 true，否则 false
 */
export async function verifyAppToken(cookieValue, publicKeyB64, latestEpoch) {
  if (!publicKeyB64) return false;
  const parsed = parseAppToken(cookieValue);
  if (!parsed) return false;
  if (latestEpoch === null || latestEpoch === undefined) return false; // fail closed
  if (parsed.epoch < latestEpoch) return false; // epoch 落后
  let ok;
  try {
    const key = await getAppPublicKey(publicKeyB64);
    ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      parsed.sig,
      new TextEncoder().encode(parsed.payload),
    );
  } catch (e) {
    return false;
  }
  return !!ok;
}

export { APP_COOKIE_NAME, APP_AUD, APP_SCOPE };
