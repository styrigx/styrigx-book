// functions/api/admin/upload/_sessions.js
// 上传会话（book 上传入口）：init 成功后记录 uploadId，绑定创建时的 sgx-app epoch。
// part / complete / abort 只验 owner + 会话，不再要求当次 sgx-app 有效——
// sgx-app 只有 10 分钟，大文件/慢网速下分片中途会过期，会话机制避免传一半 403。
// 校验：会话存在、uploadId 与 r2_key 绑定一致、未超过 2 小时、epoch 未变，否则 403。
// DB 异常一律 fail closed（403）。下划线开头，不会被 Pages 当作路由。

import { err } from '../../_lib.js';
import { fetchSessionEpoch } from '../../../_sgx-cookie.js';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时

export async function recordUploadSession(env, uploadId, r2Key, appEpoch) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO upload_sessions (upload_id, r2_key, app_epoch, created_at) VALUES (?1, ?2, ?3, ?4)'
  )
    .bind(uploadId, r2Key, appEpoch, Date.now())
    .run();
}

export async function clearUploadSession(env, uploadId) {
  try {
    await env.DB.prepare('DELETE FROM upload_sessions WHERE upload_id=?1').bind(uploadId).run();
  } catch {
    // 清理失败不影响主流程
  }
}

/**
 * 校验上传会话。返回 { ok:true } 或 { response }（403）。
 * - 会话不存在 / uploadId 与 key 不匹配 → 403 upload-session-invalid
 * - 超过 2 小时 → 403 upload-session-expired（并清理）
 * - 主站 epoch 拿不到或与建会话时不一致 → 403 upload-session-invalid（fail closed）
 */
export async function verifyUploadSession(context, uploadId, r2Key) {
  const { env } = context;
  let row = null;
  try {
    row = await env.DB.prepare(
      'SELECT r2_key, app_epoch, created_at FROM upload_sessions WHERE upload_id=?1'
    )
      .bind(uploadId)
      .first();
  } catch {
    return { response: err('upload-session-invalid', 403) };
  }
  if (!row || row.r2_key !== r2Key) {
    return { response: err('upload-session-invalid', 403) };
  }
  if (Date.now() - row.created_at > SESSION_TTL_MS) {
    await clearUploadSession(env, uploadId);
    return { response: err('upload-session-expired', 403) };
  }
  const latestEpoch = await fetchSessionEpoch();
  if (latestEpoch === null || latestEpoch === undefined || latestEpoch !== row.app_epoch) {
    return { response: err('upload-session-invalid', 403) };
  }
  return { ok: true };
}
