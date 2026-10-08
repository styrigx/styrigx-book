# styrigx-book · 个人电子书库

[![Deploy](https://github.com/styrigx/styrigx-book/actions/workflows/deploy.yml/badge.svg)](https://github.com/styrigx/styrigx-book/actions)

Sloan Gray 的个人电子书库，EPUB / PDF 在线阅读。线上地址：https://book.styrigx.com

> 当前状态（1.2）：**存储和登录都是关闭的**。环境变量 `STORAGE_ENABLED=false`，没有开通 R2、没有绑定 `BOOKS`，也没有启用 Cloudflare Access。`/admin/` 显示「上传暂未开放」，空书架显示「书库正在整理」。将来要打开上传和登录，按 `CLOUDFLARE_SETUP.md` 的步骤操作即可，不用改代码。

## 功能要点

- 书架：公开书目列表，支持搜索（书名 / 作者）
- 书籍详情页：封面、简介、元数据
- 阅读器：EPUB（foliate-js）+ PDF（pdf.js），全部本地 vendor 文件，不走 CDN
- 阅读进度同步：同一本书在不同设备间续读（需登录开启后）
- 公开 / 私有：私有书目仅登录后可见（需 Access 开启后）
- `/api/shelf`：公开书架 JSON 接口（供主站 styrigx.com 调用）
- 顶栏头像 + Styrigx 返回主站 https://styrigx.com

## 技术栈

- 前端：Hugo + Tailwind CSS（One UI 8.5 视觉风格，中英文双语页面）
- 阅读器：foliate-js（EPUB）、pdfjs-dist（PDF），见 `scripts/vendor.mjs`
- 后端：Cloudflare Pages Functions（`functions/`）
- 数据：Cloudflare D1（书籍信息 + 阅读进度，见 `schema.sql` 与 `migrations/`）
- 存储：Cloudflare R2（`STORAGE_ENABLED=true` 且绑定 `BOOKS` 时启用；当前关闭）

## 本地开发

```bash
npm install
node scripts/vendor.mjs   # 把 foliate-js / pdf.js 复制到 static/js/vendor/
npm run build:css         # 生成 assets/css/main.css
hugo server
```

Functions 本地调试：`npx wrangler pages dev public`（需自行配置 D1/R2 绑定）。
阅读器页面是 `/read/`（EPUB / PDF 在线打开），管理页是 `/admin/`（当前显示「上传暂未开放」）。

## 部署

push 到 main 自动构建并部署到 Cloudflare Pages 项目 `styrigx-book`
（仓库 secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）。

环境变量（Pages → Settings → Environment variables）：

| 变量 | 当前值 | 说明 |
|---|---|---|
| `STORAGE_ENABLED` | `false` | 严格为 `true` 且绑定了 `BOOKS` 时才启用存储 |
| `MAX_UPLOAD_MB` | `500` | 单文件上传上限（MB） |

D1 数据库 `styrigx-books` 已绑定到 Pages（变量名 `DB`）；R2 未开通、Access 未启用。
`/api/admin/*` 与 `/api/private/*` 在未配置 Access 时返回 401；上传接口在存储关闭时返回 503；文件读取返回 404。

## 目录结构

```
hugo.yaml            # 站点配置（含 version）
content/             # 页面内容（zh / en）
layouts/             # 模板：书架、详情、阅读器 /read/、管理 /admin/
assets/css/          # Tailwind 输入样式
static/js/vendor/    # foliate-js / pdf.js 本地文件（由 scripts/vendor.mjs 生成）
static/fonts/        # 自托管字体
functions/           # Pages Functions：/api/shelf、/api/status、管理与私有接口
schema.sql           # D1 建表
migrations/          # D1 增量迁移（NNN_*.sql）
scripts/vendor.mjs   # 第三方阅读器库同步脚本（白名单复制 + 保留 LICENSE）
CLOUDFLARE_SETUP.md  # 将来开通 R2 / Access 的步骤
```

## 许可证与致谢

- 本仓库代码：MIT License，Copyright (c) 2026 Sloan Gray，见 `LICENSE`。
- `static/js/vendor/` 下的第三方库（foliate-js、pdf.js）保留它们自己的 `LICENSE` 文件，遵循各自的开源许可。
- 致谢：[foliate-js](https://github.com/johnfactotum/foliate-js)、[pdf.js](https://github.com/mozilla/pdf.js)、Hugo、Tailwind CSS。

## 相关项目

主站 [Styrigx's Space](https://styrigx.com)（[styrigx/styrigx-space](https://github.com/styrigx/styrigx-space)） ·
博客 [blog.styrigx.com](https://blog.styrigx.com)（[styrigx/styrigx-blog](https://github.com/styrigx/styrigx-blog)） ·
邀请码站 [muse-invite.styrigx.com](https://muse-invite.styrigx.com)（[styrigx/muse-invite-board](https://github.com/styrigx/muse-invite-board)）

---

## English summary

styrigx-book is Sloan Gray's personal ebook library (https://book.styrigx.com): a Hugo + Tailwind
site with an online EPUB/PDF reader (foliate-js + pdf.js, vendored locally), bookshelf, reading
progress sync, and Cloudflare Pages Functions + D1 on the backend. **As of 1.2, storage and login
are disabled** (`STORAGE_ENABLED=false`, no R2 binding, no Cloudflare Access); see
`CLOUDFLARE_SETUP.md` for the steps to enable them later. Code is MIT licensed (Copyright (c)
2026 Sloan Gray); third-party reader libraries keep their own LICENSE files.
