# book.styrigx.com 上线清单（Cloudflare 后台手动步骤）

代码已推送到 `styrigx/styrigx-book`（main 分支），以下步骤需在 Cloudflare Dashboard 亲自操作。

## 1. 开通 R2
- 左侧菜单 **R2** → **Enable R2**（首次使用需点一下开通）。

## 2. 建 bucket
- **R2** → **Create bucket**，Bucket name 填 `styrigx-books`，Location 选 `Automatic`，其余默认 → **Create bucket**。
- 注意：不要开 Public Access（保持私有，文件全部经 Function 转发）。

## 3. 建 D1 并执行 schema
- 左侧菜单 **Workers & Pages** → **D1** → **Create database**，Database name 填 `styrigx-books` → **Create**。
- 点进 `styrigx-books` → **Console** 标签页，把仓库根目录 `schema.sql` 的全部内容粘贴进去 → **Execute**。
- 看到 `Success` 即建表完成（含 `in_shelf` 字段）。

## 4. 建 Pages 项目并连仓库
- 左侧菜单 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
- 选仓库 `styrigx/styrigx-book`，分支 `main`。
- **Project name** 填 `styrigx-book`。
- Framework preset 选 `Hugo`（构建命令会自动识别；实际构建由 GitHub Action 完成，Pages 这里用默认即可）。
- **Build command** 留空或填 `hugo --minify`，**Build output directory** 填 `public`。
- 点 **Save and Deploy**（首次部署可能失败，无所谓，GitHub Action 会重新部署）。

## 5. 绑定 R2 和 D1
- 进 `styrigx-book` 项目 → **Settings** → **Functions**（或 **Bindings**）：
  - **R2 bucket bindings** → **Add binding**：Variable name 填 `BOOKS`，Bucket 选 `styrigx-books`。
  - **D1 database bindings** → **Add binding**：Variable name 填 `DB`，Database 选 `styrigx-books`。
- **Environment Variables** → **Add variable**：
  - `MAX_UPLOAD_MB` = `500`
  - `ACCESS_TEAM_DOMAIN` = 你的 Access 团队域名（如 `styrigx.cloudflareaccess.com`，见第 7 步）。
- 点 **Save**，然后 **Retry deployment** 或等下一次 push。

## 6. 加自定义域名
- `styrigx-book` 项目 → **Custom domains** → **Set up a custom domain**，填 `book.styrigx.com` → **Activate**。
- Cloudflare 会自动建好 DNS 解析，等证书生效（几分钟）。

## 7. 建 Access 应用和规则
- 左侧菜单 **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**：
  - Application name：`book-admin`
  - Subdomain：`book`，Domain：`styrigx.com`，Path：`/admin/*|/api/admin/*|/api/private/*`
    （如果 Path 只支持单条，就建三个应用，Path 分别为 `/admin/*`、`/api/admin/*`、`/api/private/*`，策略相同）
- **Identity providers**：确认有 **One-time PIN**（邮箱验证码）可用。
- **Policy** → **Add a policy**：
  - Policy name：`only-me`
  - Action：`Allow`
  - Include：`Emails` → 填你本人的邮箱
- **记下团队域名**：Zero Trust 左上角显示的 `xxx.cloudflareaccess.com`，填回第 5 步的 `ACCESS_TEAM_DOMAIN`。

## 8. 验证
- 打开 `https://book.styrigx.com/`：能看到书库（空）。
- 打开 `https://book.styrigx.com/admin/`：应跳转到 Access 邮箱验证码登录。
- 登录后上传一本小 epub：书架出现封面和书名。
- 未登录访问 `/api/admin/books`：应 401/403。

## GitHub 侧（已配好，无需操作）
- `.github/workflows/deploy.yml`：push 到 main 自动构建（Hugo + Tailwind + vendor）并 `pages deploy` 到项目 `styrigx-book`。
- 所需 secrets（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）沿用博客项目的同名 secrets 即可。
