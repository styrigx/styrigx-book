/**
 * @fileoverview 书库首页退出逻辑（R4）：← / 手势返回 → 主站「我的文件」（同标签）。
 * - 只在书库首页加载。
 * - (a) ← 按钮：书库首页 [data-go-back] 一律 location.replace(HOST_FILES)。
 * - (b) 手势返回守卫：history 压一条守卫记录；popstate 回到 sgxRoot 时 location.replace(HOST_FILES)。
 * - (c) 首页弹层打开时，手势返回先关弹层，不触发退出。
 * - (d) 同会话最多触发一次（sessionStorage sgx-exit-fired）。
 */
(function () {
  'use strict';

  var isEn = document.documentElement.lang === 'en';
  var HOST_FILES = isEn ? 'https://styrigx.com/en/files/' : 'https://styrigx.com/files/';
  var GUARD_KEY = 'sgxGuard';
  var ROOT_KEY = 'sgxRoot';
  var FIRED_KEY = 'sgx-exit-fired';

  function isFired() {
    try { return sessionStorage.getItem(FIRED_KEY) === '1'; } catch (e) { return false; }
  }
  function markFired() {
    try { sessionStorage.setItem(FIRED_KEY, '1'); } catch (e) {}
  }

  function doExit() {
    if (isFired()) return;
    markFired();
    location.replace(HOST_FILES);
  }

  /* (c) 检查是否有弹层/菜单打开；有则关闭并返回 true */
  function closeTopLayer() {
    // ⋮ 菜单
    var menu = document.getElementById('bk-more-menu');
    if (menu && !menu.classList.contains('hidden')) {
      menu.classList.add('hidden');
      return true;
    }
    // 排序筛选 / 书库设置 / 其他 overlay（用 .open 判定，见 input.css:948）
    var overlays = document.querySelectorAll('.bk-overlay.open');
    for (var i = 0; i < overlays.length; i++) {
      var ov = overlays[i];
      // 触发关闭：优先点 × 按钮，否则直接隐藏
      var closeBtn = ov.querySelector('[data-close]');
      if (closeBtn) {
        closeBtn.click();
      } else {
        ov.classList.add('hidden');
      }
      return true;
    }
    // 顶栏面板（时钟/天气）
    var clockPop = document.getElementById('dex-clock-pop');
    if (clockPop && clockPop.classList.contains('open')) {
      document.dispatchEvent(new CustomEvent('sgx-topbar-pop-close'));
      return true;
    }
    var wxPop = document.getElementById('nav-wx-pop');
    if (wxPop && wxPop.classList.contains('open')) {
      document.dispatchEvent(new CustomEvent('sgx-topbar-pop-close'));
      return true;
    }
    return false;
  }

  /* (b) 手势返回守卫 */
  function installGuard() {
    var st = null;
    try { st = history.state; } catch (e) {}
    if (st && st[GUARD_KEY]) return; // 已有守卫，不重复压
    try {
      history.replaceState({ [ROOT_KEY]: 1 }, '');
      history.pushState({ [GUARD_KEY]: 1 }, '');
    } catch (e) {}
  }

  function onPopState(e) {
    var st = e.state || null;
    // 回到 sgxRoot（守卫被弹出）
    if (st && st[ROOT_KEY]) {
      // (c) 弹层打开时先关弹层，不退出；重新压守卫
      if (closeTopLayer()) {
        installGuard();
        return;
      }
      doExit();
    }
  }

  /* (a) ← 按钮：书库首页一律 replace 到主站 */
  function onBackClick(e) {
    var b = e.target.closest('[data-go-back]');
    if (!b) return;
    // 只在书库首页拦截；其他页面的 [data-go-back] 走 baseof 的默认逻辑
    var isHome = document.body.getAttribute('data-page') === 'home' ||
      location.pathname === '/' || location.pathname === '/en/' || location.pathname === '/en';
    if (!isHome) return;
    e.preventDefault();
    e.stopPropagation();
    // 如果有弹层打开，先关弹层
    if (closeTopLayer()) return;
    doExit();
  }

  // baseof 的 [data-go-back] 监听在 document 上；这里用 capture 先拦截
  document.addEventListener('click', onBackClick, true);
  window.addEventListener('popstate', onPopState);

  // 页面加载时安装守卫；bfcache 恢复时不重复压（已有 sgxGuard 则跳过）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installGuard);
  } else {
    installGuard();
  }
  // bfcache 恢复：pageshow 时确保守卫还在（不重复压）
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) installGuard();
  });
})();
