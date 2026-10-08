// 把 foliate-js 和 pdfjs-dist 从 node_modules 复制到 static/js/vendor/，不走 CDN。
// 只拷阅读器实际用到的文件（白名单），第三方库自己的 LICENSE 一并保留。
// 用法：node scripts/vendor.mjs
import { copyFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'static', 'js', 'vendor');
mkdirSync(out, { recursive: true });

function copyList(srcRoot, dstRoot, files) {
  for (const f of files) {
    const src = join(srcRoot, f);
    if (!existsSync(src)) {
      console.error(`vendor: 缺少 ${src}，先跑 npm install`);
      process.exit(1);
    }
    const dst = join(dstRoot, f);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
}

// foliate-js：阅读器只处理 EPUB（+ 目录 loader 共用 vendor/zip.js）。
// 未用到的格式（dict / fb2 / mobi / comic-book）和演示/构建杂项（reader.* / rollup / ui / opds）不拷。
const folSrc = join(root, 'node_modules', 'foliate-js');
const folDst = join(out, 'foliate-js');
if (!existsSync(folSrc)) {
  console.error('vendor: node_modules/foliate-js 不存在，先跑 npm install');
  process.exit(1);
}
rmSync(folDst, { recursive: true, force: true });
copyList(folSrc, folDst, [
  'view.js',
  'epub.js',
  'epubcfi.js',
  'progress.js',
  'overlayer.js',
  'text-walker.js',
  'paginator.js',
  'search.js',
  'tts.js',
  'fixed-layout.js',
  'vendor/zip.js',
  'vendor/fflate.js',
  'LICENSE',
]);
console.log('vendor: foliate-js ->', folDst);

// pdfjs-dist：只需要 min 版的库和 worker（页面引用 pdf.min.mjs / pdf.worker.min.mjs）。
const pdfRoot = join(root, 'node_modules', 'pdfjs-dist');
const pdfSrc = join(pdfRoot, 'build');
const pdfDst = join(out, 'pdfjs');
if (!existsSync(pdfSrc)) {
  console.error('vendor: node_modules/pdfjs-dist/build 不存在，先跑 npm install');
  process.exit(1);
}
rmSync(pdfDst, { recursive: true, force: true });
copyList(pdfSrc, pdfDst, ['pdf.min.mjs', 'pdf.worker.min.mjs']);
copyList(pdfRoot, pdfDst, ['LICENSE']);
console.log('vendor: pdfjs-dist/build ->', pdfDst);
console.log('vendor: done');
