// functions/_app-token.js
// sgx-app 通行证验签（book 端）。
// 主站签发格式（2.10.0）：owner.epoch.appEpoch.iat.exp.aud.scope.sig
// sig = Ed25519("owner.epoch.appEpoch.iat.exp.aud.scope")，用 APP 密钥对签名。
// book 只持 SGX_APP_PUBLIC（Cloudflare Text），验签 + 校验 aud/scope/exp/epoch/appEpoch。
// 缺 SGX_APP_PUBLIC、验签失败、过期、aud/scope 不符、epoch/appEpoch 落后一律返回 null（fail closed）。
// book 不得读取主站密钥相关变量（CI 静态检查）。

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

/* 解析 sgx-app token：8 段式 owner.epoch.appEpoch.iat.exp.aud.scope.sig（2.10.0）。
   旧 7 段式（无 appEpoch）一律视为无效，不留兼容层。 */
export function parseAppToken(val) {
  if (!val || typeof val !== 'string') return null;
  const parts = val.split('.');
  if (parts.length !== 8) return null;
  if (parts[0] !== APP_ROLE) return null;
  const epoch = Number(parts[1]);
  const appEpoch = Number(parts[2]);
  const iat = Number(parts[3]);
  const exp = Number(parts[4]);
  if (!Number.isFinite(epoch) || !Number.isFinite(appEpoch) || !Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  if (exp <= Date.now()) return null; // 已过期
  const aud = parts[5];
  const scope = parts[6];
  if (aud !== APP_AUD || scope !== APP_SCOPE) return null;
  let sig;
  try {
    sig = b64urlToBytes(parts[7]);
  } catch (e) {
    return null;
  }
  if (sig.length !== 64) return null;
  return { role: parts[0], epoch, appEpoch, iat, exp, aud, scope, sig, payload: parts.slice(0, 7).join('.') };
}

/**
 * 验签 sgx-app token。
 * @param {string} cookieValue - sgx-app cookie 值
 * @param {string} publicKeyB64 - SGX_APP_PUBLIC
 * @param {number} latestEpoch - 主站当前 session epoch（调用方从 fetchSessionEpoch 获取）
 * @param {number} latestAppEpoch - 主站当前 app epoch（book 的；调用方从 fetchAppEpoch 获取）
 * @returns {Promise<boolean>} 有效返回 true，否则 false
 */
export async function verifyAppToken(cookieValue, publicKeyB64, latestEpoch, latestAppEpoch) {
  if (!publicKeyB64) return false;
  const parsed = parseAppToken(cookieValue);
  if (!parsed) return false;
  if (latestEpoch === null || latestEpoch === undefined) return false; // fail closed
  if (latestAppEpoch === null || latestAppEpoch === undefined) return false; // fail closed
  if (parsed.epoch < latestEpoch) return false; // session epoch 落后
  if (parsed.appEpoch < latestAppEpoch) return false; // app epoch 落后（应用密钥被删除过）
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
