// POST /api/admin/upload/part?uploadId=&key=&partNumber= — 上传一个分片，需 Access JWT
// body 为分片二进制（ArrayBuffer）。partNumber=1 时严格校验文件魔数：
// PDF 须为 %PDF，EPUB 须为 PK\x03\x04；不符 → 400 invalid-file-magic（附收到字节数）并 abort 整个上传。
// 空 body → 400 part-body-empty（会话保留，可重试，不 abort）。
// R2 uploadPart 抛错 → 500 part-r2-error（只打日志不进响应体），abort + 清理会话。
// 成功 → {etag}
// 2.10.2：顶层 try/catch —— 未捕获异常不再直接 500，
// 而是 abort multipart + 清理上传会话后返回短错误码（不暴露内部细节）。
// 鉴权/会话校验异常只返回 part-auth-error，不触发 abort（未鉴权时不得写操作）。
// abortAndClear 内部对 clearUploadSession 也包 try/catch，避免二次抛错。
// 日志：每个 catch 先 console.error 打出 [upload-part] e.name + e.message（不打 key 以外的
// 用户数据、不打密钥），再返回短错误码 —— 日志里必须有真实错误，否则线上 500 查不到根因。
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

/* 中止 multipart 上传并清理上传会话（自身不抛错，失败只打日志）。
   R2Bucket 绑定只有 createMultipartUpload / resumeMultipartUpload；
   uploadPart / abort / complete 是 R2MultipartUpload 对象的方法（S3 风格的
   bucket.uploadPart 等在绑定上不存在，调用会 TypeError）。 */
async function abortAndClear(env, key, uploadId) {
  try {
    await env.BOOKS.resumeMultipartUpload(key, uploadId).abort();
  } catch (e) {
    // abort 失败不影响主流程
    console.error('[upload-part]', 'abortMultipartUpload', e && e.name, e && e.message);
  }
  try {
    await clearUploadSession(env, uploadId);
  } catch (e) {
    // 清理失败不影响主流程（避免 catch 里再抛变回裸 500）
    console.error('[upload-part]', 'clearUploadSession', e && e.name, e && e.message);
  }
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

  // 鉴权与会话校验：异常只返回错误码，不触发 abort（未鉴权时不得写操作）
  let authed = false;
  try {
    const { response } = await requireOwner(context);
    if (response) return response;
    // 只验 owner + 上传会话（init 时已验过通行证；sgx-app 10 分钟过期不影响分片）
    const { response: sessResp } = await verifyUploadSession(context, uploadId, key);
    if (sessResp) return sessResp;
    authed = true;
  } catch (e) {
    // 日志保留真实错误（线上 500 排查用）；对外不暴露细节
    console.error('[upload-part]', e && e.name, e && e.message);
    return err('part-auth-error', 500);
  }

  try {
    if (!storageEnabled(env)) return storageDisabledResponse();

    const format = key.endsWith('.pdf') ? 'pdf' : 'epub';
    const buf = await request.arrayBuffer();
    /* 空 body：大概率网络/客户端异常，会话保留、可重试，不 abort */
    if (buf.byteLength === 0) {
      console.error('[upload-part]', 'part-body-empty', 'partNumber=' + partNumber);
      return err('part-body-empty', 400);
    }
    if (partNumber === 1 && !checkMagic(buf, format)) {
      await abortAndClear(env, key, uploadId);
      console.error('[upload-part]', 'invalid-file-magic', 'bytes=' + buf.byteLength, 'format=' + format);
      return json({ error: 'invalid-file-magic', detail: { bytes: buf.byteLength } }, 400);
    }

    let part;
    try {
      /* R2MultipartUpload 对象的方法，不是桶方法 */
      part = await env.BOOKS.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, buf);
    } catch (e) {
      /* R2 异常：日志保留真实错误（不进响应体），中止上传、清理会话 */
      console.error('[upload-part]', 'part-r2-error', e && e.name, e && e.message);
      if (authed) {
        await abortAndClear(env, key, uploadId);
      }
      return err('part-r2-error', 500);
    }
    return json({ etag: part.etag });
  } catch (e) {
    // 未捕获异常：日志保留真实错误，中止上传、清理会话，返回短错误码
    // 仅在鉴权通过后才会 abort，未鉴权时不写操作
    console.error('[upload-part]', e && e.name, e && e.message);
    if (authed) {
      await abortAndClear(env, key, uploadId);
    }
    return err('part-failed', 500);
  }
}
