// POST /api/admin/upload/abort — 取消 multipart 上传，需 Access JWT
// body: {uploadId, key} → {ok:true}（幂等：上传已不存在也视为成功）
// 2.10.2：顶层 try/catch —— 未捕获异常返回短错误码 abort-failed（不暴露内部细节）。
// 日志：每个 catch 先 console.error 打出 [upload-abort] e.name + e.message，再返回短错误码。
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
      /* abort 是 R2MultipartUpload 对象的方法（见 part.js 注释） */
      await env.BOOKS.resumeMultipartUpload(key, uploadId).abort();
    } catch (e) {
      // 幂等：上传不存在也视为成功；日志保留真实错误
      console.error('[upload-abort]', 'abortMultipartUpload', e && e.name, e && e.message);
    }
    await clearUploadSession(env, uploadId);
    return json({ ok: true });
  } catch (e) {
    console.error('[upload-abort]', e && e.name, e && e.message);
    return err('abort-failed', 500);
  }
}
