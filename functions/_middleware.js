// 2.4.1 三站真实锁屏 — 书库侧 middleware（Cloudflare Pages Functions）
// 2.8.0 会话角色分离：sgx-verified 改为四段式 role.epoch.exp.sig。
//
// pages.dev 301（链首）：host 精确为 styrigx-book.pages.dev 时 301 到
// https://book.styrigx.com（保留 path + query，Cache-Control: no-store）；
// hash/分支预览别名放行，不跳转。
//
// SGX_SITE=book 时：
//   - 检查 sgx-verified cookie（格式 role.epoch.exp.sig，role ∈ owner|visitor；
//     sig = Ed25519 私钥对 "role.epoch.exp" 的签名，base64url），用
//     SGX_ED25519_PUBLIC（PEM/SPKI 公钥）验签；
//   - exp 未过期；epoch >= 本地缓存的最新 epoch（从主站
//     https://styrigx.com/api/session-epoch 获取，内存缓存 TTL 60 秒）。
//   - book 主人专属：仅 owner 角色放行；visitor/无效/缺失/过期 → 302 到主站锁屏
//     （用户在锁屏选密码/通行密钥升级为 owner）。
//   - 旧三段式 epoch.exp.sig（无 role）一律视为无效，不留兼容层。
//   - Fail closed：主站 epoch 接口失败且无缓存时，一律拒绝（302 到锁屏）。
//
// 环境变量（Cloudflare 后台配置，代码里只读不写）：
//   SGX_SITE            = book
//   SGX_ED25519_PUBLIC  = Ed25519 公钥 PEM（只配公钥，不配私钥）
//
// 白名单（只放行验证必需与真正公开的跨站只读接口）：
//   /api/session-check（锁屏会话确认：middleware 放行，由接口自己验签、自己返回 401，
//     前端才能区分“已锁定”与“网络错误”）
//   /api/shelf、/api/shelf/*（主站书单小组件跨站调用，带 CORS）
//   /robots.txt、/favicon.ico、静态资源（按扩展名）
// 其余（页面、/api/books、/api/file、/api/cover、/api/private/*、/api/admin/*）
// 均需有效 cookie；admin/private 原有的 401 逻辑保持不变。

const LOCK_URL = 'https://styrigx.com/?lock=1';
const EPOCH_URL = 'https://styrigx.com/api/session-epoch';
const EPOCH_TTL_MS = 60 * 1000;

import { verifySessionCookie as verifyCookieSig, getCookieValue, COOKIE_NAME, parseSessionCookie } from './_sgx-cookie.js';

/* pages.dev 生产别名 301 到正式域名（middleware 链首） */
const PAGES_DEV_HOST = 'styrigx-book.pages.dev';
const CANONICAL_ORIGIN = 'https://book.styrigx.com';

/* 只精确匹配生产别名 styrigx-book.pages.dev；
   hash/分支预览别名（如 xxx.styrigx-book.pages.dev）放行，不跳转 */
export function pagesDevRedirect(request) {
  const url = new URL(request.url);
  if (url.hostname !== PAGES_DEV_HOST) return null;
  const target = CANONICAL_ORIGIN + url.pathname + url.search;
  return new Response(null, {
    status: 301,
    headers: {
      'Location': target,
      'Cache-Control': 'no-store',
    },
  });
}

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
  if (path === '/api/session-check') return true;
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
  /* 手工拼 302（等价于 Response.redirect）：302 本身不可缓存，再加 no-store 明确语义 */
  return new Response(null, {
    status: 302,
    headers: { 'Location': target, 'Cache-Control': 'no-store' },
  });
}

/* 取出所有同名 cookie 的值（旧版可能留下一个只绑主机的同名 cookie，
   浏览器会把两个都发过来；逐个验签，任一通过即有效） */
function getCookies(request, name) {
  const header = request.headers.get('cookie') || '';
  const out = [];
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      out.push(decodeURIComponent(part.slice(idx + 1).trim()));
    }
  }
  return out;
}

async function verifyOneCookie(cookieValue, env) {
  const role = await verifyCookieSig(cookieValue, env.SGX_ED25519_PUBLIC);
  if (!role) return null;
  const latest = await fetchLatestEpoch();
  /* Fail closed：拿不到最新 epoch 则拒绝 */
  if (latest === null) return null;
  const parsed = parseSessionCookie(cookieValue);
  if (!parsed || parsed.epoch < latest) return null;
  return role;
}


/* 供 functions/api/session-check.js 复用：任一同名 sgx-verified cookie 验签为 owner 即有效。
   book 主人专属：visitor 不算有效会话（session-check 返回 401，前端 reload 后
   middleware 302 到主站锁屏，用户选密码/通行密钥升级为 owner）。
   未启用锁屏（SGX_SITE !== 'book'）时直接视为通过，与 middleware 放行逻辑一致。 */
export async function verifySessionCookie(request, env) {
  if (env.SGX_SITE !== 'book') return true;
  const cookies = getCookies(request, COOKIE_NAME);
  for (const c of cookies) {
    if ((await verifyOneCookie(c, env)) === 'owner') return true;
  }
  return false;
}

/* 受保护的 HTML 响应加 Cache-Control: no-store：
   解锁态页面不能进磁盘/bfcache 缓存，否则“立即锁定”后切回标签页
   可能直接展示旧页面而不经过 middleware。非 HTML 原样返回。 */
async function withNoStoreForHtml(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;

  /* pages.dev 生产别名 301（链首，不受锁屏影响） */
  const redirect = pagesDevRedirect(request);
  if (redirect) return redirect;

  /* 只在 SGX_SITE=book 时启用锁屏；未配置时保持原样（不锁死） */
  if (env.SGX_SITE !== 'book') return next();

  const url = new URL(request.url);
  const path = url.pathname;

  if (isWhitelisted(path)) return next();

  const cookies = getCookies(request, COOKIE_NAME);
  for (const c of cookies) {
    /* book 主人专属：仅 owner 放行；visitor 走下面的 302 到主站锁屏 */
    if ((await verifyOneCookie(c, env)) === 'owner') return withNoStoreForHtml(await next());
  }

  return lockRedirect(request);
}
