// 无下载约束测试：确认 layouts/ 输出中无任何下载按钮、下载链接或文件名暴露
// 运行：node tests/no-download.test.mjs
//
// 技术约束（book 2.0）：
// - 无 <a download> 指向 /api/file 或 /api/private/file
// - 无 fileURL() 之类的下载链接构造
// - 无原始文件名暴露给前端下载

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
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

function readLayouts() {
  const files = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) files.push(p);
    }
  }
  walk(path.join(repoRoot, 'layouts'));
  return files.map(f => ({ file: path.relative(repoRoot, f), content: fs.readFileSync(f, 'utf8') }));
}

console.log('no-download:');

test('layouts/ 无 download 属性的 <a> 标签', () => {
  const files = readLayouts();
  const hits = [];
  // 匹配 <a ... download ...>（download 作为独立属性）
  const re = /<a\b[^>]*\bdownload\b[^>]*>/gi;
  for (const { file, content } of files) {
    const m = content.match(re);
    if (m) hits.push(`${file}: ${m.length} 处`);
  }
  assert.equal(hits.length, 0, '发现 download 属性：' + hits.join('; '));
});

test('layouts/ 无指向 /api/file 或 /api/private/file 的 href 构造', () => {
  const files = readLayouts();
  const hits = [];
  const re = /\/api\/(private\/)?file\?/g;
  for (const { file, content } of files) {
    // 允许 read.html 阅读器内部使用（那是阅读器加载文件，不是下载）
    // 但不允许出现在 index.html（书架/详情弹层）
    if (file.includes('index.html') && re.test(content)) {
      hits.push(file);
    }
    re.lastIndex = 0;
  }
  assert.equal(hits.length, 0, 'index.html 中发现文件接口引用：' + hits.join(', '));
});

test('layouts/index.html 无 fileURL / T.download 残留', () => {
  const p = path.join(repoRoot, 'layouts', 'index.html');
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(!content.includes('fileURL'), '发现 fileURL 残留');
  assert.ok(!content.includes('T.download'), '发现 T.download 残留');
  assert.ok(!/download\s*:\s*isEn/.test(content), '发现 download 文案残留');
});

test('hugo 构建产物（public/）无 download 属性指向文件接口', () => {
  // 如果 public/ 不存在（未构建），跳过
  const pubDir = path.join(repoRoot, 'public');
  if (!fs.existsSync(pubDir)) {
    console.log('    (跳过：public/ 未构建)');
    return;
  }
  const hits = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.html')) continue;
      const c = fs.readFileSync(p, 'utf8');
      // 找 <a ... download ... href=".../api/(private/)?file..."> 或反之
      const re = /<a\b[^>]*>/gi;
      let m;
      while ((m = re.exec(c)) !== null) {
        const tag = m[0];
        if (/\bdownload\b/i.test(tag) && /\/api\/(private\/)?file/i.test(tag)) {
          hits.push(path.relative(pubDir, p));
          break;
        }
      }
    }
  }
  walk(pubDir);
  assert.equal(hits.length, 0, '构建产物中发现下载链接：' + hits.join(', '));
});

console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ''}`);
