/* Book 3.0 排版封面：书名断行辅助（设计稿 v1.3：书名不得拆词）。
 *
 * coverTitleHTML(title)：转义 + 在可断行标点后插入 <wbr>，配合 CSS
 * word-break: keep-all，浏览器优先在标点 / 空格处断行，永不把一个词拆开。
 * 例：「塞尔达传说：旷野之息设定集」→「塞尔达传说：<wbr>旷野之息设定集」
 * （不断成「塞尔达传 / 说：旷野…」）。
 *
 * UMD：浏览器里挂 window.SgxBookCover，Node 测试里直接 require。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SgxBookCover = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* 可断行位置：中文标点 + 英文标点 + 斜杠 + 空白。只在这些字符后放 <wbr>。 */
  var BREAK_AFTER = /([：、，,。；！？·\/／\s])/g;
  function coverTitleHTML(title) {
    return esc(title).replace(BREAK_AFTER, '$1<wbr>');
  }
  return { coverTitleHTML: coverTitleHTML };
});
