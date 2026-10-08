// GET /api/books — 公开书单（visibility='public'）
import { json, rowToBook, methodNotAllowed } from './_lib.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const { results } = await context.env.DB.prepare(
    "SELECT id,title,author,lang,format,size,sha256,cover_key,pages,tags,visibility,in_shelf,created_at,updated_at FROM books WHERE visibility='public' ORDER BY created_at DESC"
  ).all();
  return json({ books: (results || []).map(rowToBook) });
}
