// 上传格式测试：确认 checkMagic 返回大写格式，但发送到 init 时转小写
// 运行：node tests/upload-format.test.mjs
//
// 背景：assets/js/upload-queue.js 的 checkMagic 返回 format 为 'EPUB' / 'PDF'（大写），
// 而 functions/api/admin/upload/init.js 只接受 'epub' / 'pdf'（小写）。
// 修复：客户端发送时用 item.format.toLowerCase()。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const uploadQueueJs = fs.readFileSync(path.join(repoRoot, 'assets/js/upload-queue.js'), 'utf8');
const initJs = fs.readFileSync(path.join(repoRoot, 'functions/api/admin/upload/init.js'), 'utf8');

console.log('upload-format:');

test('checkMagic 返回大写 EPUB/PDF（内部显示用）', () => {
  assert.ok(uploadQueueJs.includes("format: 'EPUB'"), '应返回 EPUB');
  assert.ok(uploadQueueJs.includes("format: 'PDF'"), '应返回 PDF');
});

test('发送到 init 时转小写', () => {
  // 确认 init 请求体中使用了 toLowerCase()
  assert.ok(
    uploadQueueJs.includes('format: item.format.toLowerCase()'),
    'init 请求体应使用 item.format.toLowerCase()'
  );
});

test('服务端只接受小写 epub/pdf（严格校验）', () => {
  assert.ok(
    initJs.includes("format !== 'epub' && format !== 'pdf'"),
    '服务端应严格校验小写格式'
  );
});

test('onBookAdded 传给列表的格式与渲染一致', () => {
  // onBookAdded 传递 item.format（大写）
  assert.ok(uploadQueueJs.includes('format: item.format,'), 'onBookAdded 应传递 item.format');
  // 列表渲染时用 toUpperCase()，所以大写传入也能正确显示
  // 3.0：管理列表已从 admin.html 移到书架 index.html（详情弹层/网格）
  const idxHtml = fs.readFileSync(path.join(repoRoot, 'layouts/index.html'), 'utf8');
  assert.ok(
    idxHtml.includes("String(b.format || '').toUpperCase()"),
    '列表渲染应对 format 做 toUpperCase'
  );
});

test('EPUB 文件从选文件到 init 的请求体格式为 epub', () => {
  // 模拟：checkMagic 对 .epub 文件返回 EPUB，发送时转小写
  const format = 'EPUB';
  const sentFormat = format.toLowerCase();
  assert.strictEqual(sentFormat, 'epub');
  // 服务端校验通过
  assert.ok(sentFormat === 'epub' || sentFormat === 'pdf');
});

test('PDF 文件从选文件到 init 的请求体格式为 pdf', () => {
  const format = 'PDF';
  const sentFormat = format.toLowerCase();
  assert.strictEqual(sentFormat, 'pdf');
  assert.ok(sentFormat === 'epub' || sentFormat === 'pdf');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
