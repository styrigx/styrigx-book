// GET /api/file?id= — 公开图书文件（仅 visibility='public'），支持 Range
import { err, contentTypeForFormat, serveR2File, methodNotAllowed } from './_lib.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const id = new URL(context.request.url).searchParams.get('id');
  if (!id) return err('missing id', 400);

  const row = await context.env.DB.prepare(
    'SELECT id,format,r2_key,visibility FROM books WHERE id=?1'
  )
    .bind(id)
    .first();
  if (!row) return err('not found', 404);
  if (row.visibility !== 'public') return err('forbidden', 403);

  return serveR2File(
    context.env,
    row.r2_key,
    contentTypeForFormat(row.format),
    context.request.headers.get('Range')
  );
}
