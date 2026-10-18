/* Book 手机验收 E2E 配置：四（⋮ 下拉菜单）/ 五（半屏下沉弹层）。
 *
 * 与 tests/web/visual 的视觉回归配置分开：这里只做功能/几何断言，不做截图比对。
 * 设备按验收要求：Chromium，412×915 / 360×800，
 * deviceScaleFactor 2.625，isMobile + hasTouch。
 *
 * CI（deploy.yml）：hugo 构建出 web/public 后，
 *   npx playwright install chromium --with-deps && npm run test:e2e
 */
const { defineConfig } = require('@playwright/test');

const PHONE = { deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };

module.exports = defineConfig({
  testDir: '../web/e2e',
  testMatch: ['*.spec.js'],
  projects: [
    {
      name: 'phone-412',
      use: { browserName: 'chromium', viewport: { width: 412, height: 915 }, ...PHONE },
    },
    {
      name: 'phone-360',
      use: { browserName: 'chromium', viewport: { width: 360, height: 800 }, ...PHONE },
    },
  ],
  webServer: {
    command: 'npx http-server ../../web/public -p 8932 -s',
    port: 8932,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:8932',
    timezoneId: 'Asia/Shanghai',
  },
  reporter: [['list']],
  timeout: 60000,
});
