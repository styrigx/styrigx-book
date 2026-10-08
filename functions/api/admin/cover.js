// POST /api/admin/cover?key= — 上传封面（webp 二进制），需 Access JWT
// key 格式：covers/<uuid>.webp；校验前 12 字节 RIFF....WEBP。成功 → {key}
import { json, err, methodNotAllowed, COVER_KEY_RE } from '../_lib.js';
import { requireAccess } from '../_access.js';

function isWebp(buf) {
  if (buf.byteLength < 12) return false;
  const b = new Uint8Array(buf.slice(0, 12));
  return (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const { response } = await requireAccess(context);
  if (response) return response;

  const key = new URL(request.url).searchParams.get('key');
  if (!key || !COVER_KEY_RE.test(key)) return err('invalid key', 400);

  const buf = await request.arrayBuffer();
  if (!isWebp(buf)) return err('invalid webp', 400);

  await env.BOOKS.put(key, buf, { httpMetadata: { contentType: 'image/webp' } });
  return json({ key });
}
