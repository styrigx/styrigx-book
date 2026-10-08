# styrigx-book · 个人电子书库

book.styrigx.com 1.0 —— 站内上传 + 在线阅读的个人电子书库。

- 前端：Hugo + Tailwind CSS，样式复用 styrigx-space 的 One UI 8.5 视觉系统（颜色变量、大标题区、搜索条、squircle 图标、深浅色跟随系统）
- 后端：Cloudflare Pages Functions
- 存储：R2（文件 + 封面，bucket `styrigx-books`，不公开，全部经 Function 转发）+ D1（书籍信息 + 阅读进度，db `styrigx-books`）
- 权限：Cloudflare Access 保护 `/admin/*`、`/api/admin/*`、`/api/private/*`；Function 内再校验 `Cf-Access-Jwt-Assertion`

## 本地开发

```bash
npm install
node scripts/vendor.mjs          # 把 foliate-js / pdf.js 复制到 static/js/vendor/
npx tailwindcss -i assets/css/input.css -o assets/css/main.css
hugo server
```

Functions 本地调试用 `npx wrangler pages dev public`（需自行配置 R2/D1 绑定）。

## 部署

push 到 main 自动构建并部署到 Cloudflare Pages 项目 `styrigx-book`
（secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）。

R2 / D1 绑定、自定义域名、Access 规则在 Cloudflare 后台配置，不在仓库里。

## D1

建表：`schema.sql`；增量迁移：`migrations/`（按 `NNN_*.sql` 命名）。

## API

见 `functions/api/`。公开接口只返回 public 书；私有内容走 `/api/private/*`；
管理接口走 `/api/admin/*`（R2 multipart 上传、元数据管理）。
