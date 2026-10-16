// functions/_sgx-cookie.js
// 主站五段式 cookie 共享验签（2.11）：sgx-verified = by.role.epoch.exp.sig
// by ∈ {root, owner}；role ∈ {owner, visitor}；
// sig = Ed25519(SGX_LOCK_PUBLIC, "by.role.epoch.exp")
// 与主站 functions/_middleware.js 的 verifyOneCookie 完全一致；
// 旧四段式（无 by）一律视为无效，不留兼容层。
// 供 functions/_middleware.js、functions/api/_auth.js、
// functions/api/session-check.js、functions/api/lock-check.js 共用。
// SGX_LOCK_PUBLIC 支持 PEM（含头尾）或 raw base64 SPKI DER。

const SESSION_BYS = new Set(['root', 'owner']);
const SESSION_ROLES = new Set(['owner', 'visitor']);
const COOKIE_NAME = 'sgx-verified';

const EPOCH_URL = 'https://styrigx.com/api/session-epoch';
const EPOCH_TTL_MS = 60 * 1000;
/* 内存缓存：{ epoch, app: { book: M } } + 抓取时间（worker 实例内共享）。
   2.10.0：主站响应新增 app 字段，如 {"epoch":N,"app":{"book":M}}。 */
let epochCache = { value: null, at: 0 };

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

/* 解析会话 cookie：五段式 by.role.epoch.exp.sig（2.11）。
   旧四段式（无 by）一律视为无效，不留兼容层。 */
export function parseSessionCookie(value) {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 5) return null;
  const [by, role, epochStr, expStr, sigB64] = parts;
  if (!SESSION_BYS.has(by)) return null;
  if (!SESSION_ROLES.has(role)) return null;
  const epoch = Number(epochStr);
  const exp = Number(expStr);
  if (!Number.isFinite(epoch) || !Number.isFinite(exp)) return null;
  if (!exp || exp < Date.now()) return null;
  let sig;
  try {
    sig = b64urlToBytes(sigB64);
  } catch (e) {
    return null;
  }
  if (sig.length !== 64) return null;
  return { by, role, epochStr, expStr, epoch, sig };
}

/* 验签单个 cookie：成功返回 role（'owner' | 'visitor'），失败返回 null。
   签名 payload 为 "by.role.epoch.exp"（与主站 functions/_middleware.js
   verifyOneCookie 的 2.11 五段式对应）。 */
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
      new TextEncoder().encode(parsed.by + '.' + parsed.role + '.' + parsed.epochStr + '.' + parsed.expStr),
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

/* 主站最新 session epoch：内存缓存 TTL 60 秒。
   失败且有缓存 → 用旧缓存；无缓存 → 返回 null（fail closed 由调用方处理）。
   2.10.0：响应为 {"epoch":N,"app":{"book":M}}，只取 epoch 数字（兼容旧行为）。 */
export async function fetchSessionEpoch() {
  const data = await fetchEpochData();
  if (!data || typeof data.epoch !== 'number' || !Number.isFinite(data.epoch)) return null;
  return data.epoch;
}

/* 主站最新 app epoch（2.10.0）：取响应里 app[aud]，如 app.book。
   缓存 60 秒；拿不到 → null（fail closed 由调用方处理）。缺失 aud 视为 0。
   force=true 时跳过缓存强制刷新（init 校验用，保证与 part 同一口径）。 */
export async function fetchAppEpoch(aud, force = false) {
  const data = await fetchEpochData(force);
  if (!data) return null;
  const v = data.app && typeof data.app[aud] === 'number' ? data.app[aud] : 0;
  return Number.isFinite(v) ? v : 0;
}

/* init 专用：强制刷新拿最新 app epoch（不走 60 秒缓存）。
   避免 init 落在缓存旧值的 isolate 上放行过期 token，
   而 part 落在新值 isolate 上 403 的跨 isolate 不一致。 */
export async function fetchAppEpochFresh(aud) {
  return fetchAppEpoch(aud, true);
}

/* 抓取并缓存主站 session-epoch 响应全文（内部用）。
   force=true 时跳过缓存强制刷新（用于 init 等需要与 part 同一口径的场景）。 */
