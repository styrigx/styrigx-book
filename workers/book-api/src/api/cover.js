// GET /api/cover?key= — 公开封面（key 须为 covers/<uuid>.webp，且对应 public 图书）
import { err, serveR2File, methodNotAllowed, COVER_KEY_RE } from './_lib.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const key = new URL(context.request.url).searchParams.get('key');
  if (!key || !COVER_KEY_RE.test(key)) return err('forbidden', 403);

  const row = await context.env.DB.prepare(
    "SELECT cover_key FROM books WHERE cover_key=?1 AND visibility='public' LIMIT 1"
  )
    .bind(key)
    .first();
  if (!row) return err('forbidden', 403);

  return serveR2File(context.env, key, 'image/webp', context.request.headers.get('Range'));
}
