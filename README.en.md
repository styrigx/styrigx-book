<div align="center">

[中文](README.md) | English

# Styrigx Book

My personal library: read EPUB and PDF right in the browser.

[Visit book.styrigx.com](https://book.styrigx.com/en/) · [Main site styrigx.com](https://styrigx.com/en/) · [Blog blog.styrigx.com](https://blog.styrigx.com/en/) · [GitHub @styrigx](https://github.com/styrigx)

![Hugo](https://img.shields.io/badge/Hugo-0.162.0-2563eb?style=flat-square&logo=hugo)
![Tailwind CSS](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/styrigx/styrigx-book/main/package.json&query=%24.dependencies.tailwindcss&label=Tailwind%20CSS&style=flat-square&color=2563eb&logo=tailwindcss)
![Version](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-book/main/web/hugo.yaml&query=%24.params.version&label=Book&style=flat-square&color=2563eb)
![Deploy](https://img.shields.io/github/actions/workflow/status/styrigx/styrigx-book/deploy.yml?style=flat-square&label=Deploy&color=2563eb)
![License](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)

</div>

---

## What is this

The library sub-site of Styrigx's Space. The shelf, details and reader all use the same Styrigx UI as the main site: the same floating top bar, nine-dot site switcher, wallpaper and appearance settings, so coming from the main site feels like opening another app on the phone.

## What it does

- Shelf: list, grid and large-cover views, with a bottom search capsule for title or author; books without a cover get a typeset text cover.
- Reader: EPUB via foliate-js, PDF via pdf.js, both vendored in the repo, no CDN.
- Resume anywhere: reading progress is stored in the cloud, so you pick up on another device.
- Public / private: private books are only visible after I unlock.
- Upload: an owner-only upload page with chunked, resumable uploads, up to 500 MB per book.
- Shelf feed: `/api/shelf` serves the books picked for the main site's Bookshelf widget.
- Follows the main site's look: theme color, light/dark, font size and reduced motion sync from the main site.

## Sign-in and storage

The library has no login of its own and holds no keys. When the main site is unlocked it issues an `sgx-verified` cookie: pages are checked by the main site's auth gateway, and the API Worker (`styrigx-book-api`) hands the cookie to the gateway over a service binding. Only the owner gets into upload and private APIs. Book files live in Cloudflare R2; the catalog and reading progress live in D1, bound only to the API Worker. API notes: [`workers/book-api/API.md`](workers/book-api/API.md); layout: [`STRUCTURE.md`](STRUCTURE.md).

## Run locally

Requirements: Hugo extended 0.162.0, Node.js 20.

```bash
git clone https://github.com/styrigx/styrigx-book.git
cd styrigx-book
npm install
node scripts/vendor.mjs   # copy foliate-js / pdf.js into web/static/js/vendor/
npm run build:css
hugo server -s web
```

Open http://localhost:1313. The APIs live in `workers/book-api/` (R2, D1 and the gateway service binding are in its `wrangler.toml`).

Pushing to main runs unit tests and E2E in GitHub Actions, then deploys the API Worker `styrigx-book-api` and smoke-tests it, then deploys Cloudflare Pages (project `styrigx-book`, static files only).

## Directories

- `web/`: the site (Hugo), published by Cloudflare Pages as static files only.
- `workers/book-api/`: the library API Worker: catalog, files, covers, upload, progress; D1 migrations too.
- `tests/`: all tests, split into `web/` and `workers/book-api/`; Playwright configs in `tests/config/`.
- `scripts/vendor.mjs`: syncs the third-party reader libraries (keeping their LICENSE files).

See [`STRUCTURE.md`](STRUCTURE.md).

## License

Code is MIT; foliate-js and pdf.js under `web/static/js/vendor/` keep their own licenses. Book files and covers are not covered by this repo's license.

Thanks to [foliate-js](https://github.com/johnfactotum/foliate-js) and [pdf.js](https://github.com/mozilla/pdf.js).

© 2026 Sloan Gray · Powered by Styrigx UI
