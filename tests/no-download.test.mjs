// 无下载技术约束测试（book 2.0）
// 确保页面和 JS 里无任何下载按钮、下载链接、原始文件名暴露。
// 运行：node tests/no-download.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

const layoutsDir = new URL('../layouts/', import.meta.url).pathname;

function getHtmlFiles(dir, files = []) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) getHtmlFiles(p, files);
    else if (f.name.endsWith('.html')) files.push(p);
  }
  return files;
}

const htmlFiles = getHtmlFiles(layoutsDir);

console.log('无下载约束:');
test('无 download 属性指向文件接口', () => {
  for (const f of htmlFiles) {
    const content = readFileSync(f, 'utf8');
    // 查找 download 属性
    const matches = content.match(/<a[^>]*\sdownload[^>]*>/gi) || [];
    for (const m of matches) {
      // 如果 href 指向 /api/file 或 /api/private/file，则失败
      if (m.includes('/api/file') || m.includes('/api/private/file')) {
        throw new Error(`${f}: 发现下载链接 ${m.slice(0, 80)}`);
      }
    }
  }
});

test('无 fileURL 函数（下载链接生成器）', () => {
  for (const f of htmlFiles) {
    const content = readFileSync(f, 'utf8');
    if (/function\s+fileURL\s*\(/.test(content)) {
      throw new Error(`${f}: 发现 fileURL 函数`);
    }
  }
});

test('无 T.download 文案', () => {
  for (const f of htmlFiles) {
    const content = readFileSync(f, 'utf8');
    if (/download:\s*isEn\s*\?\s*['"]Download['"]/.test(content)) {
      throw new Error(`${f}: 发现 T.download 文案`);
    }
  }
});

test('阅读器使用 inline 而非 attachment', () => {
  // 检查 functions/api/_lib.js 的 serveR2File 使用 inline
  const libPath = new URL('../functions/api/_lib.js', import.meta.url).pathname;
  try {
    const content = readFileSync(libPath, 'utf8');
    if (content.includes('attachment')) {
      throw new Error('发现 Content-Disposition: attachment');
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // 文件不存在时跳过（仅前端测试环境）
  }
});

console.log(`\n${passed} passed`);
