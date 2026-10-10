// /api/admin/book?id= — 单书管理，需 Access JWT
// PUT body {title,author,lang,tags,visibility,coverKey?,in_shelf?} → 更新元数据 → {ok:true}
// DELETE → 删除 R2 文件+封面、D1 books+progress → {ok:true}
import { json, err, methodNotAllowed, COVER_KEY_RE, storageEnabled } from '../_lib.js';
import { requireOwner } from '../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'PUT' && request.method !== 'DELETE') {
    return methodNotAllowed('PUT, DELETE');
  }
  const { response } = await requireOwner(context);
  if (response) return response;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return err('missing id', 400);

  if (request.method === 'PUT') {
    let body;
    try {
      body = await request.json();
    } catch {
      return err('invalid json', 400);
    }
    const { title, author, lang, tags, visibility, coverKey, in_shelf } = body || {};
    const sets = [];
    const vals = [];
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) return err('invalid title', 400);
      sets.push('title=?');
      vals.push(title.trim());
    }
    if (author !== undefined) {
      sets.push('author=?');
      vals.push(String(author ?? ''));
    }
    if (lang !== undefined) {
      sets.push('lang=?');
      vals.push(String(lang ?? ''));
    }
    if (tags !== undefined) {
      if (!Array.isArray(tags)) return err('invalid tags', 400);
      sets.push('tags=?');
      vals.push(JSON.stringify(tags));
    }
    if (visibility !== undefined) {
      if (visibility !== 'private' && visibility !== 'public') return err('invalid visibility', 400);
      sets.push('visibility=?');
      vals.push(visibility);
    }
    if (coverKey !== undefined) {
      if (coverKey !== null && !COVER_KEY_RE.test(coverKey)) return err('invalid coverKey', 400);
      sets.push('cover_key=?');
      vals.push(coverKey);
    }
    if (in_shelf !== undefined) {
      if (Number(in_shelf) !== 0 && Number(in_shelf) !== 1) return err('invalid in_shelf', 400);
      sets.push('in_shelf=?');
      vals.push(Number(in_shelf));
    }
    if (!sets.length) return err('nothing to update', 400);
    sets.push('updated_at=?');
    vals.push(Date.now());
    vals.push(id);
    // 列名全部为硬编码字符串，无注入风险
    const r = await env.DB.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id=?`)
      .bind(...vals)
      .run();
    if (!r.meta || r.meta.changes === 0) return err('not found', 404);
    return json({ ok: true });
  }

  // DELETE
  const row = await env.DB.prepare('SELECT r2_key, cover_key FROM books WHERE id=?1')
    .bind(id)
    .first();
  if (!row) return err('not found', 404);
  // 存储启用时才删 R2 文件；未启用时只删 D1 记录
  if (storageEnabled(env)) {
    const keys = [row.r2_key, row.cover_key].filter(Boolean);
    if (keys.length) await env.BOOKS.delete(keys);
  }
  await env.DB.prepare('DELETE FROM books WHERE id=?1').bind(id).run();
  await env.DB.prepare('DELETE FROM progress WHERE book_id=?1').bind(id).run();
  return json({ ok: true });
}
