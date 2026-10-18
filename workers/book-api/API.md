# styrigx-book API

Worker `styrigx-book-api`（路由 `book.styrigx.com/api/*`）。接口文件仍是 `export async function onRequest(context)` 风格，按 method 分流，由 `src/index.js` 按 `src/routes.js` 分发；
JSON 响应 `Content-Type: application/json`；错误格式 `{error:'...'}`；同源，不需要 CORS
（`/api/shelf*` 例外，见下）。所有 D1 时间戳为 `Date.now()` 毫秒。

## 绑定与变量（写在 `wrangler.toml`，CI 部署）

| 类型 | 名称 | 说明 |
|---|---|---|
| R2 | `BOOKS` | bucket `styrigx-books`，不公开，全部经本 Worker 转发 |
| D1 | `DB` | 数据库 `styrigx-books`，建表见本目录 `schema.sql`，增量迁移见 `migrations/`（`NNNN_*.sql`） |
| 变量 | `MAX_UPLOAD_MB` | 单文件上传上限（MB），默认 500 |
| 变量 | `STORAGE_ENABLED` | 严格为 `true` 且绑定了 `BOOKS` 时才启用存储 |
| 服务绑定 | `AUTH` | 主站鉴权网关 `styrigx-auth-gateway` 的 RPC 入口 `SessionVerifier`（验会话、验应用通行证、取应用纪元） |

鉴权：本 Worker 不持任何钥匙。除 `/api/shelf*` 外，所有接口先把请求的 Cookie 头交给网关验 `sgx-verified` 会话（owner、visitor 均可），无效 401；`/api/admin/*` 与 `/api/private/*` 再要求 `role=owner`（visitor 403）；上传、删除、换封面还要网关验 `sgx-app` 通行证（aud=book、scope=upload）。网关出错 → 500（不回 401，免得前端当成已锁定）。

## 鉴权（`src/api/_auth.js`）

- `requireOwner`：网关回 owner 放行；visitor → 403 `{error:'forbidden'}`；无效 → 401 `{error:'unauthorized'}`。
- `requireAppToken`：网关验 `sgx-app`；缺 → 403 `app-token-required`，无效 → 403 `app-token-invalid`；成功带 `appEpoch`（上传会话绑定）。
- `currentAppEpoch`：上传中途核对应用纪元（删过 book 的应用通行密钥后加一，进行中的上传作废）。
- 验签细则（五段式会话、八段式通行证、epoch）在网关，见 styrigx-space 仓库 `workers/auth-gateway/src/verifier.js`。

## R2 key 规范

- 图书：`books/<uuid>.epub|pdf`（uuid = `crypto.randomUUID()`，服务端在 init 时生成）
- 封面：`covers/<uuid>.webp`（uuid 客户端生成，经 `covers/[a-f0-9-]+\.webp` 严格校验）

## 接口（除 `/api/shelf*` 外都要有效会话）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/books` | `visibility='public'` 的书 → `{books:[…]}` |
| GET | `/api/file?id=` | public 书的 R2 文件；支持 `Range: bytes=`（206 + Content-Range / Accept-Ranges，非法范围 416）；private → 403。Content-Type：epub `application/epub+zip`，pdf `application/pdf` |
| GET | `/api/cover?key=` | key 须匹配 `covers/[a-f0-9-]+\.webp` 且对应 public 书；否则 403 → `image/webp` |
| GET | `/api/shelf` | 主站书单：`in_shelf=1` 的书 → `{books:[{id,title,author,format,cover_url,added_at}]}`；public 书额外带 `read_url: https://book.styrigx.com/read/?id=<id>`，private 书**不带** read_url、不暴露任何文件地址。响应头 `Access-Control-Allow-Origin: https://styrigx.com`、`Cache-Control: public, max-age=300`；OPTIONS → 204（同样 CORS 头） |
| GET | `/api/shelf/cover/:id` | 书单封面：`id=:id AND in_shelf=1`（private 书封面的唯一公开出口，严格校验）；无封面/不存在 → 404 → `image/webp`。同样 CORS + `Cache-Control: public, max-age=300` |
| GET | `/api/session-check` | 锁屏会话确认：由主站鉴权网关直接回答（网关登记了更精确的路由），会话有效 → 200 `{ok:true}`，否则 401；`Cache-Control: private, no-store`。供前端切回标签页 / bfcache 恢复时确认会话 |

Book 对象字段：`id,title,author,lang,format,size,sha256,cover_key,pages,tags(JSON 数组),visibility,in_shelf,created_at,updated_at`
（`r2_key` 内部字段不对外暴露）。

## 私有接口（owner 会话：`/api/private/*`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/private/me` | → `{email}`（JWT claims） |
| GET | `/api/private/books` | 全部书（含 private）→ `{books}` |
| GET | `/api/private/file?id=` | 按 id 取 R2（不查 visibility），Range 支持 |
| GET | `/api/private/cover?key=` | 按 key 取 R2 封面（只校验 key 格式）→ `image/webp` |
| GET | `/api/private/progress?book_id=` | → `{location,percent,updated_at}` 或 `{}` |
| PUT | `/api/private/progress` | body `{book_id,location,percent}` → upsert（percent 钳制 0–100；书不存在 → 404） |

## 管理接口（owner 会话：`/api/admin/*`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/upload/init` | body `{filename,size,sha256,format}`；format∈{epub,pdf}，size ≤ MAX_UPLOAD_MB；sha256 已存在 → 409 `{exists:true, book:{id,title}}`；否则 `{uploadId, key}` |
| POST | `/api/admin/upload/part?uploadId=&key=&partNumber=` | body 为分片 ArrayBuffer → `{etag}`。partNumber=1 时严格校验魔数：PDF 须 `%PDF`，EPUB 须 `PK\x03\x04`，否则 400 并 abort |
| POST | `/api/admin/upload/complete` | body `{uploadId,key,parts:[{partNumber,etag}],sha256,meta:{title,author,lang,pages,tags,visibility,in_shelf},coverKey}` → completeMultipartUpload → D1 插入 → `{id}`。sha256 必填（列 NOT NULL+UNIQUE）；`in_shelf` 0/1，默认 0；coverKey 不存在则置空 |
| POST | `/api/admin/upload/abort` | body `{uploadId,key}` → abort → `{ok:true}`（幂等） |
| POST | `/api/admin/cover?key=` | body 为 webp 二进制（校验前 12 字节 `RIFF....WEBP`）→ R2 put → `{key}` |
| GET | `/api/admin/books` | 全部书 + `{total, bytes}`（bytes = SUM(size)） |
| PUT | `/api/admin/book?id=` | body `{title,author,lang,tags,visibility,coverKey?,in_shelf?}`（in_shelf 须 0/1）→ `{ok:true}`；书不存在 → 404 |
| DELETE | `/api/admin/book?id=` | 删除 R2 文件+封面、D1 books+progress → `{ok:true}` |

## D1 schema 要点

- `books.sha256` UNIQUE（秒传/去重）；`visibility` CHECK 约束 private/public；
  `in_shelf INTEGER DEFAULT 0`（主站书单开关，`migrations/0002_in_shelf.sql`）。
- `progress.book_id` 主键，`INSERT … ON CONFLICT(book_id) DO UPDATE` 做 upsert。
