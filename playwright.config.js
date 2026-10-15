/* Playwright 视觉回归测试配置（book 2.0）。
 *
 * 参考主站 styrigx-space 的 playwright.config.js：
 *   - 只跑 Chromium，保证基准一致；
 *   - 基线目录 tests/visual/baselines（playwright 会在里面按 spec 名建 *-snapshots 子目录）；
 *   - webServer 直接服务 hugo 构建产物 ./public（与 deploy.yml 的 `hugo --minify` 一致）。
 *
 * 注意：主站 CI 并没有用 Docker 镜像，而是 ubuntu-latest + `npx playwright install chromium --with-deps`。
 * 本仓库沿用同一做法：@playwright/test 版本与主站对齐（^1.64.0）。
 *
 * 基线生成（等 book-2.0 UI 定稿后执行一次）：
 *   npm run build:css && hugo --minify && npm run test:visual -- --update-snapshots
 * 后续对比：
 *   npm run test:visual
 */
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/visual',
  testMatch: ['*.spec.js'],
  /* 视觉回归：只跑 Chromium，保证基准一致 */
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  /* 基线文件放在 tests/visual/baselines/（playwright 实际写入
     tests/visual/baselines/<spec名>-snapshots/） */
  snapshotDir: './tests/visual/baselines',
  expect: {
    toHaveScreenshot: {
      /* 允许微小渲染差异（字体抗锯齿等） */
      maxDiffPixels: 120,
    },
  },
  webServer: {
    command: 'npx http-server ./public -p 8932 -s',
    port: 8932,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:8932',
    timezoneId: 'Asia/Shanghai',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
