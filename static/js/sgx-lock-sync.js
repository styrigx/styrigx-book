/* static/js/sgx-lock-sync.js
 * SGX 锁屏同步（L6 前端，不跨层：只做“复查 + 重载”）
 *
 * 主站「立即锁定」后，本页切回前台 / bfcache 恢复时，向服务端确认会话：
 *   GET /api/session-check（middleware 白名单放行，由接口自己验签）
 *   - 200 {ok:true}  → 会话有效，什么都不做
 *   - 401 {ok:false} → 会话已失效 → location.reload()，
 *     让 middleware 走正常 302 到主站锁屏（带 return，解锁后可回来）
 *   - 网络错误       → fail open：不 reload，等下次切回再查
 *
 * 另外暴露 sgxLockSync.apiFetch：各页面数据请求统一走它；
 * 任何 book API 返回 401 即视为已锁定 → 同样 reload，不展示「加载失败」。
 * 例外（401 另有含义，不 reload，否则无限重载）：
 *   - /api/private/me：401 = 未登录（Access 未启用/非管理员），正常态
 *   - /api/admin/*：401/403 = 未授权，走后台登录提示
 *
 * 只认服务端状态：不用 sessionStorage / localStorage / BroadcastChannel。
 */
(function(){
"use strict";

var G = typeof globalThis !== 'undefined' ? globalThis : this;
var CHECK_URL = '/api/session-check';
/* 401 另有含义的接口：登录态探测与后台鉴权 */
var AUTH_PROBE_RE = /^\/api\/(private\/me|admin(\/|$))/;

function urlPath(url){
  try { return new URL(String(url), 'https://book.styrigx.com').pathname; }
  catch (e) { return String(url); }
}

/* 该 401 是否视为“已锁定”（需要 reload） */
function isLockSignal(url, status){
  if (status !== 401) return false;
  return !AUTH_PROBE_RE.test(urlPath(url));
}

function defaultReload(){
  try { G.location.reload(); } catch (e) {}
}

var checking = false;
/* 向服务端确认会话。fetch/reload 可注入，便于单元测试。 */
function checkSession(fetchFn, reloadFn){
  if (checking) return Promise.resolve(false);
  checking = true;
  var f = fetchFn || (G.fetch && G.fetch.bind(G));
  var rl = reloadFn || defaultReload;
  function done(v){ checking = false; return v; }
  if (!f) return Promise.resolve(done(false));
  return f(CHECK_URL, { credentials: 'same-origin', cache: 'no-store' }).then(
    function(res){
      if (res && res.status === 401) { rl(); return done(true); }
      return done(false);
    },
    function(){ return done(false); }  /* 网络错误：fail open，不 reload */
  );
}

/* 数据请求统一入口：
 * - 401（且非鉴权探测接口）→ reload + 抛 sgxLocked 错误，调用方直接 return，不展示错误 UI；
 * - 网络错误 → 原样抛出，调用方按原逻辑处理，不 reload。 */
function apiFetch(url, opts, fetchFn, reloadFn){
  opts = opts || {};
  if (!opts.credentials) opts.credentials = 'same-origin';
  var f = fetchFn || (G.fetch && G.fetch.bind(G));
  var rl = reloadFn || defaultReload;
  return f(url, opts).then(function(res){
    if (isLockSignal(url, res && res.status)) {
      rl();
      var e = new Error('sgx session locked');
      e.sgxLocked = true;
      throw e;
    }
    return res;
  });
}

function mount(){
  if (!G.document || !G.window) return;
  G.document.addEventListener('visibilitychange', function(){
    if (!G.document.hidden) checkSession();
  });
  /* pageshow 覆盖 bfcache 恢复（event.persisted）与普通加载 */
  G.window.addEventListener('pageshow', function(){ checkSession(); });
}

var api = {
  CHECK_URL: CHECK_URL,
  isLockSignal: isLockSignal,
  checkSession: checkSession,
  apiFetch: apiFetch,
  mount: mount,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;   /* node 单元测试 */
} else {
  G.sgxLockSync = api;
  mount();                /* 浏览器：自动挂载 */
}
})();
