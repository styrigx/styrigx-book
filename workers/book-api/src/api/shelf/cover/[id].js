// GET /api/shelf/cover/:id — 书单封面（公开，无需 Access）
// 这是 private 书封面的唯一公开出口：必须严格校验 in_shelf=1。
// 查不到 / 无封面 → 404。CORS 仅允许 https://styrigx.com；Cache-Control: public, max-age=300。
import { err, methodNotAllowed, storageEnabled } from '../../_lib.js';

const CORS_ORIGIN = 'https://styrigx.com';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'public, max-age=300',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'GET') return methodNotAllowed('GET, OPTIONS');

  const id = context.params.id;
  if (!id) return err('not found', 404);

  const row = await env.DB.prepare(
    'SELECT cover_key FROM books WHERE id=?1 AND in_shelf=1 LIMIT 1'
  )
    .bind(id)
    .first();
  if (!row || !row.cover_key) return err('not found', 404);

  // 存储未启用时直接 404（优雅降级）
  if (!storageEnabled(env)) return err('not found', 404);

  const obj = await env.BOOKS.get(row.cover_key);
  if (!obj) return err('not found', 404);

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(obj.size),
      ...corsHeaders(),
    },
  });
}
