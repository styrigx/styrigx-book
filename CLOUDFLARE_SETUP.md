# book.styrigx.com 上线后开通清单

当前状态：存储（R2）和登录（Access）都是关闭的开关。以下步骤按顺序做，做完上传功能即开，不用改代码。

1. 在 Cloudflare Dashboard 开通 R2（点启用，接受条款）。
2. 建 R2 bucket，名字填 `styrigx-books`。
3. Pages 项目 `styrigx-book` → Settings → Functions → R2 bucket bindings，加绑定：变量名 `BOOKS`，选 bucket `styrigx-books`。
4. 开 Zero Trust → Access（点启用）。
5. 建 Access 应用：保护 `book.styrigx.com/admin/*`、`book.styrigx.com/api/admin/*`、`book.styrigx.com/api/private/*`，策略只允许你的邮箱（OTP 邮箱验证码登录）。
6. 记下 Zero Trust 的 Team domain，回到 Pages 项目加两个环境变量：`ACCESS_TEAM_DOMAIN`（填 team domain）、`ACCESS_AUD`（填 Access 应用的 audience tag，可选）。
7. 把环境变量 `STORAGE_ENABLED` 改成 `true`（现在是 `false`）。
8. 给部署 token `styrigx-book-pages-deploy` 加权限：R2 读写、D1 读写（如果之前没给）。

做完验证：打开 https://book.styrigx.com/admin/，用邮箱验证码登录，能看到上传区即成功。
