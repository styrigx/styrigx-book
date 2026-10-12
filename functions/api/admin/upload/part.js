// POST /api/admin/upload/part?uploadId=&key=&partNumber= — 上传一个分片，需 Access JWT
// body 为分片二进制（ArrayBuffer）。partNumber=1 时严格校验文件魔数：
// PDF 须为 %PDF，EPUB 须为 PK\x03\x04；不符 → 400 并 abort 整个上传。
// 成功 → {etag}
// 2.10.2：顶层 try/catch —— R2 uploadPart 等未捕获异常不再直接 500，
// 而是 abort multipart + 清理上传会话后返回短错误码 part-failed（不暴露内部细节）。
import { json, err, methodNotAllowed, BOOK_KEY_RE, storageEnabled, storageDisabledResponse } from '../../_lib.js';
import { requireOwner } from '../../_auth.js';
import { verifyUploadSession, clearUploadSession } from './_sessions.js';

function checkMagic(buf, format) {
  if (buf.byteLength < 4) return false;
  const b = new Uint8Array(buf.slice(0, 4));
  if (format === 'pdf') {
    return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
  }
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04; // PK\x03\x04
}

/* 中止 multipart 上传并清理上传会话（自身不抛错）。 */
async function abortAndClear(env, key, uploadId) {
  try {
    await env.BOOKS.abortMultipartUpload(key, uploadId);
  } catch {
    // abort 失败不影响主流程
  }
  await clearUploadSession(env, uploadId);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const q = new URL(request.url).searchParams;
  const uploadId = q.get('uploadId');
  const key = q.get('key');
  const partNumber = parseInt(q.get('partNumber') || '', 10);
  if (!uploadId) return err('missing uploadId', 400);
  if (!key || !BOOK_KEY_RE.test(key)) return err('invalid key', 400);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return err('invalid partNumber', 400);
  }

  try {
    const { response } = await requireOwner(context);
    if (response) return response;
    // 只验 owner + 上传会话（init 时已验过通行证；sgx-app 10 分钟过期不影响分片）
    const { response: sessResp } = await verifyUploadSession(context, uploadId, key);
    if (sessResp) return sessResp;
    if (!storageEnabled(env)) return storageDisabledResponse();

    const format = key.endsWith('.pdf') ? 'pdf' : 'epub';
    const buf = await request.arrayBuffer();
    if (partNumber === 1 && !checkMagic(buf, format)) {
      await abortAndClear(env, key, uploadId);
      return err('invalid file magic', 400);
    }

    const part = await env.BOOKS.uploadPart(key, uploadId, partNumber, buf);
    return json({ etag: part.etag });
  } catch {
    // 未捕获异常（如 R2 uploadPart 抛错）：中止上传、清理会话，返回短错误码
    await abortAndClear(env, key, uploadId);
    return err('part-failed', 500);
  }
}
