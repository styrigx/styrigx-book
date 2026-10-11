/* 视觉回归测试用书目固件：/api/books（visitor）与 /api/private/books（owner）都返回它。
 * 字段与 functions/ 的 books 表对应：id / title / author / cover_key / format /
 * size(字节) / pages / tags / created_at / visibility / in_shelf。
 * created_at 用固定日期，保证截图稳定。
 */
'use strict';

const BOOKS = [
  {
    id: 'epub1',
    title: '了不起的盖茨比',
    author: 'F. Scott Fitzgerald',
    cover_key: 'cover-epub1',
    format: 'epub',
    size: 512340,
    pages: 218,
    tags: ['小说', '经典'],
    created_at: '2026-09-20T10:00:00Z',
    visibility: 'public',
    in_shelf: 1,
  },
  {
    id: 'pdf1',
    title: '信号与系统（第2版）',
    author: 'Alan V. Oppenheim',
    cover_key: 'cover-pdf1',
    format: 'pdf',
    size: 18432056,
    pages: 1024,
    tags: ['教材', '电子工程'],
    created_at: '2026-09-18T10:00:00Z',
    visibility: 'public',
    in_shelf: 1,
  },
  {
    id: 'epub2',
    title: '普林斯顿微积分读本',
    author: 'Adrian Banner',
    cover_key: 'cover-epub2',
    format: 'epub',
    size: 8234109,
    pages: 832,
    tags: ['教材', '数学'],
    created_at: '2026-09-15T10:00:00Z',
    visibility: 'public',
    in_shelf: 1,
  },
  {
    id: 'epub3',
    title: '动物森友会完全攻略',
    author: '任天堂',
    cover_key: 'cover-epub3',
    format: 'epub',
    size: 2048576,
    pages: 356,
    tags: ['游戏'],
    created_at: '2026-09-10T10:00:00Z',
    visibility: 'public',
    in_shelf: 1,
  },
  {
    id: 'pdf2',
    title: '塞尔达传说：旷野之息设定集',
    author: '任天堂',
    cover_key: '',
    format: 'pdf',
    size: 96785432,
    pages: 296,
    tags: ['游戏', '画集'],
    created_at: '2026-09-05T10:00:00Z',
    visibility: 'public',
    in_shelf: 1,
  },
  {
    id: 'epub4',
    title: '黄土地',
    author: '路遥',
    cover_key: 'cover-epub4',
    format: 'epub',
    size: 1024768,
    pages: 412,
    tags: ['小说'],
    created_at: '2026-09-01T10:00:00Z',
    visibility: 'public',
    in_shelf: 1,
  },
];

module.exports = { BOOKS };
