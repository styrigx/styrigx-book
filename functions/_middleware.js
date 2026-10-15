// 2.4.1 三站真实锁屏 — 书库侧 middleware（Cloudflare Pages Functions）
//
// pages.dev 301（链首）：host 精确为 styrigx-book.pages.dev 时 301 到
// https://book.styrigx.com（保留 path + query，Cache-Control: no-store）；
// hash/分支预览别名放行，不跳转。
//
// SGX_SITE=book 时：
//   - 检查 sgx-verified cookie（五段式 by.role.epoch.exp.sig，sig = Ed25519 私钥对
//     "by.role.epoch.exp" 的签名，base64url），用 SGX_LOCK_PUBLIC（PEM/SPKI 公钥）验签；
//   - by ∈ {root, owner}；role ∈ {owner, visitor}；exp 未过期；
//   - epoch >= 主站最新 epoch（内存缓存 TTL 60 秒）；
//   - 验签逻辑与 functions/_sgx-cookie.js 的 verifySessionCookieStrict 为同一入口；
//   - owner / visitor 均可进站（visitor 只读）；无效/缺失/过期 → 白名单放行，
//     其余 302 到主站锁屏（URL 带 ?why=no-cookie|invalid-session，主站见 why 不再回跳）。
//   - Fail closed：主站 epoch 接口失败且无缓存时，一律拒绝（302 到锁屏）。
//
// 环境变量（Cloudflare 后台配置，代码里只读不写）：
//   SGX_SITE            = book
//   SGX_LOCK_PUBLIC  = Ed25519 公钥 PEM（只配公钥，不配私钥）
//
// 白名单（只放行验证必需与真正公开的跨站只读接口）：
//   /api/session-check（锁屏会话确认，由接口自己验签、自己返回 401）
//   /api/shelf、/api/shelf/*（主站书单小组件跨站调用，带 CORS）
//   /robots.txt、/favicon.ico、静态资源（按扩展名）
// 其余（页面、/api/books、/api/file、/api/cover、/api/private/*、/api/admin/*、
// /api/lock-check）均需有效 cookie；admin/private 原有的 401/403 逻辑保持不变。

import { verifySessionCookieStrict } from './_sgx-cookie.js';

const LOCK_URL = 'https://styrigx.com/?lock=1';
const COOKIE_NAME = 'sgx-verified';

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

/* 静态资源扩展名白名单 */
const STATIC_EXT = new Set([
  'css', 'js', 'mjs', 'map',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'avif',
  'json', 'xml', 'txt', 'webmanifest',
]);

