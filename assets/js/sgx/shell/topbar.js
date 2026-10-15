/**
 * @fileoverview 书库顶栏：时间 / 头像 / 天气（从主站 244492c 移植）。
 * - 左：时间（HH:MM），按 sgx-ui cookie 的第一时区+小时制显示；点击展开双时钟+日历面板。
 * - 中：头像，点击 location.href 本站首页（强制刷新）。
 * - 右：天气（开关关则隐藏）；点击展开天气面板。
 * - 设置来源：cookie sgx-ui（主站写，书站只读）；无 cookie/解析失败 → 默认值。
 *   v1.1：loc=precise 时按 auto（IP 定位）处理，不弹定位权限。
 */
import { on } from '../lib/events.js';
import { fmtTz } from '../lib/util.js';

/* 可见性感知定时器：页面不可见时暂停 */
function visibleInterval(fn, ms) {
  let iv = null;
  function stop() { if (iv) { clearInterval(iv); iv = null; } }
  function start() { stop(); try { fn(); } catch (e) {} iv = window.setInterval(fn, ms); }
  on(document, 'visibilitychange', function () { if (document.hidden) stop(); else start(); });
  start();
  return stop;
}

/* ---------- sgx-ui cookie（只读） ---------- */
function readUiCookie() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)sgx-ui=([^;]*)/);
    if (!m) return null;
    const json = decodeURIComponent(m[1]);
    // base64url → base64
    let b64 = json.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const str = atob(b64);
    // UTF-8 解码
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    const text = new TextDecoder().decode(bytes);
    const o = JSON.parse(text);
    if (!o || o.v !== 1) return null;
    return o;
  } catch (e) { return null; }
}

function resolveSettings() {
  const c = readUiCookie();
  const d = {
    tz1: 'auto', tz2: '', h12: false, clock: 'digital',
    wx: true, unit: 'c', loc: 'auto', city: null,
  };
  if (!c) return d;
  if (typeof c.tz1 === 'string' && c.tz1) d.tz1 = c.tz1;
  if (typeof c.tz2 === 'string') d.tz2 = c.tz2;
  d.h12 = c.h12 === 1;
  if (c.clock === 'analog' || c.clock === 'digital') d.clock = c.clock;
  d.wx = c.wx !== 0;
  if (c.unit === 'f' || c.unit === 'c') d.unit = c.unit;
  // v1.1：precise 按 auto 处理，不弹定位权限
  if (c.loc === 'manual' || c.loc === 'precise' || c.loc === 'auto') {
    d.loc = c.loc === 'precise' ? 'auto' : c.loc;
  }
  if (c.city && typeof c.city === 'object') d.city = c.city;
  return d;
}

const S = resolveSettings();
function firstTz() {
  if (S.tz1 && S.tz1 !== 'auto') return S.tz1;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || 'UTC';
  } catch (e) { return 'UTC'; }
}

