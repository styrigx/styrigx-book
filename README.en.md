<div align="center">

[中文](README.md) | English

# Styrigx Book

My personal library: read EPUB and PDF right in the browser.

[Visit book.styrigx.com](https://book.styrigx.com/en/) · [Main site styrigx.com](https://styrigx.com/en/) · [Blog blog.styrigx.com](https://blog.styrigx.com/en/) · [GitHub @styrigx](https://github.com/styrigx)

![Hugo](https://img.shields.io/badge/Hugo-0.162.0-2563eb?style=flat-square&logo=hugo)
![Tailwind CSS](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/styrigx/styrigx-book/main/package.json&query=%24.dependencies.tailwindcss&label=Tailwind%20CSS&style=flat-square&color=2563eb&logo=tailwindcss)
![Version](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-book/main/hugo.yaml&query=%24.params.version&label=Book&style=flat-square&color=2563eb)
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

The library has no login of its own. When the main site is unlocked it issues an `sgx-verified` cookie; the library verifies it with a public key, and only the owner gets into upload and private APIs. Book files live in Cloudflare R2; the catalog and reading progress live in D1. API notes: [`functions/API.md`](functions/API.md).

## Run locally

Requirements: Hugo extended 0.162.0, Node.js 20.

```bash
git clone https://github.com/styrigx/styrigx-book.git
cd styrigx-book
npm install
node scripts/vendor.mjs   # copy foliate-js / pdf.js into static/js/vendor/
npm run build:css
hugo server
```

Open http://localhost:1313. To debug the APIs, run `npx wrangler pages dev public` (R2 and D1 bindings are in `wrangler.toml`).

Pushing to main runs unit tests and E2E in GitHub Actions, then deploys to Cloudflare Pages (project `styrigx-book`).

## Directories

- `content/`: page entries, bilingual.
- `layouts/`: templates: shelf home, reader `/read/`, upload page `/admin/`.
- `assets/`: Tailwind input and front-end JS.
- `functions/`: Pages Functions for books, files, covers, upload, progress.
- `schema.sql`, `migrations/`: D1 schema and incremental migrations.
- `scripts/vendor.mjs`: syncs the third-party reader libraries (keeping their LICENSE files).
- `tests/`: unit, E2E and visual regression tests.

## License

Code is MIT; foliate-js and pdf.js under `static/js/vendor/` keep their own licenses. Book files and covers are not covered by this repo's license.

Thanks to [foliate-js](https://github.com/johnfactotum/foliate-js) and [pdf.js](https://github.com/mozilla/pdf.js).

© 2026 Sloan Gray · Powered by Styrigx UI
