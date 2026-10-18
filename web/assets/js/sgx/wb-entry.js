/**
 * @fileoverview B2-7 网站数字健康：书站计时，上报到主站 /api/wellbeing。
 * 书库 / 上传页记「book」；阅读页记「book:<id>」，书名取阅读器加载后的 document.title。
 * 阅读时可能几分钟不碰屏幕，阅读页 5 分钟没操作才停表。
 */
import { initWbTrack } from './lib/wb-track.js';

const ENDPOINT = 'https://styrigx.com/api/wellbeing';
const p = location.pathname.replace(/^\/en(?=\/)/, '');
if (p.startsWith('/read/')) {
  const id = new URLSearchParams(location.search).get('id') || '';
  if (/^[A-Za-z0-9_\-]{1,80}$/.test(id)) {
    initWbTrack({ key: 'book:' + id, title: () => document.title, endpoint: ENDPOINT, idleMs: 300000 });
  }
} else {
  initWbTrack({ key: 'book', endpoint: ENDPOINT });
}