export function initTopbar() {
  const en = document.documentElement.lang === 'en';

  /* ---- 顶栏时钟：只显示 HH:MM，按第一时区+小时制 ---- */
  (function () {
    const tEl = document.getElementById('nav-time');
    if (!tEl) return;
    function tick() {
      const s = fmtTz(firstTz(), S.h12);
      if (s) tEl.textContent = s;
    }
    visibleInterval(tick, 60000);
  })();

  /* ---- 时钟面板：双时钟 + 日历（从主站 nav.js 移植） ---- */
  (function () {
    const pop = document.getElementById('dex-clock-pop');
    const btn = document.getElementById('nav-time-center');
    if (!pop || !btn) return;
    const TZN = {
      zh: {
        'Asia/Shanghai': '北京', 'America/Los_Angeles': '洛杉矶', 'America/New_York': '纽约',
        'Europe/London': '伦敦', 'Asia/Tokyo': '东京', 'Asia/Hong_Kong': '香港', 'Asia/Seoul': '首尔',
      },
      en: {
        'Asia/Shanghai': 'Beijing', 'America/Los_Angeles': 'Los Angeles', 'America/New_York': 'New York',
        'Europe/London': 'London', 'Asia/Tokyo': 'Tokyo', 'Asia/Hong_Kong': 'Hong Kong', 'Asia/Seoul': 'Seoul',
      },
    };
    function tzName(tz) {
      const m = en ? TZN.en : TZN.zh;
      const v = m[tz];
      return v || tz.split('/').pop().replace(/_/g, ' ');
    }
    function calendar() {
      const d = new Date(), y = d.getFullYear(), mo = d.getMonth();
      const first = new Date(y, mo, 1).getDay(), days = new Date(y, mo + 1, 0).getDate();
      let h = '<div class="dex-cal-h">' + y + (en ? '/' : '年') + (mo + 1) + (en ? '' : '月') + '</div><div class="dex-cal-g">';
      (en ? ['S','M','T','W','T','F','S'] : ['日','一','二','三','四','五','六']).forEach(function (wd) {
        h += '<span class="dex-cal-w">' + wd + '</span>';
      });
      for (let i = 0; i < first; i++) h += '<span></span>';
      for (let dd = 1; dd <= days; dd++)
        h += '<span class="dex-cal-d' + (dd === d.getDate() ? ' today' : '') + '">' + dd + '</span>';
      return h + '</div>';
    }
    function render() {
      const local = firstTz();
      let r = S.tz2 || 'America/Los_Angeles';
      if (r === local) r = local === 'Asia/Shanghai' ? 'America/Los_Angeles' : 'Asia/Shanghai';
      function setT(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
      setT('dex-pop-local', fmtTz(local, S.h12));
      setT('dex-pop-local-c', tzName(local));
      setT('dex-pop-r', fmtTz(r, S.h12));
      setT('dex-pop-r-c', tzName(r));
      const cal = document.getElementById('dex-pop-cal');
      if (cal) cal.innerHTML = calendar();
    }
    function open() { render(); pop.classList.remove('hidden'); pop.classList.add('open'); }
    function close() { pop.classList.remove('open'); pop.classList.add('hidden'); }
    function toggle(e) {
      if (e) e.stopPropagation();
      if (pop.classList.contains('open')) close(); else open();
    }
    on(btn, 'click', toggle);
    on(document, 'click', function (e) {
      const t = e.target;
      if (pop.classList.contains('open') && t && !pop.contains(t)) close();
    });
    on(document, 'keydown', function (e) {
      if (e.key === 'Escape' && pop.classList.contains('open')) close();
    });
    // 返回手势关闭（与 dialog-behavior.js 协作：面板打开时拦截）
    on(document, 'sgx-topbar-pop-close', function () {
      if (pop.classList.contains('open')) close();
    });
  })();

  /* ---- 天气：图标+温度；面板从主站 nav.js 移植 ---- */
  if (S.wx) (function () {
    const icEl = document.getElementById('nav-wx-ic');
    const tEl2 = document.getElementById('nav-wx-t');
    const btn = document.getElementById('nav-wx');
    if (!icEl || !tEl2 || !btn) return;
    const WXI = {
      0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌦️',
      55: '🌧️', 61: '🌧️', 63: '🌧️', 65: '🌧️', 71: '🌨️', 73: '🌨️', 75: '❄️',
      80: '🌦️', 81: '🌧️', 82: '⛈️', 95: '⛈️', 96: '⛈️',
    };
    function getCache() {
      try {
        const c = JSON.parse(localStorage.getItem('sgx-weather') || 'null');
        if (c && Date.now() - c.ts < 30 * 60 * 1000) return c.data;
      } catch (e) {}
      return null;
    }
    function getCacheAny() {
      try {
        const c = JSON.parse(localStorage.getItem('sgx-weather') || 'null');
        if (c && c.data) return c.data;
      } catch (e) {}
      return null;
    }
    function save(d) {
      try { localStorage.setItem('sgx-weather', JSON.stringify({ ts: Date.now(), data: d })); } catch (e) {}
    }
    function fmtT(c) {
      return S.unit === 'f' ? Math.round((c * 9) / 5 + 32) : Math.round(c);
    }
    function renderWxPop(d) {
      const pop = document.getElementById('nav-wx-pop');
      if (!pop || !d || !d.current) return;
      const cur = d.current, day = d.daily;
      let h = '<div class="wxp-city">' +
        ((d.city || '').replace(/</g, '&lt;') || (en ? 'Weather' : '天气')) +
        '</div><div class="wxp-main"><span class="wxp-ic">' +
        (WXI[cur.weather_code] || '☁️') +
        '</span><span class="wxp-temp clock-num">' +
        fmtT(cur.temperature_2m) + '°</span></div>';
      if (day && day.temperature_2m_max && day.temperature_2m_min) {
        h += '<div class="wxp-hilo">' +
          (en ? 'H:' : '最高 ') + fmtT(day.temperature_2m_max[0]) + '°  ' +
          (en ? 'L:' : '最低 ') + fmtT(day.temperature_2m_min[0]) + '°</div>';
      }
      pop.innerHTML = '<div class="dex-pop-card">' + h + '</div>';
    }
    function render(d) {
      if (!d || !d.current) return;
      icEl.textContent = WXI[d.current.weather_code] || '☁️';
      tEl2.textContent = fmtT(d.current.temperature_2m) + '°';
      btn.style.display = '';
      btn.title = (d.city || '') + (en ? ' weather' : ' 天气');
      renderWxPop(d);
    }
    function hide() { btn.style.display = 'none'; }
    const c = getCache();
    if (c) render(c);
    if (!c) {
      // 定位：manual 用 cookie 里的城市；auto 用 /api/geo（IP 定位）
      function fetchWx(lat, lon, city) {
        return fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
          '&longitude=' + lon +
          '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1'
        ).then(function (r) {
          if (!r.ok) throw 0;
          return r.json();
        }).then(function (j) {
          const d = { current: j.current, daily: j.daily, city: city || '' };
          save(d); render(d);
        });
      }
      if (S.loc === 'manual' && S.city && isFinite(parseFloat(S.city.lat)) && isFinite(parseFloat(S.city.lon))) {
        fetchWx(parseFloat(S.city.lat), parseFloat(S.city.lon), S.city.name || '').catch(function () {
          const old = getCacheAny(); if (old) render(old); else hide();
        });
      } else {
        fetch('/api/geo').then(function (r) { return r.json(); }).catch(function () { return {}; })
          .then(function (g) {
            const lat = parseFloat(g.latitude), lon = parseFloat(g.longitude);
            if (!isFinite(lat) || !isFinite(lon)) throw 0;
            return fetchWx(lat, lon, g.city || '');
          }).catch(function () {
            const old = getCacheAny(); if (old) render(old); else hide();
          });
      }
    }
    function toggleWxPop(e) {
      const pop = document.getElementById('nav-wx-pop');
      if (!pop) return;
      if (e) e.stopPropagation();
      const cc = getCache() || getCacheAny();
      if (cc) renderWxPop(cc);
      pop.classList.toggle('open');
    }
    on(btn, 'click', toggleWxPop);
    on(document, 'click', function (e) {
      const pop = document.getElementById('nav-wx-pop');
      const t = e.target;
      if (pop && pop.classList.contains('open') && t && !pop.contains(t) && !btn.contains(t))
        pop.classList.remove('open');
    });
    on(document, 'keydown', function (e) {
      if (e.key === 'Escape') {
        const pop = document.getElementById('nav-wx-pop');
        if (pop) pop.classList.remove('open');
      }
    });
    on(document, 'sgx-topbar-pop-close', function () {
      const pop = document.getElementById('nav-wx-pop');
      if (pop && pop.classList.contains('open')) pop.classList.remove('open');
    });
  })();
}
