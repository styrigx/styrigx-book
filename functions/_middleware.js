// 2.4.1 三站真实锁屏 — 书库侧 middleware（Cloudflare Pages Functions）
//
// SGX_SITE=book 时：
//   - 检查 sgx-verified cookie（格式 epoch.exp.sig，sig = Ed25519 私钥对 "epoch.exp"
//     的签名，base64url），用 SGX_ED25519_PUBLIC（PEM/SPKI 公钥）验签；
//   - exp 未过期；epoch >= 本地缓存的最新 epoch（从主站
//     https://styrigx.com/api/session-epoch 获取，内存缓存 TTL 60 秒）。
//   - 有效 → next()；无效/缺失/过期 → 白名单放行，其余 302 到主站锁屏。
//   - Fail closed：主站 epoch 接口失败且无缓存时，一律拒绝（302 到锁屏）。
//
// 环境变量（Cloudflare 后台配置，代码里只读不写）：
//   SGX_SITE            = book
//   SGX_ED25519_PUBLIC  = Ed25519 公钥 PEM（只配公钥，不配私钥）
//
// 白名单（只放行验证必需与真正公开的跨站只读接口）：
//   /api/shelf、/api/shelf/*（主站书单小组件跨站调用，带 CORS）
//   /robots.txt、/favicon.ico、静态资源（按扩展名）
// 其余（页面、/api/books、/api/file、/api/cover、/api/private/*、/api/admin/*）
// 均需有效 cookie；admin/private 原有的 401 逻辑保持不变。

const LOCK_URL = 'https://styrigx.com/?lock=1';
const EPOCH_URL = 'https://styrigx.com/api/session-epoch';
const EPOCH_TTL_MS = 60 * 1000;
const COOKIE_NAME = 'sgx-verified';

/* 内存缓存：最新 epoch + 抓取时间（worker 实例内共享） */
let epochCache = { value: null, at: 0 };

/* 静态资源扩展名白名单 */
const STATIC_EXT = new Set([
  'css', 'js', 'mjs', 'map',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'avif',
  'json', 'xml', 'txt', 'webmanifest',
]);

function isWhitelisted(path) {
  if (path === '/robots.txt' || path === '/favicon.ico') return true;
  if (path === '/api/shelf' || path.startsWith('/api/shelf/')) return true;
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  if (dot > slash && dot !== -1) {
    const ext = path.slice(dot + 1).toLowerCase();
    if (STATIC_EXT.has(ext)) return true;
  }
  return false;
}

/* return 白名单：只允许 https 协议、主机名 styrigx.com 或 *.styrigx.com */
function isReturnAllowed(returnUrl) {
  let u;
  try {
    u = new URL(returnUrl);
  } catch (e) {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return host === 'styrigx.com' || host.endsWith('.styrigx.com');
}

function lockRedirect(request) {
  const url = new URL(request.url);
  const original = url.origin + url.pathname + url.search;
  const target = isReturnAllowed(original)
    ? LOCK_URL + '&return=' + encodeURIComponent(original)
    : LOCK_URL;
  return Response.redirect(target, 302);
}

function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return '';
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function pemToDer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  /* PEM 内是标准 base64（非 base64url） */
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

let publicKeyPromise = null;
function getPublicKey(pem) {
  if (!publicKeyPromise) {
    publicKeyPromise = crypto.subtle.importKey(
      'spki',
      pemToDer(pem),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
  }
  return publicKeyPromise;
}

async function fetchLatestEpoch() {
  const now = Date.now();
  if (epochCache.value !== null && now - epochCache.at < EPOCH_TTL_MS) {
    return epochCache.value;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(EPOCH_URL, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('epoch http ' + res.status);
    const data = await res.json();
    if (typeof data.epoch !== 'number' || !Number.isFinite(data.epoch)) {
      throw new Error('epoch bad payload');
    }
    epochCache = { value: data.epoch, at: now };
    return data.epoch;
  } catch (e) {
    /* 失败且有缓存：用旧缓存；无缓存：返回 null（fail closed 由调用方处理） */
    if (epochCache.value !== null) return epochCache.value;
    return null;
  }
}

async function verifyCookie(cookieValue, env) {
  if (!cookieValue || !env.SGX_ED25519_PUBLIC) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return false;
  const [epochStr, expStr, sigB64] = parts;
  const epoch = Number(epochStr);
  const exp = Number(expStr);
  if (!Number.isFinite(epoch) || !Number.isFinite(exp)) return false;
  if (exp <= Date.now()) return false;
  let sig;
  try {
    sig = b64urlToBytes(sigB64);
  } catch (e) {
    return false;
  }
  if (sig.length !== 64) return false;
  let ok;
  try {
    const key = await getPublicKey(env.SGX_ED25519_PUBLIC);
    ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      sig,
      new TextEncoder().encode(epochStr + '.' + expStr),
    );
  } catch (e) {
    return false;
  }
  if (!ok) return false;
  const latest = await fetchLatestEpoch();
  /* Fail closed：拿不到最新 epoch 则拒绝 */
  if (latest === null) return false;
  return epoch >= latest;
}

export async function onRequest(context) {
  const { request, env, next } = context;

  /* 只在 SGX_SITE=book 时启用锁屏；未配置时保持原样（不锁死） */
  if (env.SGX_SITE !== 'book') return next();

  const url = new URL(request.url);
  const path = url.pathname;

  if (isWhitelisted(path)) return next();

  const cookie = getCookie(request, COOKIE_NAME);
  if (await verifyCookie(cookie, env)) return next();

  return lockRedirect(request);
}
