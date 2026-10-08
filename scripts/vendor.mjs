// 把 foliate-js 和 pdfjs-dist 从 node_modules 复制到 static/js/vendor/，不走 CDN。
// 用法：node scripts/vendor.mjs
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'static', 'js', 'vendor');
mkdirSync(out, { recursive: true });

// foliate-js：整包复制（去掉 package.json/README 等杂项）
const folSrc = join(root, 'node_modules', 'foliate-js');
const folDst = join(out, 'foliate-js');
if (!existsSync(folSrc)) {
  console.error('vendor: node_modules/foliate-js 不存在，先跑 npm install');
  process.exit(1);
}
rmSync(folDst, { recursive: true, force: true });
cpSync(folSrc, folDst, {
  recursive: true,
  filter: (src) => !/(package\.json|README|LICENSE|\.md$|\.ts$|test|eslint)/i.test(src),
});
console.log('vendor: foliate-js ->', folDst);

// pdfjs-dist：只需要 build 目录
const pdfSrc = join(root, 'node_modules', 'pdfjs-dist', 'build');
const pdfDst = join(out, 'pdfjs');
if (!existsSync(pdfSrc)) {
  console.error('vendor: node_modules/pdfjs-dist/build 不存在，先跑 npm install');
  process.exit(1);
}
rmSync(pdfDst, { recursive: true, force: true });
cpSync(pdfSrc, pdfDst, {
  recursive: true,
  filter: (src) => !src.endsWith('.map'),
});
console.log('vendor: pdfjs-dist/build ->', pdfDst);
console.log('vendor: done');
