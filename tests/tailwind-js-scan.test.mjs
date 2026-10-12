// Tailwind 漏扫 JS 测试（styrigx-book）
// 运行：node tests/tailwind-js-scan.test.mjs
//
// 背景：#22 把 static/js/upload-queue.js、sgx-lock-sync.js 移到 assets/js/，
// 但 tailwind.config.js 的 content 仍是 './static/js/**/*.js'，导致只在 JS 里
// 出现的类（min-w-0、truncate、min-[420px]:grid-cols-2、开关样式等）被裁掉，
// 管理页上传队列卡片溢出、开关变回原生样式（#20 的布局修复失效）。
// 本测试确保构建后的 CSS 包含 JS 里用到的关键类，防止再次漏扫。

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      console.error(`  ✗ ${name}: ${e.message}`);
      process.exitCode = 1;
    });
}

console.log('tailwind-js-scan:');

await test('content 包含 ./assets/js/**/*.js', () => {
  const cfg = readFileSync(join(root, 'tailwind.config.js'), 'utf8');
  assert.ok(
    cfg.includes("'./assets/js/**/*.js'") || cfg.includes('"./assets/js/**/*.js"'),
    'tailwind.config.js 的 content 必须包含 ./assets/js/**/*.js'
  );
  // 保留 static/js 以覆盖 vendor 以外的脚本
  assert.ok(
    cfg.includes("'./static/js/**/*.js'") || cfg.includes('"./static/js/**/*.js"'),
    'tailwind.config.js 的 content 必须保留 ./static/js/**/*.js'
  );
});

await test('构建后的 CSS 包含 JS 关键类', () => {
  // 重新构建，确保与当前 content 配置一致
  execSync('npx tailwindcss -i assets/css/input.css -o assets/css/main.css --minify', {
    cwd: root,
    stdio: 'pipe',
    timeout: 60000,
  });
  const css = readFileSync(join(root, 'assets/css/main.css'), 'utf8');

  // upload-queue.js 里用到的关键类（CSS 中转义写法）
  const required = [
    ['min-w-0', '.min-w-0'],
    ['truncate', '.truncate'],
    ['min-[420px]:grid-cols-2', '.min-\\[420px\\]\\:grid-cols-2'],
    // 开关样式（switchHTML）：peer + after 伪元素变体
    ['peer-checked:bg-m-primary', '.peer-checked\\:bg-m-primary'],
    ['peer-checked:after:translate-x-4', '.peer-checked\\:after\\:translate-x-4'],
    ['after:w-4 / after:h-4', '.after\\:w-4'],
    // 状态徽章
    ['whitespace-nowrap', '.whitespace-nowrap'],
  ];
  for (const [label, sel] of required) {
    assert.ok(css.includes(sel), `构建后的 CSS 缺少 ${label}（${sel}）`);
  }
});

console.log(`\n${passed} passed`);
