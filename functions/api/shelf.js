// GET /api/shelf — 主站书单（公开，无需 Access）
// 返回 in_shelf=1 的书：{id,title,author,format,cover_url,added_at}；
// visibility=public 的书额外带 read_url，private 的书不带 read_url、不暴露任何文件地址。
// CORS 仅允许 https://styrigx.com；Cache-Control: public, max-age=300。
import { json, methodNotAllowed } from './_lib.js';

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

  const { results } = await env.DB.prepare(
    'SELECT id,title,author,format,visibility,created_at FROM books WHERE in_shelf=1 ORDER BY created_at DESC'
  ).all();

  const books = (results || []).map((row) => {
    const book = {
      id: row.id,
      title: row.title,
      author: row.author ?? '',
      format: row.format,
      cover_url: `/api/shelf/cover/${row.id}`,
      added_at: row.created_at,
    };
    // 只有 public 书给阅读链接；private 书不暴露任何文件地址
    if (row.visibility === 'public') {
      book.read_url = `https://book.styrigx.com/read/?id=${row.id}`;
    }
    return book;
  });

  return json({ books }, 200, corsHeaders());
}
