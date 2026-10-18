// /api/private/progress — 阅读进度，需 Access JWT
// GET ?book_id= → {location,percent,updated_at} 或 {}
// PUT body {book_id,location,percent} → upsert
import { json, err, methodNotAllowed } from '../_lib.js';
import { requireOwner } from '../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return methodNotAllowed('GET, PUT');
  }
  const { response } = await requireOwner(context);
  if (response) return response;

  if (request.method === 'GET') {
    const sp = new URL(request.url).searchParams;
    const bookId = sp.get('book_id') || sp.get('id');
    if (!bookId) return err('missing book_id', 400);
    const row = await env.DB.prepare(
      'SELECT location,percent,updated_at FROM progress WHERE book_id=?1'
    )
      .bind(bookId)
      .first();
    if (!row) return json({});
    return json({
      location: row.location ?? '',
      percent: row.percent ?? 0,
      updated_at: row.updated_at,
    });
  }

  // PUT
  let body;
  try {
    body = await request.json();
  } catch {
    return err('invalid json', 400);
  }
  const { book_id, id: idAlias, location = '', percent = 0 } = body || {};
  const book_id_final = book_id || idAlias;
  if (!book_id_final) return err('missing book_id', 400);

  const book = await env.DB.prepare('SELECT id FROM books WHERE id=?1').bind(book_id_final).first();
  if (!book) return err('book not found', 404);

  const p = Math.min(100, Math.max(0, Number(percent) || 0));
  const loc = String(location ?? '');
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO progress (book_id, location, percent, updated_at) VALUES (?1,?2,?3,?4)
     ON CONFLICT(book_id) DO UPDATE SET location=excluded.location, percent=excluded.percent, updated_at=excluded.updated_at`
  )
    .bind(book_id_final, loc, p, now)
    .run();
  return json({ ok: true, book_id: book_id_final, location: loc, percent: p, updated_at: now });
}
