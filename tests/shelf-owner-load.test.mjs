// 书架 owner 加载回归测试（fix/shelf-owner-load）
// 根因：layouts/index.html 的 renderContinue() 残留了引用未声明变量 loggedIn 的旧代码，
// owner 进书架时抛 ReferenceError，被 loadBooks 的 catch 吃掉显示「加载失败」。
// 覆盖：
//   1. 内联脚本不引用未声明的 loggedIn
//   2. 用 vm + 最小 DOM stub 跑 owner 分支的 loadBooks（fetch 返回 {"books":[]}），
//      断言不抛错、bk-error 保持 hidden
// 运行：node tests/shelf-owner-load.test.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../layouts/index.html', import.meta.url), 'utf8');

// 提取内联 <script>（不含 src 的）
const scripts = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html)) !== null) {
  scripts.push(m[1]);
}
assert.ok(scripts.length > 0, '应找到内联脚本');
const src = scripts.join('\n');

// 1. 静态检查：不应引用 loggedIn（index.html 里从未声明，只有 read.html 有）
assert.ok(!/\bloggedIn\b/.test(src), '内联脚本不应引用未声明的 loggedIn');

// 2. 动态检查：跑 owner 分支的 loadBooks
// 最小 DOM stub
function makeEl() {
  return {
    classList: {
      _set: new Set(['hidden']),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    style: {},
    textContent: '',
    querySelector() { return null; },
  };
}

const els = {};
function getElementById(id) {
  if (!els[id]) els[id] = makeEl();
  return els[id];
}

// loadBooks 依赖的全局
const sandbox = {
  console,
  document: { getElementById },
  window: {},
  // isOwner=true 走 owner 分支
  isOwner: true,
  books: [],
  bookById: {},
  progressMap: {},
  sortMode: 'added',
  T: {
    loading: '加载中',
    loadFail: '加载失败',
    count: (n) => `共 ${n} 本`,
  },
  subEl: () => null,
  // sgxLockSync.apiFetch 返回 {"books":[]}
  sgxLockSync: {
    apiFetch: async () => ({
      ok: true,
      json: async () => ({ books: [] }),
    }),
  },
  // render* 存根：renderContinue 是重点（曾抛 ReferenceError）
  renderChips: () => {},
  renderGrid: () => {},
  loadProgress: () => {},
};

vm.createContext(sandbox);

// 只执行 loadBooks 和 renderContinue 相关的函数定义
// 提取函数：loadBooks, renderContinue, renderChips(存根已给), renderGrid(存根已给)
const fnNames = ['loadBooks', 'renderContinue'];
let testSrc = '';
for (const name of fnNames) {
  const fnRe = new RegExp(`(async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'g');
  const match = fnRe.exec(src);
  assert.ok(match, `应找到函数 ${name}`);
  // 简单括号匹配提取函数体
  let depth = 0;
  let start = match.index;
  let i = src.indexOf('{', start);
  let end = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  testSrc += src.slice(start, end) + '\n';
}

vm.runInContext(testSrc, sandbox);
vm.runInContext('loadBooks()', sandbox);

// 等待 async 完成
await new Promise((r) => setTimeout(r, 100));

// 断言：bk-error 保持 hidden（没有显示「加载失败」）
const errEl = getElementById('bk-error');
assert.ok(errEl.classList.contains('hidden'), 'owner 加载空书架时 bk-error 应保持 hidden');

console.log('ok: shelf-owner-load passed');
