// 封面 img 回落单元测试（hotfix v1.1）：coverImgHTML 必须带 onerror 和 data-*。
// 运行：node tests/cover-fallback.test.mjs
import assert from 'node:assert/strict';
import pkg from '../assets/js/book-cover.js';
const { coverImgHTML, genCoverHTML } = pkg;

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

test('coverImgHTML 导出存在', () => {
  assert.equal(typeof coverImgHTML, 'function');
});

test('img 带 onerror 回落和 data-*（标题/作者/尺寸）', () => {
  const html = coverImgHTML('/api/private/cover?key=covers%2Fa.webp', '测试书名', '作者甲', 'md', 'absolute inset-0 w-full h-full object-cover');
  assert.ok(html.includes('onerror="window.__sgxCoverErr(this)"'), '必须有 onerror：' + html);
  assert.ok(html.includes('data-covt="测试书名"'), '必须有 data-covt：' + html);
  assert.ok(html.includes('data-cova="作者甲"'), '必须有 data-cova：' + html);
  assert.ok(html.includes('data-covs="md"'), '必须有 data-covs：' + html);
  assert.ok(html.includes('src="/api/private/cover?key=covers%2Fa.webp"'), 'src 必须原样：' + html);
});

test('data-* 中的引号被转义（不破坏属性）', () => {
  const html = coverImgHTML('/api/cover?key=x', '书名"有引号"', '作者', 'sm', 'c');
  assert.ok(html.includes('data-covt="书名&quot;有引号&quot;"'), '引号必须转义：' + html);
  assert.ok(!html.includes('data-covt="书名"有引号'), '不能出现未转义引号');
});

test('回落用的 genCoverHTML 与直接调用一致（同一套生成封面）', () => {
  /* __sgxCoverErr 用 data-* 重建时调用的正是 genCoverHTML，这里确认它可被 require */
  const html = genCoverHTML('测试书名', '作者甲', 'md');
  assert.ok(html.includes('bk-gen'), '生成封面应有 bk-gen 类');
  assert.ok(html.includes('linear-gradient'), '生成封面应有渐变');
});

console.log(`\n${passed} passed, ${failed} failed`);
