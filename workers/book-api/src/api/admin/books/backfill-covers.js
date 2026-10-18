// POST /api/admin/books/backfill-covers — 补齐已上传图书的 cover_key，需 Access JWT + app 令牌
// 背景：旧客户端把 coverKey 放在 meta 里，complete 只读顶层，导致 cover_key 入库为 NULL，
// 而封面文件已写入 R2 的 covers/<id>.webp。本接口对 cover_key 为空的书 head R2，存在则写回。
// 只改 cover_key 这一列，不补 pages，不动其它字段。
// 成功 → {checked, fixed}（checked=扫描的空封面书数，fixed=补上的本数）
import { json, err, methodNotAllowed, storageEnabled, storageDisabledResponse } from '../../_lib.js';
import { requireOwner, requireAppToken } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const { response } = await requireOwner(context);
  if (response) return response;
  const { response: appResp } = await requireAppToken(context);
  if (appResp) return appResp;
  if (!storageEnabled(env)) return storageDisabledResponse();

  const { results } = await env.DB.prepare(
    'SELECT id, cover_key FROM books WHERE cover_key IS NULL OR cover_key = ?1 ORDER BY created_at ASC'
  ).bind('').all();
  const rows = results || [];
  let fixed = 0;
  for (const row of rows) {
    const coverKey = `covers/${row.id}.webp`;
    const obj = await env.BOOKS.head(coverKey);
    if (!obj) continue;
    // 只改 cover_key 这一列
    const r = await env.DB.prepare('UPDATE books SET cover_key=?1 WHERE id=?2 AND (cover_key IS NULL OR cover_key=?3)')
      .bind(coverKey, row.id, '')
      .run();
    if (r.meta && r.meta.changes > 0) fixed++;
  }
  return json({ checked: rows.length, fixed });
}