async function fetchEpochData(force = false) {
  const now = Date.now();
  if (!force && epochCache.value !== null && now - epochCache.at < EPOCH_TTL_MS) {
    return epochCache.value;
  }
  const t0 = Date.now();
  const hadCache = epochCache.value !== null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    let res;
    try {
      res = await fetch(EPOCH_URL, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
      });
    } finally {
      clearTimeout(timer);
    }
    const elapsedMs = Date.now() - t0;
    const contentType = (res.headers?.get?.('content-type') ?? '').split(';')[0].trim();
    if (!res.ok) {
      /* 拉取失败记日志（无敏感值）：HTTP 状态码、content-type、耗时、有无缓存可用。
         日志不许抛错：整段包 try/catch。 */
      try {
        console.log(
          '[sgx-epoch] fetch fail status=' + res.status +
          ' contentType=' + contentType +
          ' elapsedMs=' + elapsedMs +
          ' cached=' + hadCache,
        );
      } catch (logErr) {}
      throw new Error('epoch http ' + res.status);
    }
    const data = await res.json();
    if (typeof data.epoch !== 'number' || !Number.isFinite(data.epoch)) {
      throw new Error('epoch bad payload');
    }
    epochCache = { value: data, at: now };
    return data;
  } catch (e) {
    /* 上面 !res.ok 的情况已记过行，不重复。
       日志不许抛错、不许影响验签结果：整段包 try/catch。 */
    if (!String((e && e.message) || '').startsWith('epoch http ')) {
      try {
        console.log(
          '[sgx-epoch] fetch fail error=' + ((e && e.name) || 'Error') +
          ' elapsedMs=' + (Date.now() - t0) +
          ' cached=' + hadCache,
        );
      } catch (logErr) {}
    }
    if (epochCache.value !== null) return epochCache.value;
    return null;
  }
}

/* 测试用：清空主站 epoch 内存缓存（生产代码不调用）。 */
export function _resetEpochCache() {
  epochCache = { value: null, at: 0 };
}

/* 严格验签：verifySessionCookie（签名 + exp）之外，再检查
   cookie epoch >= 主站最新 epoch。拿不到最新 epoch 则 fail closed（返回 null）。
   成功返回 role（'owner' | 'visitor'），失败返回 null。
   middleware、session-check、lock-check、requireOwner 共用此唯一验签入口。
   （薄 wrapper：实际逻辑在 verifySessionCookieStrictVerbose，保持调用方零改动。） */
export async function verifySessionCookieStrict(cookieValue, publicKeyB64) {
  const v = await verifySessionCookieStrictVerbose(cookieValue, publicKeyB64);
  return v.reason === 'ok' ? v.role : null;
}

/* 严格验签（verbose 版）：与 verifySessionCookieStrict 同一流程，但返回
   { role, reason }，供 middleware 记录服务端日志（原因不回给前端）。
   顺序：格式检查 → 验签 → exp → epoch，保证"先验签再判过期"，
   expired 与 malformed 可区分。
   reason ∈ ok / no-config / no-cookie / malformed / crypto-error / bad-sig /
   expired / epoch-fetch-fail / epoch-low */
export async function verifySessionCookieStrictVerbose(cookieValue, publicKeyB64) {
  if (!publicKeyB64) return { role: null, reason: 'no-config' };
  if (!cookieValue) return { role: null, reason: 'no-cookie' };
  const parts = cookieValue.split('.');
  if (parts.length !== 5) return { role: null, reason: 'malformed' };
  const [by, role, epochStr, expStr, sigB64] = parts;
  if (!SESSION_BYS.has(by) || !SESSION_ROLES.has(role)) return { role: null, reason: 'malformed' };
  const epoch = Number(epochStr);
  const exp = Number(expStr);
  if (!Number.isFinite(epoch) || !Number.isFinite(exp)) return { role: null, reason: 'malformed' };
  let sig;
  try {
    sig = b64urlToBytes(sigB64);
  } catch (e) {
    return { role: null, reason: 'malformed' };
  }
  if (sig.length !== 64) return { role: null, reason: 'malformed' };
  /* 先验签 */
  let ok;
  try {
    const key = await getPublicKey(publicKeyB64);
    ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      sig,
      new TextEncoder().encode(by + '.' + role + '.' + epochStr + '.' + expStr),
    );
  } catch (e) {
    return { role: null, reason: 'crypto-error' };
  }
  if (!ok) return { role: null, reason: 'bad-sig' };
  /* 签名通过后再判 exp：exp 已过就是 expired */
  if (!exp || exp < Date.now()) return { role: null, reason: 'expired' };
  const latest = await fetchSessionEpoch();
  /* Fail closed：拿不到最新 epoch 则拒绝 */
  if (latest === null) return { role: null, reason: 'epoch-fetch-fail' };
  if (epoch < latest) return { role: null, reason: 'epoch-low' };
  return { role, reason: 'ok' };
}

export { COOKIE_NAME, SESSION_ROLES, SESSION_BYS };
