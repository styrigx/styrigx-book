// GET /api/private/cover?key= — 按 key 取 R2 封面（只校验 key 格式），需 Access JWT
import { err, serveR2File, methodNotAllowed, COVER_KEY_RE } from '../_lib.js';
import { requireOwner } from '../_auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const { response } = await requireOwner(context);
  if (response) return response;

  const key = new URL(context.request.url).searchParams.get('key');
  if (!key || !COVER_KEY_RE.test(key)) return err('invalid key', 400);

  return serveR2File(context.env, key, 'image/webp', context.request.headers.get('Range'));
}
