// GET /api/private/file?id= — 按 id 取 R2 文件（不查 visibility），支持 Range，需 Access JWT
import { err, contentTypeForFormat, serveR2File, methodNotAllowed } from '../_lib.js';
import { requireOwner } from '../_auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const { response } = await requireOwner(context);
  if (response) return response;

  const id = new URL(context.request.url).searchParams.get('id');
  if (!id) return err('missing id', 400);

  const row = await context.env.DB.prepare(
    'SELECT id,format,r2_key FROM books WHERE id=?1'
  )
    .bind(id)
    .first();
  if (!row) return err('not found', 404);

  return serveR2File(
    context.env,
    row.r2_key,
    contentTypeForFormat(row.format),
    context.request.headers.get('Range')
  );
}
