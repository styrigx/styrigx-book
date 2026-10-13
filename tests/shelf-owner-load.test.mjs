// 书架 owner 加载回归测试（fix/shelf-owner-load，3.0 重写）
// 旧根因：layouts/index.html 的 renderContinue() 残留引用未声明变量 loggedIn 的旧代码，
// owner 进书架时抛 ReferenceError，被 loadBooks 的 catch 吃掉显示「加载失败」。
// 3.0：书架进度只从 /api/private/books 的 percent 读，不再读 localStorage；
// renderContinue 已被 renderStrip + renderFAB 取代。
// 覆盖：
//   1. 内联脚本不引用未声明的 loggedIn
//   2. 内联脚本不读 localStorage 进度（bk-progress-* 只允许删除清理，不允许 getItem）
//   3. 纯函数 readState 边界：null/0 → 未读，0<p<99 → 在读，>=99 → 已读
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

// 2. 静态检查：不读 localStorage 进度（进度只从 /api/private/books 的 percent 来）
assert.ok(!/localStorage\.getItem\(['"]bk-progress-/.test(src), '书架不应再读 localStorage 进度');
assert.ok(!/localStorage\[.bk-progress-/.test(src), '书架不应再读 localStorage 进度');

// 3. 纯函数 readState 边界（提取 pctOf / readState / statusLabel 跑 vm）
const fnNames = ['pctOf', 'readState', 'statusLabel'];
let testSrc = 'var READ_DONE = 99;\nvar T = { unread: "未读", read: "已读", readingPct: function(p){ return "在读 " + p + "%"; } };\n';
for (const name of fnNames) {
  const fnRe = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'g');
  const match = fnRe.exec(src);
  assert.ok(match, `应找到函数 ${name}`);
  let depth = 0;
  const start = match.index;
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
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(testSrc, sandbox);
const { readState, statusLabel } = sandbox;
assert.equal(readState({}), 'unread', '无 percent → 未读');
assert.equal(readState({ percent: null }), 'unread', 'percent null → 未读');
assert.equal(readState({ percent: 0 }), 'unread', 'percent 0 → 未读');
assert.equal(readState({ percent: 0.5 }), 'reading', 'percent 0.5 → 在读');
assert.equal(readState({ percent: 42 }), 'reading', 'percent 42 → 在读');
assert.equal(readState({ percent: 98.9 }), 'reading', 'percent 98.9 → 在读');
assert.equal(readState({ percent: 99 }), 'read', 'percent 99 → 已读');
assert.equal(readState({ percent: 100 }), 'read', 'percent 100 → 已读');
assert.equal(statusLabel({ percent: 42 }), '在读 42%', '在读显示在读 + 百分比');
assert.equal(statusLabel({ percent: 100 }), '已读', '已读显示已读');
assert.equal(statusLabel({ percent: 0 }), '未读', '未读显示未读');

console.log('ok: shelf-owner-load passed');
