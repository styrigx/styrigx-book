// GET /api/private/books — 全部图书（含 private），需 Access JWT
import { json, rowToBook, methodNotAllowed } from '../_lib.js';
import { requireAccess } from '../_access.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const { response } = await requireAccess(context);
  if (response) return response;

  const { results } = await context.env.DB.prepare(
    'SELECT id,title,author,lang,format,size,sha256,cover_key,pages,tags,visibility,in_shelf,created_at,updated_at FROM books ORDER BY created_at DESC'
  ).all();
  return json({ books: (results || []).map(rowToBook) });
}
