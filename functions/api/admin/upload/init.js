// POST /api/admin/upload/init — 初始化 R2 multipart 上传，需 Access JWT
// body: {filename,size,sha256,format}
// sha256 已存在 → 409 {exists:true, book:{id,title}}；否则 → {uploadId, key}
import { json, err, methodNotAllowed, BOOK_KEY_RE, storageEnabled, storageDisabledResponse } from '../../_lib.js';
import { requireOwner } from '../../_auth.js';

const SHA256_RE = /^[a-fA-F0-9]{64}$/;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const { response } = await requireOwner(context);
  if (response) return response;
  if (!storageEnabled(env)) return storageDisabledResponse();

  let body;
  try {
    body = await request.json();
  } catch {
    return err('invalid json', 400);
  }
  const { size, sha256, format } = body || {};
  if (format !== 'epub' && format !== 'pdf') return err('invalid format', 400);
  if (!Number.isInteger(size) || size <= 0) return err('invalid size', 400);
  const maxMB = parseInt(env.MAX_UPLOAD_MB || '500', 10);
  if (size > maxMB * 1024 * 1024) return err(`file too large (max ${maxMB}MB)`, 413);
  if (!sha256 || !SHA256_RE.test(sha256)) return err('invalid sha256', 400);

  const dup = await env.DB.prepare('SELECT id,title FROM books WHERE sha256=?1')
    .bind(sha256.toLowerCase())
    .first();
  if (dup) return json({ exists: true, book: { id: dup.id, title: dup.title } }, 409);

  const key = `books/${crypto.randomUUID()}.${format}`;
  if (!BOOK_KEY_RE.test(key)) return err('internal key error', 500); // 不应发生
  const mpu = await env.BOOKS.createMultipartUpload(key);
  return json({ uploadId: mpu.uploadId, key: mpu.key });
}
