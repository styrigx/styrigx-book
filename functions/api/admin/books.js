// GET /api/admin/books — 全部图书 + 统计，需 Access JWT
// → {books, total, bytes}（bytes = SUM(size)）
import { json, rowToBook, methodNotAllowed } from '../_lib.js';
import { requireAccess } from '../_access.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const { response } = await requireAccess(context);
  if (response) return response;

  const { results } = await env.DB.prepare(
    'SELECT id,title,author,lang,format,size,sha256,cover_key,pages,tags,visibility,in_shelf,created_at,updated_at FROM books ORDER BY created_at DESC'
  ).all();
  const agg = await env.DB.prepare(
    'SELECT COUNT(*) AS total, COALESCE(SUM(size),0) AS bytes FROM books'
  ).first();
  return json({
    books: (results || []).map(rowToBook),
    total: agg ? agg.total : 0,
    bytes: agg ? agg.bytes : 0,
  });
}
