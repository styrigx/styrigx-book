// POST /api/admin/upload/abort — 取消 multipart 上传，需 Access JWT
// body: {uploadId, key} → {ok:true}（幂等：上传已不存在也视为成功）
import { json, err, methodNotAllowed, BOOK_KEY_RE, storageEnabled, storageDisabledResponse } from '../../_lib.js';
import { requireAccess } from '../../_access.js';

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
  const { uploadId, key } = body || {};
  if (!uploadId) return err('missing uploadId', 400);
  if (!key || !BOOK_KEY_RE.test(key)) return err('invalid key', 400);

  try {
    await env.BOOKS.abortMultipartUpload(key, uploadId);
  } catch {
    // 幂等：上传不存在也视为成功
  }
  return json({ ok: true });
}
