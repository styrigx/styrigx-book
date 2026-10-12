// POST /api/admin/upload/abort — 取消 multipart 上传，需 Access JWT
// body: {uploadId, key} → {ok:true}（幂等：上传已不存在也视为成功）
// 2.10.2：顶层 try/catch —— 未捕获异常返回短错误码 abort-failed（不暴露内部细节）。
import { json, err, methodNotAllowed, BOOK_KEY_RE, storageEnabled, storageDisabledResponse } from '../../_lib.js';
import { requireOwner } from '../../_auth.js';
import { verifyUploadSession, clearUploadSession } from './_sessions.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return methodNotAllowed('POST');
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
    const { response } = await requireOwner(context);
    if (response) return response;
    // 只验 owner + 上传会话（init 时已验过通行证）
    const { response: sessResp } = await verifyUploadSession(context, uploadId, key);
    if (sessResp) return sessResp;
    if (!storageEnabled(env)) return storageDisabledResponse();

    try {
      await env.BOOKS.abortMultipartUpload(key, uploadId);
    } catch {
      // 幂等：上传不存在也视为成功
    }
    await clearUploadSession(env, uploadId);
    return json({ ok: true });
  } catch {
    return err('abort-failed', 500);
  }
}
