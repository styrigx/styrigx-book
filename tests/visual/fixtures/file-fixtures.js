/* 视觉回归测试用文件固件：在内存里生成最小可用的 EPUB / PDF，
 * 让 /read/ 阅读器真正渲染出内容再截图。
 *
 * 用法（playwright route 里）：
 *   const { makeEpub, makePdf } = require('./fixtures/file-fixtures.js');
 *   await route.fulfill({ body: makeEpub(), contentType: 'application/epub+zip' });
 */
'use strict';

const { deflateRawSync } = require('node:zlib');

/* ---------- CRC32（ZIP 本地文件头需要） ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- 极简 ZIP 打包（只做 EPUB 需要的） ---------- */
function zip(entries) {
  // entries: [{ name, data: Buffer, stored: boolean }]
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const body = e.stored ? raw : deflateRawSync(raw);
    const method = e.stored ? 0 : 8;
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    for (let i = 30; i < 46; i++) ch[i] = 0;
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + body.length;
  }
  const centralStart = offset;
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...central, end]);
}

/* ---------- 最小 EPUB（两章，中文段落） ---------- */
function chapter(n, title, paras) {
  const ps = paras.map(p => `    <p>${p}</p>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" lang="zh">\n` +
    `<head><title>${title}</title></head>\n<body>\n  <h2>${title}</h2>\n${ps}\n</body>\n</html>\n`;
}

function makeEpub() {
  const lorem = [
    '这是视觉回归测试用的示例电子书第一章。文字内容固定，渲染结果稳定。',
    '第二段文字，用于填充页面，观察分页与行距是否符合预期。',
    '第三段文字。阅读器主题、字号、行距的设置都可以在设置面板里调整。',
    '第四段文字。深色模式下背景变深，文字变浅，对比度保持可读。',
  ];
  const lorem2 = [
    '第二章开始。这里是另一段固定的中文文本，用来验证目录跳转。',
    'EPUB 阅读器使用 foliate-js 渲染，支持目录、搜索与阅读进度同步。',
    '最后一页。截图时只取首屏，不翻页，保证基线稳定。',
  ];
  return zip([
    { name: 'mimetype', data: 'application/epub+zip', stored: true },
    { name: 'META-INF/container.xml', data:
      `<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n` +
      `  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n` },
    { name: 'OEBPS/content.opf', data:
      `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">\n` +
      `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
      `    <dc:identifier id="uid">visual-test-epub</dc:identifier>\n` +
      `    <dc:title>视觉测试示例书</dc:title>\n<dc:language>zh</dc:language>\n  </metadata>\n` +
      `  <manifest>\n    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>\n` +
      `    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>\n  </manifest>\n` +
      `  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>\n</package>\n` },
    { name: 'OEBPS/chapter1.xhtml', data: chapter(1, '第一章 绿灯', lorem) },
    { name: 'OEBPS/chapter2.xhtml', data: chapter(2, '第二章 彼岸', lorem2) },
  ]);
}

/* ---------- 最小 PDF（一页，纯英文避免字体子集问题） ---------- */
function makePdf() {
  const lines = [
    'Visual Regression Test PDF',
    '',
    'This is a minimal PDF fixture for the book reader.',
    'It renders one page with the built-in Helvetica font,',
    'so the screenshot is stable across environments.',
    '',
    'Page 1 of 1.',
  ];
  const textOps = lines.map((l, i) =>
    `BT /F1 18 Tf 72 ${720 - i * 30} Td (${l.replace(/[()\\]/g, m => '\\' + m)}) Tj ET`
  ).join('\n');
  const content = Buffer.from(textOps, 'latin1');

  const objs = [];
  objs[1] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1');
  objs[2] = Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1');
  objs[3] = Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', 'latin1');
  objs[4] = Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]);
  objs[5] = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'latin1');

  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = parts.reduce((s, b) => s + b.length, 0);
    parts.push(Buffer.from(`${i} 0 obj\n`, 'latin1'), objs[i], Buffer.from('\nendobj\n', 'latin1'));
  }
  const xrefPos = parts.reduce((s, b) => s + b.length, 0);
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  parts.push(Buffer.from(xref, 'latin1'));
  parts.push(Buffer.from(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

module.exports = { makeEpub, makePdf };
