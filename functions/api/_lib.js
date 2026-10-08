// functions/api/_lib.js
// 共享工具：JSON 响应、book 行映射、Range 解析、R2 文件服务、key 格式校验。
// 下划线开头的文件不会被 Pages 当作路由，只供其它 Function import。

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export function err(error, status = 400) {
  return json({ error }, status);
}

export function methodNotAllowed(allowed) {
  return json({ error: 'method not allowed' }, 405, { Allow: allowed });
}

export function safeParseTags(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// D1 行 → 对外 book 对象（不暴露内部 r2_key）
export function rowToBook(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? '',
    lang: row.lang ?? '',
    format: row.format,
    size: row.size,
    sha256: row.sha256,
    cover_key: row.cover_key ?? null,
    pages: row.pages ?? 0,
    tags: safeParseTags(row.tags),
    visibility: row.visibility,
    in_shelf: row.in_shelf ? 1 : 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// R2 key 规范
export const BOOK_KEY_RE =
  /^books\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(epub|pdf)$/;
export const COVER_KEY_RE = /^covers\/[a-f0-9-]+\.webp$/;

/* ===== 存储开关 =====
 * STORAGE_ENABLED 环境变量控制 R2 存储是否启用。
 * 未启用（false/未设置）或 BOOKS 绑定缺失时，所有文件读写走优雅降级：
 * - 上传/写入类接口返回 503
 * - 读取类接口返回 404（就当文件不存在）
 * - 删除接口只删 D1 记录，跳过 R2
 * 以后开通 R2 后：建 bucket、Pages 绑定 BOOKS、把 STORAGE_ENABLED 改成 true 即可，无需改代码。
 */
export function storageEnabled(env) {
  return env.STORAGE_ENABLED === 'true' && !!env.BOOKS;
}

export function storageDisabledResponse() {
  return err('storage not enabled', 503);
}

export function contentTypeForFormat(format) {
  return format === 'pdf' ? 'application/pdf' : 'application/epub+zip';
}

// 解析 Range 头。
// 返回 {start,end} | 'unsatisfiable'（416 用） | null（无头或格式不合法 → 按普通 200 处理）
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, s, e] = m;
  if (s === '' && e === '') return null;
  let start;
  let end;
  if (s === '') {
    // bytes=-N：最后 N 个字节
    const tail = parseInt(e, 10);
    if (!Number.isFinite(tail) || tail <= 0) return null;
    start = Math.max(0, size - tail);
    end = size - 1;
  } else {
    start = parseInt(s, 10);
    end = e === '' ? size - 1 : parseInt(e, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start >= size || start > end) return 'unsatisfiable';
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

// 从 R2 取文件并返回，支持 Range（206 + Content-Range / Accept-Ranges，非法范围 416）
// 存储未启用时返回 404（优雅降级，不报错）
export async function serveR2File(env, r2Key, contentType, rangeHeader) {
  if (!storageEnabled(env)) return err('not found', 404);
  const meta = await env.BOOKS.head(r2Key);
  if (!meta) return err('not found', 404);
  const size = meta.size;
  const range = parseRange(rangeHeader, size);

  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${size}` },
    });
  }

  if (range) {
    const { start, end } = range;
    const obj = await env.BOOKS.get(r2Key, {
      range: { offset: start, length: end - start + 1 },
    });
    if (!obj) return err('not found', 404);
    return new Response(obj.body, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Disposition': 'inline',
      },
    });
  }

  const obj = await env.BOOKS.get(r2Key);
  if (!obj) return err('not found', 404);
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
    },
  });
}
