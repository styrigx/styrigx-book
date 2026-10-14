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
const { coverTitleHTML, genCoverHTML } = pkg;

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

/* <wbr> 安全位置：只许在括号外、且不在右括号前、不在左括号后。
 * （长串切分会在普通字符后插 <wbr>，故不再要求 <wbr> 前必为标点/空格。） */
function assertSafeWbr(html) {
  assert.ok(!html.includes('（<wbr>'), '<wbr> 不应在左括号后：' + html);
  assert.ok(!html.includes('(<wbr>'), '<wbr> 不应在左括号后：' + html);
  assert.ok(!html.includes('<wbr>）'), '<wbr> 不应在右括号前：' + html);
  assert.ok(!html.includes('<wbr>)'), '<wbr> 不应在右括号前：' + html);
  assert.ok(!html.includes('（&nbsp;<wbr>'), '括号内不应有 <wbr>：' + html);
}

console.log('cover-title:');

test('塞尔达标题：在「：」后断行，不断词', () => {
  const out = coverTitleHTML('塞尔达传说：旷野之息设定集');
  assert.ok(out.includes('：<wbr>'), '应在「：」后断行：' + out);
  assertSafeWbr(out);
});

test('长书名样例：在「：」后断行，不断词', () => {
  const out = coverTitleHTML('为什么我们总是对自己撒谎：心理学与自我欺骗');
  assert.ok(out.includes('：<wbr>'), '应在「：」后断行：' + out);
  assertSafeWbr(out);
});

test('无标点书名：短串不插 <wbr>，长串在安全点切分', () => {
  assert.equal(coverTitleHTML('黄土地'), '黄土地');
  assert.equal(coverTitleHTML('了不起的盖茨比'), '了不起的<wbr>盖茨比');
});

test('英文书名：空格后可断行', () => {
  const out = coverTitleHTML('The Great Gatsby');
  assert.equal(out, 'The <wbr>Great <wbr>Gat<wbr>sby');
  assertSafeWbr(out);
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

test('CSS：排版封面标题字号下限 12px（小封面不缩到 12px 以下）', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'assets/css/input.css'), 'utf8');
  const rule = css.match(/\.bk-cover \.bk-gen-title\{[^}]*\}/);
  assert.ok(rule, '应有 .bk-cover .bk-gen-title 规则');
  assert.ok(rule[0].includes('max(12px,13cqw)'), '应为 max(12px,13cqw)，标题字号不得低于 12px');
});

test('括号保护：括号内标点后不插 <wbr>，右括号不独占一行', () => {
  const out = coverTitleHTML('三体（刘慈欣、著）');
  assert.equal(out, '三体<wbr>（刘慈欣、著）');
  assertSafeWbr(out);
  const out2 = coverTitleHTML('书名（第一卷：上）');
  assert.equal(out2, '书名<wbr>（第一卷：上）');
});

test('括号保护：括号内空格换成 &nbsp;，不在括号内断行', () => {
  assert.equal(coverTitleHTML('书名（A B）'), '书名<wbr>（A&nbsp;B）');
  assert.equal(coverTitleHTML('Title (Second Edition)'), 'Title <wbr>(Second&nbsp;Edition)');
});

test('括号外断行不受影响：括号后标点仍可断行', () => {
  assert.equal(coverTitleHTML('书名（注）：续'), '书名<wbr>（注）：<wbr>续');
  assert.equal(coverTitleHTML('书名：副标题（注释）'), '书名：<wbr>副标题<wbr>（注释）');
});

test('长串不断行：超长无断点串在安全点插 <wbr>，末段不少于 2 字', () => {
  // 6 字串，maxRun=3 → 均分 3+3
  assert.equal(coverTitleHTML('一二三四五六', 3), '一二三<wbr>四五六');
  // 7 字串，maxRun=3 → 3+4（末段不剩 1 字）
  assert.equal(coverTitleHTML('一二三四五六七', 3), '一二三<wbr>四五六七');
  // 5 字串，maxRun=5 → 不切
  assert.equal(coverTitleHTML('一二三四五', 5), '一二三四五');
  // 括号组不被切分：长串在括号前断开，括号组整体保留
  const out = coverTitleHTML('副标题副标题副标题（注释）', 3);
  assert.ok(!out.includes('（<wbr>'), '不应在左括号后断行');
  assert.ok(!out.includes('<wbr>）'), '不应在右括号前断行');
  assert.ok(out.includes('<wbr>（注释）'), '应在括号组前断行');
});

test('生成封面共享渲染：genCoverHTML 输出渐变 + 全标题 + 作者', () => {
  const html = genCoverHTML('了不起的盖茨比', 'F. Scott Fitzgerald', 'md');
  assert.ok(html.includes('bk-gen-title'), '应含标题');
  assert.ok(html.replace(/<wbr>/g, '').includes('了不起的盖茨比'), '应含书名（除 <wbr> 后）');
  assert.ok(html.includes('bk-gen-author'), 'md 应含作者');
  assert.ok(html.includes('linear-gradient'), '应含渐变底色');
  const sm = genCoverHTML('了不起的盖茨比', 'F. Scott Fitzgerald', 'sm');
  assert.ok(!sm.includes('bk-gen-author'), 'sm 不显示作者');
});

test('统一风格：书架与上传队列共用同一套生成封面', () => {
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'layouts/index.html'), 'utf8');
  assert.ok(!indexHtml.includes('var GEN_COLORS'), 'index.html 不应再自带 GEN_COLORS（用共享模块）');
  assert.ok(indexHtml.includes('window.SgxBookCover.genCoverHTML'), '书架应走共享 genCoverHTML');
  assert.ok(!indexHtml.includes("coverHTML(b, 'sm') + '</div>'"), '访客条不应手写封面盒子（走 coverBoxHTML）');
  const queueJs = fs.readFileSync(path.join(repoRoot, 'assets/js/upload-queue.js'), 'utf8');
  assert.ok(queueJs.includes('SgxBookCover.genCoverHTML'), '上传队列无封面时应走共享 genCoverHTML，不用首字占位');
  const adminHtml = fs.readFileSync(path.join(repoRoot, 'layouts/_default/admin.html'), 'utf8');
  assert.ok(adminHtml.includes('js/book-cover.js'), '上传页应加载 book-cover.js');
});

test('排版封面用 coverTitleHTML 渲染标题', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'layouts/index.html'), 'utf8');
  assert.ok(html.includes('coverTitleHTML(b.title)'), '详情标题应走 coverTitleHTML');
  const coverJs = fs.readFileSync(path.join(repoRoot, 'assets/js/book-cover.js'), 'utf8');
  assert.ok(coverJs.includes("coverTitleHTML(title)"), '共享 genCoverHTML 应走 coverTitleHTML');
});

console.log(`\ncover-title: ${passed} passed, ${failed} failed`);
