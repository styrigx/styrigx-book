# 仓库结构

按用途分层，根目录只放入口文件和顶层目录（与 styrigx-space 同一套约定）。改一处不牵连别处：改页面只动 `web/`，改接口只动 `workers/book-api/`。

## 根目录

```
styrigx-book/
├─ web/
├─ workers/
├─ tests/
├─ scripts/
├─ .github/
├─ README.md
├─ README.en.md
├─ STRUCTURE.md
├─ LICENSE
├─ package.json
├─ package-lock.json
└─ .gitignore
```

| 位置 | 是什么 |
|---|---|
| `web/` | 网站本体（Hugo 项目），由 Cloudflare Pages 发布（只放静态文件） |
| `workers/` | Cloudflare Worker，一个 Worker 一个目录 |
| `tests/` | 全部测试，按测试对象分目录 |
| `scripts/` | 构建脚本（`vendor.mjs` 同步第三方阅读器库） |
| `.github/` | CI 工作流 |
| `package.json` `package-lock.json` | npm 依赖（npm 只认根目录） |

## web/ 网站

```
web/
├─ hugo.yaml
├─ wrangler.toml
├─ tailwind.config.js
├─ postcss.config.js
├─ content/
├─ layouts/
├─ assets/
├─ static/
└─ public/
```

| 位置 | 是什么 |
|---|---|
| `hugo.yaml` | Hugo 配置（`params.version` 是书库版本号，README 徽章读它） |
| `wrangler.toml` | Pages 项目 `styrigx-book` 的配置：不带任何变量、钥匙和绑定。在 `web/` 下执行 `wrangler pages deploy public` |
| `tailwind.config.js` | Tailwind 配置（路径相对本文件）；`npm run build:css` 生成 `assets/css/main.css` |
| `content/` | 页面入口，中英双语（`content/en/`） |
| `layouts/` | 模板：书架首页、阅读器 `/read/`、上传页 `/admin/` |
| `assets/` | Tailwind 输入样式和前端 JS（Hugo Pipes 压缩 + 指纹） |
| `static/` | 原样复制：字体、`js/vendor/`（foliate-js、pdf.js）、`_headers`、`_redirects`、`robots.txt`、`_worker.js`（只把 `*.pages.dev` 跳回 `book.styrigx.com`） |
| `public/` | 构建产物，不进仓库 |

本地预览：

```bash
npm install
node scripts/vendor.mjs
npm run build:css
hugo server -s web
```

## workers/ Worker

```
workers/
└─ book-api/
   ├─ wrangler.toml
   ├─ API.md
   ├─ schema.sql
   ├─ migrations/
   └─ src/
      ├─ index.js
      ├─ routes.js
      └─ api/
```

- 目录名 = Cloudflare 上的 Worker 名去掉 `styrigx-` 前缀：`workers/book-api/` ↔ `styrigx-book-api`。

| Worker | 目录 | 管什么 |
|---|---|---|
| `styrigx-book-api` | `workers/book-api/` | 书库全部接口（书目、文件、封面、上传、进度）；R2 `BOOKS`、D1 `DB` 只绑在这里；路由 `book.styrigx.com/api/*`；不持任何钥匙，验票经服务绑定 `AUTH` 问主站鉴权网关 |

- `src/api/` 新增接口文件时，在 `src/routes.js` 登记一行（单测会检查）。下划线开头的文件（`_auth`、`_lib`、`_sessions`）不是接口。
- D1 增量迁移放 `migrations/`（`NNNN_*.sql`），手动执行：在 `workers/book-api/` 下 `npx wrangler d1 migrations apply styrigx-books --remote`。

## 谁管哪条路

| 地址 | 由谁处理 |
|---|---|
| `book.styrigx.com` 的页面（`/`、`/read/`、`/admin/`、`/en/`、`/zh/`…） | 主站鉴权网关（styrigx-space 仓库 `workers/auth-gateway`）验会话，再回源本仓库 Pages |
| `book.styrigx.com/api/session-check` | 主站鉴权网关直接回答 |
| `book.styrigx.com/api/*` 其他 | `styrigx-book-api`（本仓库 `workers/book-api`） |
| `/js/` `/css/` `/fonts/` 等静态资源 | Pages 直接给，不过任何 Worker |
| `*.styrigx-book.pages.dev` | Pages 的 `_worker.js` 301 回正式域名 |

新增页面目录：要在网关的 `wrangler.toml` 登记路由（styrigx-space 仓库），否则那个页面不验会话；本仓库 CI 部署后会逐个目录冒烟检查，漏了会红。

部署顺序（CI，main）：先确认网关已挂在 book 上 → 部署 `styrigx-book-api` 并冒烟 → 部署 Pages 并冒烟。

## tests/ 测试

```
tests/
├─ config/
│  ├─ playwright.visual.config.js
│  └─ playwright.e2e.config.js
├─ web/
│  ├─ *.test.mjs
│  ├─ e2e/
│  └─ visual/
└─ workers/
   └─ book-api/
      ├─ *.test.mjs
      └─ helpers/
```

| 位置 | 是什么 |
|---|---|
| `config/` | Playwright 配置（路径相对配置文件） |
| `web/` | 前端单元测试（`node --test`）、手机验收 E2E（`e2e/`）、视觉回归（`visual/`） |
| `workers/book-api/` | 接口单元测试；`helpers/fake-gateway.mjs` 是鉴权网关的测试替身 |

```bash
npm test            # 单元测试
npm run test:e2e    # 先 npm run build
npm run test:visual
```
