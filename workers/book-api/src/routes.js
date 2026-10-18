/**
 * @fileoverview 书库接口路由表：/api/<路径> → src/api/<路径>.js。
 *
 * 代替 Pages 的「按文件路由」。src/api/ 新增或删除接口文件时这里要同步，
 * tests/workers/book-api/worker.test.mjs 会检查两边一致，漏了 CI 会红。
 * 下划线开头的文件不是接口（_auth、_lib、_sessions）。
 */
import * as adminAppCheck from './api/admin/app-check.js';
import * as adminBook from './api/admin/book.js';
import * as adminBooks from './api/admin/books.js';
import * as adminBackfillCovers from './api/admin/books/backfill-covers.js';
import * as adminCover from './api/admin/cover.js';
import * as uploadAbort from './api/admin/upload/abort.js';
import * as uploadComplete from './api/admin/upload/complete.js';
import * as uploadInit from './api/admin/upload/init.js';
import * as uploadPart from './api/admin/upload/part.js';
import * as books from './api/books.js';
import * as cover from './api/cover.js';
import * as file from './api/file.js';
import * as privateBooks from './api/private/books.js';
import * as privateCover from './api/private/cover.js';
import * as privateFile from './api/private/file.js';
import * as privateMe from './api/private/me.js';
import * as privateProgress from './api/private/progress.js';
import * as shelf from './api/shelf.js';
import * as shelfCover from './api/shelf/cover/[id].js';
import * as status from './api/status.js';

/** 固定路径 @type {Map<string, Record<string, Function>>} */
export const API_ROUTES = new Map([
  ['/api/admin/app-check', adminAppCheck],
  ['/api/admin/book', adminBook],
  ['/api/admin/books', adminBooks],
  ['/api/admin/books/backfill-covers', adminBackfillCovers],
  ['/api/admin/cover', adminCover],
  ['/api/admin/upload/abort', uploadAbort],
  ['/api/admin/upload/complete', uploadComplete],
  ['/api/admin/upload/init', uploadInit],
  ['/api/admin/upload/part', uploadPart],
  ['/api/books', books],
  ['/api/cover', cover],
  ['/api/file', file],
  ['/api/private/books', privateBooks],
  ['/api/private/cover', privateCover],
  ['/api/private/file', privateFile],
  ['/api/private/me', privateMe],
  ['/api/private/progress', privateProgress],
  ['/api/shelf', shelf],
  ['/api/status', status],
]);

/** 带参数的路径：[正则, 模块, 参数名]（对应 Pages 的 [id].js） */
export const PARAM_ROUTES = [
  [/^\/api\/shelf\/cover\/([^/]+)$/, shelfCover, 'id', '/api/shelf/cover/[id]'],
];
