/* Book 3.0 排版封面：书名断行辅助 + 生成封面共享渲染（设计稿 v1.3）。
 *
 * coverTitleHTML(title)：转义 + 在可断行标点后插入 <wbr>，配合 CSS
 * word-break: keep-all，浏览器优先在标点 / 空格处断行，永不把一个词拆开。
 * 例：「塞尔达传说：旷野之息设定集」→「塞尔达传说：<wbr>旷野之息设定集」
 * （不断成「塞尔达传 / 说：旷野…」）。
 *
 * 括号保护：括号内的标点 / 空格不产生断行机会（<wbr> 只在括号外插入，
 * 括号内空格换成 &nbsp;），避免「）」被孤立到下一行单独占一行。
 * 例：「三体（刘慈欣、著）」不会在「、」后断成「著）」单独一行。
 *
 * genCoverHTML(title, author, size)：生成封面共享渲染（书架 / 详情 /
 * FAB / 上传队列同一套：按书名哈希取色渐变 + 居中标题 + 作者）。
 * size: 'md'（书名+作者）| 'sm'（只书名）。
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
  function isBreakable(c) {
    return c === '：' || c === '、' || c === '，' || c === ',' || c === '。'
      || c === '；' || c === '！' || c === '？' || c === '·' || c === '/'
      || c === '／' || c === ' ' || c === '\t' || c === '\n';
  }
  function isSpace(c) {
    return c === ' ' || c === '\t' || c === '\n';
  }
  /* 括号保护：跟踪（）、() 深度；括号内不插 <wbr>，空格换 &nbsp;。
   * 未闭合的左括号：剩余部分按括号内处理；未配对的右括号：深度钳在 0。
   * 长串不断行：连续无断行机会的字符超过 maxRun 时，在安全点插 <wbr>
   * （不在括号内、不在右括号前、末段不少于 2 字），让超长标题能断行出省略号。
   * 注意：不依赖 overflow-wrap:break-word（它会无视括号把「）」孤立到下一行）。 */
  function coverTitleHTML(title, maxRun) {
    var s = String(title == null ? '' : title);
    var K = maxRun || 5;
    var out = '';
    var depth = 0;
    var run = '';
    /* 长串切分：均分成长 ≤K 的段，末段若只剩 1 字则并入前一段，避免单字孤行。 */
    function splitRun(r) {
      if (r.length <= K) return esc(r);
      var n = Math.ceil(r.length / K);
      var size = Math.ceil(r.length / n);
      var parts = [];
      for (var i = 0; i < r.length; i += size) parts.push(r.slice(i, i + size));
      if (parts.length > 1 && parts[parts.length - 1].length === 1) {
        parts[parts.length - 2] += parts.pop();
      }
      return parts.map(esc).join('<wbr>');
    }
    function flushRun() {
      if (!run) return;
      out += splitRun(run);
      run = '';
    }
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '（' || c === '(') {
        if (depth === 0) {
          flushRun();
          /* 括号组整体可换到下一行；已以 <wbr> 结尾时不重复。 */
          if (out && !out.endsWith('<wbr>')) out += '<wbr>';
        }
        depth++;
        out += esc(c);
        continue;
      }
      if (c === '）' || c === ')') {
        if (depth > 0) depth--;
        out += esc(c);
        continue;
      }
      if (depth > 0) { out += isSpace(c) ? '&nbsp;' : esc(c); continue; }
      if (isSpace(c)) { flushRun(); out += esc(c) + '<wbr>'; continue; }
      if (isBreakable(c)) { flushRun(); out += esc(c) + '<wbr>'; continue; }
      run += c;
    }
    flushRun();
    return out;
  }
  /* 生成封面配色：书名哈希取色（主站配色），与真实封面同尺寸。 */
  var GEN_COLORS = [
    ['#6FA8DC', '#4A7DBB'], ['#2C3E50', '#1A2530'], ['#7CB873', '#5A9E5C'],
    ['#D97B7B', '#B85C5C'], ['#B48CE8', '#8E63C8'], ['#D2A06B', '#B07D4A'],
    ['#6FC3B8', '#4AA89D'], ['#E8B44A', '#C8922E']
  ];
  function genColors(title) {
    var h = 0;
    var str = String(title || '');
    for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
    return GEN_COLORS[h % GEN_COLORS.length];
  }
  function genCoverHTML(title, author, size) {
    var c = genColors(title);
    var cls = size === 'sm' ? 'bk-gen bk-gen-sm' : 'bk-gen';
    var authorHTML = (size !== 'sm' && author)
      ? '<span class="bk-gen-author">' + esc(author) + '</span>' : '';
    /* 长串断行步长：sm 小封面行宽约 3 字 → 3；md 行宽约 5–6 字 → 5。 */
    var maxRun = size === 'sm' ? 3 : 5;
    return '<div class="' + cls + '" style="background:linear-gradient(160deg,' + c[0] + ',' + c[1] + ')">'
      + '<span class="bk-gen-title">' + coverTitleHTML(title, maxRun) + '</span>' + authorHTML + '</div>';
  }
  return { coverTitleHTML: coverTitleHTML, genCoverHTML: genCoverHTML, genColors: genColors };
});
