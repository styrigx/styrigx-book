<div align="center">

中文 | [English](README.en.md)

# Styrigx Book

我的个人书库，在网页里直接读 EPUB 和 PDF。

[在线访问 book.styrigx.com](https://book.styrigx.com) · [主站 styrigx.com](https://styrigx.com) · [博客 blog.styrigx.com](https://blog.styrigx.com) · [GitHub @styrigx](https://github.com/styrigx)

![Hugo](https://img.shields.io/badge/Hugo-0.162.0-2563eb?style=flat-square&logo=hugo)
![Tailwind CSS](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/styrigx/styrigx-book/main/package.json&query=%24.dependencies.tailwindcss&label=Tailwind%20CSS&style=flat-square&color=2563eb&logo=tailwindcss)
![Version](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-book/main/web/hugo.yaml&query=%24.params.version&label=Book&style=flat-square&color=2563eb)
![Deploy](https://img.shields.io/github/actions/workflow/status/styrigx/styrigx-book/deploy.yml?style=flat-square&label=Deploy&color=2563eb)
![License](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)

</div>

---

## 这是什么

Styrigx's Space 的书库子站。书架、详情和阅读器都用主站同一套 Styrigx UI：一样的悬浮顶栏、九宫格切站、壁纸和外观设置，从主站点过来就像打开了手机里的另一个 App。

## 能做什么

- 书架：列表、网格、大封面三种视图，底部搜索胶囊按书名或作者搜；没有封面的书自动排出文字封面。
- 阅读器：EPUB 用 foliate-js，PDF 用 pdf.js，文件都放在仓库里，不走 CDN。
- 续读：阅读进度存在云端，换设备接着读。
- 公开 / 私有：私有的书只有我解锁后能看到。
- 上传：站长专属上传页，分片上传、断点续传，单本上限 500 MB。
- 书单：`/api/shelf` 把选进书单的书提供给主站「书单」小组件。
- 外观跟主站走：主题色、深浅色、字号和减弱动效从主站同步过来。

## 登录和存储

书库自己不做登录、不持任何钥匙。主站解锁后签发 `sgx-verified` Cookie：页面由主站鉴权网关验，接口 Worker（`styrigx-book-api`）把 Cookie 交给网关验（服务绑定），只有站长能进上传和私有接口。书的文件放在 Cloudflare R2，书目和阅读进度放在 D1，这两个绑定只在接口 Worker 上。接口说明见 [`workers/book-api/API.md`](workers/book-api/API.md)，目录结构见 [`STRUCTURE.md`](STRUCTURE.md)。

## 本地运行

环境要求：Hugo extended 0.162.0、Node.js 20。

```bash
git clone https://github.com/styrigx/styrigx-book.git
cd styrigx-book
npm install
node scripts/vendor.mjs   # 复制 foliate-js / pdf.js 到 web/static/js/vendor/
npm run build:css
hugo server -s web
```

浏览器打开 http://localhost:1313。接口在 `workers/book-api/`（R2、D1、网关服务绑定见那里的 `wrangler.toml`）。

推送 main 后，GitHub Actions 跑单元测试和 E2E，通过后先部署接口 Worker `styrigx-book-api` 并冒烟检查，再部署 Cloudflare Pages（项目名 `styrigx-book`，只放静态文件）。

## 目录说明

- `web/`：网站本体（Hugo），由 Cloudflare Pages 发布，只放静态文件。
- `workers/book-api/`：书库接口 Worker：书目、文件、封面、上传、进度；D1 迁移也在这里。
- `tests/`：全部测试，按对象分 `web/`、`workers/book-api/`，Playwright 配置在 `tests/config/`。
- `scripts/vendor.mjs`：同步第三方阅读器库（保留各自的 LICENSE）。

详见 [`STRUCTURE.md`](STRUCTURE.md)。

## 许可

代码 MIT；`web/static/js/vendor/` 下的 foliate-js、pdf.js 遵循各自的许可。书籍文件和封面等内容不在本仓库授权范围内。

感谢 [foliate-js](https://github.com/johnfactotum/foliate-js) 和 [pdf.js](https://github.com/mozilla/pdf.js)。

© 2026 Sloan Gray · Powered by Styrigx UI
