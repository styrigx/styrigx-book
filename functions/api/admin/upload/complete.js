// POST /api/admin/upload/complete — 完成 multipart 上传并写入 D1，需 Access JWT
// body: {uploadId, key, parts:[{partNumber,etag}], sha256, meta:{title,author,lang,pages,tags,visibility,in_shelf}, coverKey}
// 注：sha256 为必填（books.sha256 列 NOT NULL + UNIQUE，init 阶段客户端已计算）。
// in_shelf: 1=上架到主站书单，默认 0。
// 成功 → {id}
import { json, err, methodNotAllowed, BOOK_KEY_RE, COVER_KEY_RE, storageEnabled, storageDisabledResponse } from '../../_lib.js';
import { requireAccess } from '../../_access.js';

const SHA256_RE = /^[a-fA-F0-9]{64}$/;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const { response } = await requireAccess(context);
  if (response) return response;
  if (!storageEnabled(env)) return storageDisabledResponse();

  let body;
  try {
    body = await request.json();
  } catch {
    return err('invalid json', 400);
  }
  const { uploadId, key, parts, sha256, meta = {}, coverKey = null } = body || {};
  if (!uploadId) return err('missing uploadId', 400);
  if (!key || !BOOK_KEY_RE.test(key)) return err('invalid key', 400);
  if (!Array.isArray(parts) || parts.length === 0) return err('invalid parts', 400);
  for (const p of parts) {
    if (!p || !Number.isInteger(p.partNumber) || p.partNumber < 1 || typeof p.etag !== 'string' || !p.etag) {
      return err('invalid parts', 400);
    }
  }
  if (!sha256 || !SHA256_RE.test(sha256)) return err('invalid sha256', 400);

  const format = key.endsWith('.pdf') ? 'pdf' : 'epub';
  const title = (meta.title || '').trim();
  if (!title) return err('missing title', 400);
  const visibility = meta.visibility === 'public' ? 'public' : 'private';
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const pages = Number.isInteger(meta.pages) && meta.pages >= 0 ? meta.pages : 0;
  const inShelf = Number(meta.in_shelf) === 1 ? 1 : 0;

  // 防并发重复：sha256 唯一约束兜底
  const dup = await env.DB.prepare('SELECT id FROM books WHERE sha256=?1')
    .bind(sha256.toLowerCase())
    .first();
  if (dup) {
    try {
      await env.BOOKS.abortMultipartUpload(key, uploadId);
    } catch {
      // 忽略
    }
    return json({ exists: true, book: { id: dup.id } }, 409);
  }

  try {
    await env.BOOKS.completeMultipartUpload(
      key,
      uploadId,
      parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag }))
    );
  } catch (e) {
    return err('complete failed: ' + (e && e.message ? e.message : 'unknown'), 400);
  }
  const head = await env.BOOKS.head(key);
  if (!head) return err('upload not found after complete', 500);

  let cover_key = null;
  if (coverKey) {
    if (!COVER_KEY_RE.test(coverKey)) return err('invalid coverKey', 400);
    const coverObj = await env.BOOKS.head(coverKey);
    if (coverObj) cover_key = coverKey; // 封面不存在则置空，不阻塞入库
  }

  const id = key.slice('books/'.length, key.lastIndexOf('.')); // 复用 key 中的 uuid
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO books (id,title,author,lang,format,size,sha256,r2_key,cover_key,pages,tags,visibility,in_shelf,created_at,updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`
    )
      .bind(
        id,
        title,
        meta.author || '',
        meta.lang || '',
        format,
        head.size,
        sha256.toLowerCase(),
        key,
        cover_key,
        pages,
        JSON.stringify(tags),
        visibility,
        inShelf,
        now,
        now
      )
      .run();
  } catch (e) {
    return err('db insert failed: ' + (e && e.message ? e.message : 'unknown'), 500);
  }
  return json({ id });
}