function isWhitelisted(path) {
  if (path === '/robots.txt' || path === '/favicon.ico') return true;
  /* /api/session-check：锁屏会话确认，middleware 放行，由接口自己验签、自己返回 401，
     前端才能区分“已锁定”（→ reload 走 302 到主站锁屏）与“网络错误”（→ fail open） */
  if (path === '/api/session-check') return true;
  /* /api/geo：天气定位（IP 城市+经纬度，只返回非敏感字段），公开放行 */
  if (path === '/api/geo') return true;
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

/* 子站踢回主站锁屏：URL 带 ?why= 说明原因（no-cookie / invalid-session），
   主站 L1 见到 why 不再 302，直接停在首页显示原因，避免重定向死循环。 */
function lockRedirect(request, why) {
  const url = new URL(request.url);
  const original = url.origin + url.pathname + url.search;
  let target = LOCK_URL + '&why=' + encodeURIComponent(why || 'invalid-session');
  if (isReturnAllowed(original)) {
    target += '&return=' + encodeURIComponent(original);
  }
  /* 手工拼 302（等价于 Response.redirect）：302 本身不可缓存，再加 no-store 明确语义 */
  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Cache-Control': 'private, no-store' },
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

/* 受保护的 HTML 响应加 Cache-Control: no-store：
   解锁态页面不能进磁盘/bfcache 缓存，否则“立即锁定”后切回标签页
   可能直接展示旧页面而不经过 middleware。非 HTML 原样返回。 */
async function withNoStoreForHtml(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/* 指纹化静态文件名模式：Hugo Pipes fingerprint 产出如
   upload-queue.min.<sha>.js、main.min.<sha>.css，中间有一段十六进制哈希。 */
function isFingerprintedJs(path) {
  return /^\/js\/.+\.[0-9a-f]{8,}\.(js|mjs)$/.test(path);
}

function isFingerprintedCss(path) {
  return /^\/css\/.+\.[0-9a-f]{8,}\.css$/.test(path);
}

/* 白名单静态资源守卫：文件不存在时 Pages 会回落到 index.html
   （Book 有 layouts/404.html 后回落到 404 页，但经过 Functions 的响应
   仍可能拿到非预期的 HTML），导致两个问题：
   1. 未解锁访客能拿到页面壳；
   2. 下面的缓存头逻辑只看路径，浏览器会把 HTML 当 JS/CSS 缓存一年。
   规则：
   - 304（带 If-None-Match / If-Modified-Since 的重新验证）：原样放行，
     不检查 content-type（304 本来就可能没有），仍按路径加缓存头；
   - 206（分段请求，如字体/媒体）：content-type 匹配时放行；
   - 200：只有 content-type 与路径扩展名匹配才算命中静态文件；
   - 其余（200 + text/html 回落、404、其他错误码）：一律 404 + no-store
     + 纯文本空体。 */
function staticGuard(path, res) {
  /* 304 重新验证命中：Pages 已确认资源未变，原样放行。
     未指纹化的 JS/CSS 是 no-cache，每次都会重新验证走 304。 */
  if (res.status === 304) return null;

  const dot = path.lastIndexOf('.');
  const ext = dot !== -1 ? path.slice(dot + 1).toLowerCase() : '';
  const ct = (res.headers.get('content-type') || '').toLowerCase();

  /* 200 与 206 都需要类型匹配（排除 text/html 回落） */
  let ok = (res.status === 200 || res.status === 206) && !ct.includes('text/html');
  if (ok && (ext === 'js' || ext === 'mjs')) ok = ct.includes('javascript');
  if (ok && ext === 'css') ok = ct.includes('text/css');

  if (ok) return null; /* 命中真实静态文件，交给缓存头逻辑 */
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/* /js/、/css/ 下的静态资源缓存策略（仅在 staticGuard 通过后调用，
   即已确认是 200 + 类型正确的真实文件）：
   - 已指纹化（文件名带哈希）：public, max-age=31536000, immutable
   - 未指纹化：no-cache（每次重新验证，避免部署后客户端仍跑旧脚本）
   注意：本 middleware 是根目录中间件，静态资源走 isWhitelisted 直接
   return next()，响应仍算「经过 Functions」，Cloudflare Pages 的
   static/_headers 规则对这类响应不生效，所以在这里直接设头。 */
async function withStaticCacheHeaders(path, res) {
  const headers = new Headers(res.headers);
  const fingerprinted =
    path.startsWith('/js/') ? isFingerprintedJs(path)
    : path.startsWith('/css/') ? isFingerprintedCss(path)
    : false;
  if (fingerprinted) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    headers.set('Cache-Control', 'no-cache');
  }
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

  /* SGX_SITE 必须为 book（Cloudflare 后台配）。缺配置或配错 → fail closed，
     一律拒绝，不放行（配置错的锁屏站点不能对外服务） */
  if (!env || env.SGX_SITE !== 'book') {
    return new Response('Server misconfigured', { status: 500 });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (isWhitelisted(path)) {
    const res = await next();
    /* /api/* 白名单（session-check、shelf）：动态接口，由接口自己验签、
       自己返回 401/JSON，原样返回，不做静态守卫 */
    if (path.startsWith('/api/')) return res;
    /* 静态资源：先过守卫。文件缺失时 Pages 回落的 text/html、或非 200，
       一律转成 404 + no-store，避免 HTML 壳被当成 JS/CSS 长期缓存 */
    const guard = staticGuard(path, res);
    if (guard) return guard;
    /* /js/、/css/：命中真实文件后按指纹化与否设缓存头；
       其余静态扩展名（图片/字体等）原样返回 Pages 默认头 */
    if (path.startsWith('/js/') || path.startsWith('/css/')) {
      return withStaticCacheHeaders(path, res);
    }
    return res;
  }

  const cookies = getCookies(request, COOKIE_NAME);
  for (const c of cookies) {
    /* #5 权限：owner 与 visitor 均可进站（visitor 只读）；验签与
       session-check / lock-check / requireOwner 为同一入口 */
    const role = await verifySessionCookieStrict(c, env.SGX_LOCK_PUBLIC);
    if (role === 'owner' || role === 'visitor') {
      return withNoStoreForHtml(await next());
    }
  }
  const why = cookies.length === 0 ? 'no-cookie' : 'invalid-session';

  /* /api/* 会话无效时回 401 JSON（不回 302），避免 fetch 跨域跟跳转报 TypeError；
     页面路径保持 302 到主站锁屏 */
  if (path.startsWith('/api/')) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
      },
    });
  }

  return lockRedirect(request, why);
}
