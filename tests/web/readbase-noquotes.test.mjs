// readBase/adminBase 引号测试（hotfix v1.2）：正式构建产物里
// readBase 的值必须是 /read/（不能是 "/read/" 带引号），否则
// readUrl() 拼出 "/read/"?id=… → 浏览器解析成 /%22/read/%22?id=… → 404。
// 根因：{{ $readBase | jsonify }} 在 <script> JS 上下文被二次编码。
// 运行（仓库根目录）：node tests/web/readbase-noquotes.test.mjs（会跑 hugo --minify -s web 和 hugo -s web）
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

// 单引号+双引号：双重编码的标记（值里带了引号）
// 正常：je="/read/" ；buggy：je='"/read/"'
const BUGGY_READ = "'\"/read/\"'";
const BUGGY_ADMIN = "'\"/admin/\"'";
const BUGGY_READ_EN = "'\"/en/read/\"'";
const BUGGY_ADMIN_EN = "'\"/en/admin/\"'";

function checkMinified(path, readExpect, adminExpect) {
  const html = readFileSync(path, 'utf8');
  assert.ok(!html.includes("'\"" + readExpect + "\"'"),
    `${path} 有双重编码残留（值里带引号）`);
  assert.ok(!html.includes("'\"" + adminExpect + "\"'"),
    `${path} 有双重编码残留（值里带引号）`);
  assert.ok(html.includes('"' + readExpect + '"'), `${path} 必须有 "${readExpect}"`);
  assert.ok(html.includes('"' + adminExpect + '"'), `${path} 必须有 "${adminExpect}"`);
  assert.ok(!html.includes('%22'), `${path} 不能有 %22`);
}

function checkPlain(path, readExpect, adminExpect) {
  const html = readFileSync(path, 'utf8');
  const m1 = html.match(/var readBase = "([^"]*)";/);
  const m2 = html.match(/var adminBase = "([^"]*)";/);
  assert.ok(m1, `${path} 找不到 var readBase`);
  assert.ok(m2, `${path} 找不到 var adminBase`);
  assert.equal(m1[1], readExpect, `${path} readBase 值应为 ${readExpect}，实际 ${m1[1]}`);
  assert.equal(m2[1], adminExpect, `${path} adminBase 值应为 ${adminExpect}，实际 ${m2[1]}`);
}

console.log('  building (hugo --minify)...');
execSync('hugo --minify -s web', { stdio: 'pipe' });
test('minify：public/index.html readBase="/read/" adminBase="/admin/" 无引号残留', () => {
  checkMinified('web/public/index.html', '/read/', '/admin/');
});
test('minify：public/en/index.html readBase="/en/read/" adminBase="/en/admin/" 无引号残留', () => {
  checkMinified('web/public/en/index.html', '/en/read/', '/en/admin/');
});

console.log('  building (hugo)...');
execSync('hugo -s web', { stdio: 'pipe' });
test('plain：public/index.html var readBase 精确等于 "/read/"', () => {
  checkPlain('web/public/index.html', '/read/', '/admin/');
});
test('plain：public/en/index.html var readBase 精确等于 "/en/read/"', () => {
  checkPlain('web/public/en/index.html', '/en/read/', '/en/admin/');
});

console.log(`\n${passed} passed, ${failed} failed`);
