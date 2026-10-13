// 排版封面书名断词测试：书名不得拆词（设计稿 v1.3）。
// 运行：node tests/cover-title.test.mjs
//
// 背景：360 宽下《塞尔达传说：旷野之息设定集》的排版封面曾断成
// 「塞尔达传 / 说：旷野…」。修复：coverTitleHTML 在可断行标点后插 <wbr>，
// 配合 CSS word-break: keep-all，浏览器只在标点 / 空格处断行。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../assets/js/book-cover.js';
const { coverTitleHTML } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

/* 可断行字符：中文标点 + 英文标点 + 斜杠 + 空白。<wbr> 只许出现在这些字符之后。 */
const BREAKABLE = new Set(['：', '、', '，', ',', '。', '；', '！', '？', '·', '/', '／', ' ', '\t', '\n']);
function assertNoMidWordWbr(html) {
  for (let i = 0; i < html.length; i++) {
    if (html.startsWith('<wbr>', i)) {
      const prev = html[i - 1];
      assert.ok(BREAKABLE.has(prev), `<wbr> 前应为可断行标点/空格，实际为「${prev}」：${html}`);
    }
  }
}

console.log('cover-title:');

test('塞尔达标题：在「：」后断行，不断词', () => {
  const out = coverTitleHTML('塞尔达传说：旷野之息设定集');
  assert.equal(out, '塞尔达传说：<wbr>旷野之息设定集');
  assertNoMidWordWbr(out);
});

test('长书名样例：在「：」后断行，不断词', () => {
  const out = coverTitleHTML('为什么我们总是对自己撒谎：心理学与自我欺骗');
  assert.equal(out, '为什么我们总是对自己撒谎：<wbr>心理学与自我欺骗');
  assertNoMidWordWbr(out);
});

test('无标点书名：不插 <wbr>', () => {
  assert.equal(coverTitleHTML('了不起的盖茨比'), '了不起的盖茨比');
  assert.equal(coverTitleHTML('黄土地'), '黄土地');
});

test('英文书名：空格后可断行', () => {
  const out = coverTitleHTML('The Great Gatsby');
  assert.equal(out, 'The <wbr>Great <wbr>Gatsby');
  assertNoMidWordWbr(out);
});

test('转义：HTML 字符先转义，<wbr> 不被转义', () => {
  const out = coverTitleHTML('A<B：C&D');
  assert.equal(out, 'A&lt;B：<wbr>C&amp;D');
});

test('CSS：排版封面标题禁拆词（word-break: keep-all）', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'assets/css/input.css'), 'utf8');
  const rule = css.match(/\.bk-gen-title\{[^}]*\}/);
  assert.ok(rule, '应有 .bk-gen-title 规则');
  assert.ok(rule[0].includes('word-break:keep-all'), '应含 word-break:keep-all');
  assert.ok(rule[0].includes('text-wrap:balance'), '应含 text-wrap:balance');
});

test('排版封面用 coverTitleHTML 渲染标题', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'layouts/index.html'), 'utf8');
  assert.ok(html.includes('coverTitleHTML(b.title)'), '排版封面标题应走 coverTitleHTML');
});

console.log(`\ncover-title: ${passed} passed, ${failed} failed`);
