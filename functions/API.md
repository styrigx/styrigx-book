# styrigx-book API

Cloudflare Pages Functions。全部 `export async function onRequest(context)` 风格，按 method 分流；
JSON 响应 `Content-Type: application/json`；错误格式 `{error:'...'}`；同源，不需要 CORS
（`/api/shelf*` 例外，见下）。所有 D1 时间戳为 `Date.now()` 毫秒。

## 绑定与环境变量（Cloudflare 后台配置）

| 类型 | 名称 | 说明 |
|---|---|---|
| R2 | `BOOKS` | bucket `styrigx-books`，不公开，全部经 Function 转发 |
| D1 | `DB` | 数据库 `styrigx-books`，建表见仓库根 `schema.sql`，增量迁移见 `migrations/`（`NNNN_*.sql`） |
| 变量 | `MAX_UPLOAD_MB` | 单文件上传上限（MB），默认 500 |
| 变量 | `STORAGE_ENABLED` | 严格为 `true` 且绑定了 `BOOKS` 时才启用存储 |
| 变量 | `SGX_SITE` | 固定 `book`，启用主站会话锁屏 |
| 变量 | `SGX_ED25519_PUBLIC` | Ed25519 公钥 PEM，用于验签主站 `sgx-verified` cookie |

鉴权（2.0）：`/api/admin/*` 与 `/api/private/*` 只认主站签发的四段式 `sgx-verified` cookie（`role.epoch.exp.sig`），用 `SGX_ED25519_PUBLIC` 验签；要求 `role=owner`。未登录或 role 不符一律 401。Cloudflare Access 已移除。

## 主站 Cookie 校验（`_auth.js`）

- 无 `sgx-verified` cookie 或验签失败 → 401 `{error:'unauthorized'}`。
- 只认四段式 `role.epoch.exp.sig`；role 必须为 `owner`（admin/private 接口）；exp 过期则无效。
- Ed25519 验签，签载荷为 `role.epoch.exp`。

## R2 key 规范

- 图书：`books/<uuid>.epub|pdf`（uuid = `crypto.randomUUID()`，服务端在 init 时生成）
- 封面：`covers/<uuid>.webp`（uuid 客户端生成，经 `covers/[a-f0-9-]+\.webp` 严格校验）

## 公开接口（无需 Access）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/books` | `visibility='public'` 的书 → `{books:[…]}` |
| GET | `/api/file?id=` | public 书的 R2 文件；支持 `Range: bytes=`（206 + Content-Range / Accept-Ranges，非法范围 416）；private → 403。Content-Type：epub `application/epub+zip`，pdf `application/pdf` |
| GET | `/api/cover?key=` | key 须匹配 `covers/[a-f0-9-]+\.webp` 且对应 public 书；否则 403 → `image/webp` |
| GET | `/api/shelf` | 主站书单：`in_shelf=1` 的书 → `{books:[{id,title,author,format,cover_url,added_at}]}`；public 书额外带 `read_url: https://book.styrigx.com/read/?id=<id>`，private 书**不带** read_url、不暴露任何文件地址。响应头 `Access-Control-Allow-Origin: https://styrigx.com`、`Cache-Control: public, max-age=300`；OPTIONS → 204（同样 CORS 头） |
| GET | `/api/shelf/cover/:id` | 书单封面：`id=:id AND in_shelf=1`（private 书封面的唯一公开出口，严格校验）；无封面/不存在 → 404 → `image/webp`。同样 CORS + `Cache-Control: public, max-age=300` |

Book 对象字段：`id,title,author,lang,format,size,sha256,cover_key,pages,tags(JSON 数组),visibility,in_shelf,created_at,updated_at`
（`r2_key` 内部字段不对外暴露）。

## 私有接口（需 Access JWT：`/api/private/*`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/private/me` | → `{email}`（JWT claims） |
| GET | `/api/private/books` | 全部书（含 private）→ `{books}` |
| GET | `/api/private/file?id=` | 按 id 取 R2（不查 visibility），Range 支持 |
| GET | `/api/private/cover?key=` | 按 key 取 R2 封面（只校验 key 格式）→ `image/webp` |
| GET | `/api/private/progress?book_id=` | → `{location,percent,updated_at}` 或 `{}` |
| PUT | `/api/private/progress` | body `{book_id,location,percent}` → upsert（percent 钳制 0–100；书不存在 → 404） |

## 管理接口（需 Access JWT：`/api/admin/*`）

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
