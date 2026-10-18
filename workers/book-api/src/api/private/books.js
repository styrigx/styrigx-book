// GET /api/private/books — 全部图书（含 private），需 Access JWT
// 3.0：LEFT JOIN progress，每本多返回 percent（0–100，未读过为 null）与
// progress_updated_at（ms 时间戳，未读过为 null）。角标 / 最近阅读 /
// 最近阅读排序 / 阅读状态筛选 / 继续阅读 FAB 全用这一次请求，不逐本查进度。
// 已读判定：percent >= 99（EPUB 末页 fraction 极少恰好 100，99 起算已读；PDF 末页为 100）。
import { json, rowToBook, methodNotAllowed } from '../_lib.js';
import { requireOwner } from '../_auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  const { response } = await requireOwner(context);
  if (response) return response;

  const { results } = await context.env.DB.prepare(
    `SELECT b.id,b.title,b.author,b.lang,b.format,b.size,b.sha256,b.cover_key,b.pages,b.tags,
      b.visibility,b.in_shelf,b.created_at,b.updated_at,
      p.percent AS percent, p.updated_at AS progress_updated_at
     FROM books b LEFT JOIN progress p ON p.book_id = b.id ORDER BY b.created_at DESC`
  ).all();
  return json({ books: (results || []).map(rowToBook) });
}
