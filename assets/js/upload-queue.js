/* Shared upload queue (extracted from admin.html). Init with SgxUploadQueue.init(prefix, {isEn, onBookAdded}) */
window.SgxUploadQueue = window.SgxUploadQueue || {};

/* ---- 通行证 403 分类（顶层：FAB 预检与队列共用） ----
   需要重新授权的错误码：app-token-required / app-token-invalid / upload-session-invalid
   （upload-session-invalid 表示主站 app-epoch 已加一，旧通行证失效，需重新授权）。
   其他 403 按错误码给中文提示，不跳。 */
window.SgxUploadQueue.appVerifyUrl = function(){
  return 'https://styrigx.com/app-verify/?aud=book&scope=upload&return=' + encodeURIComponent(window.location.href);
};
window.SgxUploadQueue.appTokenErrorCode = async function(res){
  if(!res || res.status !== 403) return null;
  try{
    var j = await res.clone().json();
    var e = j && j.error;
    if(e === 'app-token-required' || e === 'app-token-invalid' || e === 'upload-session-invalid') return e;
  }catch(x){}
  return null;
};
/* 403 错误码 → 中文提示（不直接显示 HTTP 状态码）。
   返回 {reauth:bool, msg:string}：reauth 为 true 时直接跳授权页。 */
window.SgxUploadQueue.describe403 = async function(res, isEn){
  var code = null;
  try{
    var j = await res.clone().json();
    code = j && j.error;
  }catch(x){}
  if(code === 'app-token-required' || code === 'app-token-invalid' || code === 'upload-session-invalid'){
    return { reauth: true, msg: isEn ? 'Authorization expired, please re-authorize' : '授权已失效，请重新授权' };
  }
  if(code === 'upload-session-expired'){
    return { reauth: false, msg: isEn ? 'Upload session expired, please re-upload' : '上传会话已过期，请重新上传' };
  }
  if(code === 'forbidden'){
    return { reauth: false, msg: isEn ? 'No permission' : '无权限' };
  }
  /* 注意：调用方 UI 会统一加「上传失败：」前缀，这里只返回错误码本身，避免双前缀 */
  return { reauth: false, msg: code || 'HTTP 403' };
};
/* 分片错误解析：返回 {msg, code, retryable, reauth, sessionGone}。
   - 4xx（文件/客户端问题）与服务端已中止会话的错误不重试：重试只会得到 norow，
     掩盖首次真实错误。
   - 只有网络错误、会话保留的可重试错误才重试。
   - sessionGone：会话已不存在（服务端 abort/过期，或 404/410）。调用方自动从 init
     重建会话一次，不直接跳授权页——重建时若通行证真失效，init 会返回需授权的 403。
   - msg 不带「上传失败：」前缀，调用方 UI 统一加。 */
window.SgxUploadQueue.describePartError = async function(res, partNumber, isEn){
  var code = null, detail = null;
  try{
    var j = await res.clone().json();
    code = j && j.error; detail = j && j.detail;
  }catch(x){}
  /* 会话类错误与 404/410 视为「会话已不存在」，由调用方自动重建 */
  var sessionGone = (code === 'upload-session-invalid' || code === 'upload-session-expired' ||
                     res.status === 404 || res.status === 410);
  /* 需重新授权的 403：沿用 describe403；会话类 403 走 sessionGone，不直接跳授权 */
  if(res.status === 403){
    var d = await window.SgxUploadQueue.describe403(res, isEn);
    if(sessionGone){
      return { msg: d.msg, code: code, retryable: false, reauth: false, sessionGone: true };
    }
    return { msg: d.msg, code: code, retryable: false, reauth: d.reauth, sessionGone: false };
  }
  var msg = code || ('HTTP ' + res.status);
  var retryable = false;
  if(sessionGone){
    msg = isEn ? 'Upload session lost' : '上传会话已失效';
    retryable = false; /* 重试无意义，由调用方重建会话 */
  }else if(code === 'invalid-file-magic'){
    var bytes = detail && detail.bytes;
    msg = isEn ? 'Invalid file header' : '文件头校验失败';
    if(bytes !== undefined && bytes !== null) msg += isEn ? ' (received ' + bytes + ' bytes)' : '（收到 ' + bytes + ' 字节）';
    retryable = false; /* 服务端已 abort，会话已删 */
  }else if(code === 'part-body-empty'){
    msg = isEn ? 'Empty chunk data, retrying' : '分片数据为空，正在重试';
    retryable = true; /* 会话保留 */
  }else if(code === 'part-r2-error'){
    msg = isEn ? 'Storage service error' : '存储服务异常';
    retryable = false; /* 服务端已 abort，会话已删 */
  }else if(code === 'part-auth-error'){
    msg = isEn ? 'Server verification error' : '服务端校验异常';
    retryable = true; /* 会话未被清理 */
  }else if(code === 'part-failed'){
    msg = isEn ? 'Part upload failed' : '分片上传失败';
    retryable = false;
  }else if(res.status >= 400 && res.status < 500){
    retryable = false; /* 其他 4xx 不重试 */
  }else if(res.status >= 500){
    retryable = true; /* 未知 5xx 保守重试 */
  }
  return { msg: msg, code: code, retryable: retryable, reauth: false, sessionGone: sessionGone };
};
/* 上传队列开始前（选文件之前）预检：通行证无效返回 false，调用方直接跳复验 */
window.SgxUploadQueue.appCheck = async function(){
  try{
    var r = await fetch('/api/admin/app-check', {credentials: 'same-origin'});
    if(r.status !== 403) return true;
    var code = await window.SgxUploadQueue.appTokenErrorCode(r);
    return !code; // 通行证问题 → false；其他 403 不拦截
  }catch(e){ return true; }
};

window.SgxUploadQueue.init = function(prefix, opts){
"use strict";
var isEn = !!opts.isEn;

/* 旧 checkAppAuth 保留给管理页 helpers：分类后跳转（兼容原有调用） */
async function checkAppAuth(res){
  var code = await window.SgxUploadQueue.appTokenErrorCode(res);
  if(code){
    window.location.href = window.SgxUploadQueue.appVerifyUrl();
    return true;
  }
  return false;
}

/* 单文件上限（可配置）；R2 multipart 切片大小固定 10MB */
var MAX_MB = 500;
var CHUNK = 10 * 1024 * 1024;

var T = {
  title: isEn ? 'Title' : '书名',
  author: isEn ? 'Author' : '作者',
  lang: isEn ? 'Language' : '语言',
  tags: isEn ? 'Tags' : '标签',
  tagsPh: isEn ? 'Comma separated' : '逗号分隔',
  pub: isEn ? 'Public' : '公开',
  priv: isEn ? 'Private' : '私有',
  inShelf: isEn ? 'Feature in shelf' : '放进书单',
  upload: isEn ? 'Upload' : '上传',
  cancel: isEn ? 'Cancel' : '取消',
  retry: isEn ? 'Retry' : '重试',
  remove: isEn ? 'Remove' : '移除',
  editMeta: isEn ? 'Edit info' : '编辑信息',
  replaceCover: isEn ? 'Replace cover' : '换封面',
  save: isEn ? 'Save' : '保存',
  saveFail: isEn ? 'Save failed' : '保存失败',
  failed: isEn ? 'Failed' : '失败',
  parsing: isEn ? 'Parsing…' : '解析中…',
  ready: isEn ? 'Ready to upload' : '就绪，可上传',
  uploading: function(p){ return (isEn ? 'Uploading ' : '上传中 ') + p + '%'; },
  done: isEn ? 'Done' : '已完成',
  exists: isEn ? 'Already exists — skipped' : '已存在，已跳过',
  errMagic: isEn ? 'Invalid file header (not a real EPUB/PDF)' : '文件头校验失败（不是有效的 EPUB/PDF）',
  errMime: isEn ? 'Not a valid EPUB (mimetype missing)' : '不是有效的 EPUB（缺少 mimetype）',
  errExt: isEn ? 'Only .epub / .pdf accepted' : '仅接受 .epub / .pdf',
  errSize: isEn ? 'File too large (max 500 MB)' : '文件过大（上限 500MB）',
  errUpload: isEn ? 'Upload failed: ' : '上传失败：',
  needReauth: isEn ? 'Re-verification needed' : '需要重新验证',
  cancelled: isEn ? 'Cancelled' : '已取消',
  stats: function(n, s){ return isEn ? (n + ' books · ' + s + ' used') : ('共 ' + n + ' 本 · 已用 ' + s); },
  editInfo: isEn ? 'Edit info' : '编辑信息',
  replaceCover: isEn ? 'Replace cover' : '换封面',
  del: isEn ? 'Delete' : '删除',
  edit: isEn ? 'Edit' : '编辑',
  delConfirm: function(t){ return isEn ? ('Delete "' + t + '"?\nThis removes the file, cover and database record.') : ('确定删除《' + t + '》吗？\n将同时删除 R2 文件、封面和数据库记录。'); },
  delFail: isEn ? 'Delete failed' : '删除失败',
  saveFail: isEn ? 'Save failed' : '保存失败',
  shelf: isEn ? 'Shelf' : '书单'
};

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function fmtSize(b){
  b = Number(b) || 0;
  if(b < 1024) return b + ' B';
  if(b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if(b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
function fmtSpeed(bps){
  return fmtSize(bps) + '/s';
}
function fmtDate(s){
  if(!s) return '—';
  try{ return new Date(s).toLocaleDateString(isEn ? 'en-US' : 'zh-CN'); }
  catch(e){ return '—'; }
}
function api(path, opts){
  opts = opts || {};
  opts.credentials = 'same-origin';
  return fetch(path, opts);
}
function subEl(){ return document.querySelector('[data-subpage-head] .subpage-sub'); }

var adminBooks = [];
var queue = [];
var uidSeq = 0;

/* ============ 文件校验：魔数（前后端都验） ============ */
async function checkMagic(file){
  var ext = file.name.toLowerCase();
  var head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  var isZip = head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04; /* PK\x03\x04 */
  var isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; /* %PDF */
  if(ext.endsWith('.epub')){
    if(!isZip) return {ok: false, why: 'magic'};
    /* zip 内含 mimetype application/epub+zip：扫前 8KB 找明文串 */
    var buf = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
    var s = new TextDecoder('latin1').decode(buf);
    if(s.indexOf('application/epub+zip') === -1) return {ok: false, why: 'mimetype'};
    return {ok: true, format: 'EPUB'};
  }
  if(ext.endsWith('.pdf')){
    if(!isPdf) return {ok: false, why: 'magic'};
    return {ok: true, format: 'PDF'};
  }
  return {ok: false, why: 'ext'};
}

/* ============ 元数据解析 ============ */
function langStr(v){
  if(!v) return '';
  if(typeof v === 'string') return v;
  if(typeof v === 'object') return v.und || Object.values(v)[0] || '';
  return String(v);
}
async function toWebp600(blob){
  var bmp = await createImageBitmap(blob);
  var w = 600, h = Math.max(1, Math.round(bmp.height * (600 / bmp.width)));
  var cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if(bmp.close) bmp.close();
  var webp = await new Promise(function(res){ cv.toBlob(res, 'image/webp', 0.85); });
  if(!webp) throw new Error('webp compress failed');
  return webp;
}
async function makeZipLoader(file){
  var zip = await import('/js/vendor/foliate-js/vendor/zip.js');
  zip.configure({useWebWorkers: false});
  var reader = new zip.ZipReader(new zip.BlobReader(file));
  var entries = await reader.getEntries();
  var map = new Map(entries.map(function(e){ return [e.filename, e]; }));
  var load = function(f){ return function(name){
    var args = Array.prototype.slice.call(arguments, 1);
    return map.has(name) ? f.apply(null, [map.get(name)].concat(args)) : null;
  }; };
  return {
    loadText: load(function(entry){ return entry.getData(new zip.TextWriter()); }),
    loadBlob: load(function(entry, type){ return entry.getData(new zip.BlobWriter(type)); }),
    getSize: function(name){ var e = map.get(name); return e ? (e.uncompressedSize || 0) : 0; }
  };
}
async function parseEpub(file){
  var mod = await import('/js/vendor/foliate-js/epub.js');
  var loader = await makeZipLoader(file);
  var book = await new mod.EPUB(loader).init();
  var md = book.metadata || {};
  var title = langStr(md.title) || file.name.replace(/\.epub$/i, '');
  /* tidy() 会把单元素数组压成标量：author 可能是字符串/对象/数组 */
  var authorArr = md.author == null ? [] : (Array.isArray(md.author) ? md.author : [md.author]);
  var author = authorArr.map(function(a){ return langStr(a && a.name !== undefined ? a.name : a); }).filter(Boolean).join(', ');
  var langRaw = md.language;
  var lang = Array.isArray(langRaw) ? (langRaw[0] || '') : (langRaw || '');
  var coverBlob = null, pages = 0;
  try{
    var cb = await book.getCover();
    if(cb) coverBlob = await toWebp600(cb);
  }catch(e){}
  try{ pages = (book.sections || []).length; }catch(e){}
  try{ if(book.destroy) book.destroy(); }catch(e){}
  return {title: title, author: author, lang: lang, coverBlob: coverBlob, pages: pages};
}
var pdfjsLib = null;
async function parsePdf(file){
  if(!pdfjsLib){
    pdfjsLib = await import('/js/vendor/pdfjs/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/vendor/pdfjs/pdf.worker.min.mjs';
  }
  var doc = await pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise;
  var title = '', author = '';
  try{
    var m = await doc.getMetadata();
    if(m && m.info){ title = m.info.Title || ''; author = m.info.Author || ''; }
  }catch(e){}
  var pages = doc.numPages || 0;
  var coverBlob = null;
  try{
    var page = await doc.getPage(1);
    var scale = 600 / page.getViewport({scale: 1}).width;
    var vp = page.getViewport({scale: scale});
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    await page.render({canvasContext: cv.getContext('2d'), viewport: vp}).promise;
    coverBlob = await new Promise(function(res){ cv.toBlob(res, 'image/webp', 0.85); });
  }catch(e){}
  try{ doc.destroy(); }catch(e){}
  return {title: title || file.name.replace(/\.pdf$/i, ''), author: author, lang: '', coverBlob: coverBlob, pages: pages};
}
async function sha256hex(file){
  var d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.prototype.map.call(new Uint8Array(d), function(x){ return x.toString(16).padStart(2, '0'); }).join('');
}

/* ============ 上传队列 ============ */
var drop = document.getElementById(prefix + '-drop');
var fileInput = document.getElementById(prefix + '-file');
drop.addEventListener('click', function(){ fileInput.click(); });
drop.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fileInput.click(); } });
['dragenter', 'dragover'].forEach(function(ev){ drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add('border-m-primary'); }); });
['dragleave', 'drop'].forEach(function(ev){ drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove('border-m-primary'); }); });
drop.addEventListener('drop', function(e){
  if(e.dataTransfer && e.dataTransfer.files) addFiles(Array.prototype.slice.call(e.dataTransfer.files));
});
fileInput.addEventListener('change', function(){
  /* FileList 是 live 对象：先快照成数组再清空，否则循环会被截断 */
  var fs = Array.prototype.slice.call(fileInput.files);
  fileInput.value = '';
  addFiles(fs);
});

async function addFiles(files){
  for(var i = 0; i < files.length; i++){
    await addFile(files[i]);
  }
}
async function addFile(file){
  var item = {
    uid: 'q' + (++uidSeq), file: file, format: null,
    title: '', author: '', lang: '', tags: '', visibility: 'private', inShelf: false,
    sha256: '', coverBlob: null, coverURL: '', pages: 0,
    status: 'parsing', progress: 0, err: '', existsInfo: null,
    abort: null, uploadId: null, key: null, cancelled: false
  };
  queue.push(item); renderQueue();
  try{
    if(file.size > MAX_MB * 1024 * 1024){ item.status = 'error'; item.err = T.errSize; renderQueue(); return; }
    var chk = await checkMagic(file);
    if(!chk.ok){
      item.status = 'error';
      item.err = chk.why === 'ext' ? T.errExt : (chk.why === 'mimetype' ? T.errMime : T.errMagic);
      renderQueue(); return;
    }
    item.format = chk.format;
    var meta = chk.format === 'EPUB' ? await parseEpub(file) : await parsePdf(file);
    item.title = meta.title; item.author = meta.author; item.lang = meta.lang;
    item.coverBlob = meta.coverBlob; item.pages = meta.pages;
    if(item.coverBlob) item.coverURL = URL.createObjectURL(item.coverBlob);
    item.sha256 = await sha256hex(file);
    item.status = 'ready';
  }catch(e){
    item.status = 'error'; item.err = (e && e.message) || String(e);
  }
  renderQueue();
}

function switchHTML(fid, label, checked){
  return '<label class="flex items-center gap-2 cursor-pointer select-none text-sm text-m-on-surface">' +
    '<input type="checkbox" data-f="' + fid + '"' + (checked ? ' checked' : '') + ' class="peer sr-only">' +
    '<span class="w-10 h-6 rounded-full bg-m-container peer-checked:bg-m-primary relative transition-colors ' +
    'after:content-[\'\'] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4"></span>' +
    '<span>' + esc(label) + '</span></label>';
}
/* One UI 状态徽章：容器色 pill，深色模式跟随 --m-* */
function chipCls(color){
  return 'inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-bold whitespace-nowrap ' + color;
}
function statusChip(item){
  var pct = Math.round(item.progress * 100);
  if(item.status === 'parsing')
    return '<span class="' + chipCls('bg-m-secondary-container text-m-on-secondary-container') + '">' + T.parsing + '</span>';
  if(item.status === 'ready')
    return '<span class="' + chipCls('bg-m-primary-container text-m-on-primary-container') + '">' + T.ready + '</span>';
  if(item.status === 'uploading'){
    var spd = item.speed > 0 ? ' · ' + fmtSpeed(item.speed) : '';
    return '<span class="' + chipCls('bg-m-primary-container text-m-on-primary-container') + '">' + esc(T.uploading(pct) + spd) + '</span>';
  }
  if(item.status === 'done')
    return '<span class="' + chipCls('bg-m-tertiary-container text-m-on-tertiary-container') + '">' + T.done + '</span>';
  if(item.status === 'exists'){
    var t = item.existsInfo && item.existsInfo.title ? '《' + esc(item.existsInfo.title) + '》' : '';
    return '<span class="' + chipCls('bg-m-warm-container text-m-on-warm-container') + '">' + T.exists + '</span>' +
      (t ? '<span class="text-xs text-m-on-surface-variant ml-1.5">' + t + '</span>' : '');
  }
  if(item.status === 'cancelled')
    return '<span class="' + chipCls('bg-m-container text-m-on-surface-variant') + '">' + T.cancelled + '</span>';
  if(item.status === 'error')
    return '<span class="' + chipCls('bg-m-rose-container text-m-on-rose-container') + '">' + T.failed + '</span>';
  return '';
}
function coverThumb(item, sizeCls){
  var inner = item.coverURL
    ? '<img src="' + item.coverURL + '" alt="" class="w-full h-full object-cover">'
    : '<div class="w-full h-full flex items-center justify-center bg-m-container text-m-on-surface-variant text-xl font-extrabold">' + esc(String(item.title || item.file.name).slice(0, 1)) + '</div>';
  return '<div class="' + sizeCls + ' rounded-xl overflow-hidden bg-m-container flex-shrink-0">' + inner + '</div>';
}
/* One UI 按钮：主按钮 / 文本按钮 / 浅色按钮 */
function btnPrimary(qact, label, disabled){
  return '<button type="button" data-qact="' + qact + '"' + (disabled ? ' disabled' : '') +
    ' class="h-10 px-5 rounded-full bg-m-primary text-m-on-primary text-sm font-bold active:scale-[.97] transition-transform disabled:opacity-50">' + label + '</button>';
}
function btnText(qact, label, disabled){
  return '<button type="button" data-qact="' + qact + '"' + (disabled ? ' disabled' : '') +
    ' class="h-10 px-4 rounded-full text-m-primary text-sm font-bold hover:bg-m-primary-container/50 active:scale-[.97] transition-transform disabled:opacity-50">' + label + '</button>';
}
function btnTonal(qact, label, disabled){
  return '<button type="button" data-qact="' + qact + '"' + (disabled ? ' disabled' : '') +
    ' class="h-10 px-5 rounded-full bg-m-secondary-container text-m-on-secondary-container text-sm font-bold active:scale-[.97] transition-transform disabled:opacity-50">' + label + '</button>';
}
function renderQueue(){
  var box = document.getElementById(prefix + '-queue');
  box.innerHTML = queue.map(function(item){
    return item.status === 'done' ? doneCard(item) : queueCard(item);
  }).join('');
}
/* 上传中/待传/失败的队列卡：封面 + 文件信息 + 进度条 + 元数据表单 + 操作按钮 */
function queueCard(item){
  var canEdit = item.status === 'ready' || item.status === 'error' || item.status === 'parsing';
  var field = function(fid, label, val, ph){
    return '<label class="block min-w-0"><span class="text-[11px] font-bold text-m-on-surface-variant">' + esc(label) + '</span>' +
      '<input data-f="' + fid + '" value="' + esc(val) + '" placeholder="' + esc(ph || '') + '"' + (canEdit ? '' : ' disabled') +
      ' class="mt-1 w-full h-10 px-3 rounded-xl bg-m-container text-sm text-m-on-surface outline-none focus:ring-2 focus:ring-m-primary/50 disabled:opacity-60"></label>';
  };
  var actions = '';
  if(item.status === 'ready'){
    actions = btnPrimary('upload', T.upload) + btnText('remove', T.remove);
  }else if(item.status === 'error'){
    actions = btnPrimary('upload', T.retry) + btnText('remove', T.remove);
  }else if(item.status === 'cancelled'){
    actions = btnPrimary('upload', T.upload) + btnText('remove', T.remove);
  }else if(item.status === 'uploading'){
    actions = btnTonal('cancel', T.cancel);
  }
  var prog = item.status === 'uploading'
    ? '<div class="mt-2.5"><div class="h-1.5 rounded-full bg-m-container overflow-hidden" role="progressbar"' +
      ' aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(item.progress * 100) + '">' +
      '<div id="bk-prog-' + item.uid + '" class="h-full rounded-full bg-m-primary transition-[width] duration-300" style="width:' + Math.round(item.progress * 100) + '%"></div></div></div>'
    : '';
  var errLine = (item.status === 'error' && item.err)
    ? '<p class="text-xs text-m-rose font-semibold mt-2 leading-relaxed break-words">' + T.errUpload + esc(item.err) + '</p>'
    : '';
  return '<div class="rounded-[1.75rem] bg-m-container-lowest border border-m-outline/40 p-4 shadow-sm" data-q="' + item.uid + '">' +
    '<div class="flex gap-3">' + coverThumb(item, 'w-12 h-16') +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-sm font-extrabold text-m-on-surface truncate">' + esc(item.file.name) + '</p>' +
        '<p class="text-xs text-m-on-surface-variant mt-0.5">' + esc(item.format || '…') + ' · ' + esc(fmtSize(item.file.size)) + '</p>' +
        '<div class="mt-1.5" data-status="1">' + statusChip(item) + '</div>' +
        prog + errLine +
      '</div>' +
    '</div>' +
    '<div class="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2 mt-3 min-w-0">' +
      field('title', T.title, item.title) + field('author', T.author, item.author) +
      field('lang', T.lang, item.lang) + field('tags', T.tags, item.tags, T.tagsPh) +
    '</div>' +
    '<div class="flex items-center gap-6 mt-3">' +
      switchHTML('vis', item.visibility === 'public' ? T.pub : T.priv, item.visibility === 'public') +
      switchHTML('inShelf', T.inShelf, item.inShelf) +
    '</div>' +
    (actions ? '<div class="flex gap-2 mt-4">' + actions + '</div>' : '') +
  '</div>';
}
/* 上传完成卡：封面 + 书名展示，可补充书名、换封面 */
function doneCard(item){
  var metaLine = [item.author, item.format, fmtSize(item.file.size)].filter(Boolean).join(' · ');
  var editor = '';
  if(item.editing){
    editor = '<div class="mt-3">' +
      '<input data-titleinput value="' + esc(item.title) + '" placeholder="' + esc(T.title) + '"' +
      ' class="w-full h-10 px-3 rounded-xl bg-m-container text-sm text-m-on-surface outline-none focus:ring-2 focus:ring-m-primary/50">' +
      (item.metaErr ? '<p class="text-xs text-m-rose font-semibold mt-2">' + T.saveFail + '：' + esc(item.metaErr) + '</p>' : '') +
      '<div class="flex gap-2 mt-2">' + btnPrimary('savemeta', T.save) + btnText('cancelmeta', T.cancel) + '</div>' +
    '</div>';
  }
  return '<div class="rounded-[1.75rem] bg-m-container-lowest border border-m-tertiary/40 p-4 shadow-sm" data-q="' + item.uid + '">' +
    '<div class="flex gap-3 items-center">' + coverThumb(item, 'w-12 h-16') +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-sm font-extrabold text-m-on-surface truncate">' + esc(item.title || item.file.name) + '</p>' +
        (metaLine ? '<p class="text-xs text-m-on-surface-variant truncate mt-0.5">' + esc(metaLine) + '</p>' : '') +
        '<div class="mt-1.5">' + statusChip(item) + '</div>' +
      '</div>' +
    '</div>' +
    (item.coverErr ? '<p class="text-xs text-m-rose font-semibold mt-2">' + T.saveFail + '：' + esc(item.coverErr) + '</p>' : '') +
    '<div class="flex gap-2 mt-3">' +
      btnTonal('editmeta', T.editMeta, item.coverBusy) + btnText('cover', T.replaceCover, item.coverBusy) +
    '</div>' +
    editor +
    '<input type="file" accept="image/*" data-coverfile class="hidden">' +
  '</div>';
}
function updateProg(item){
  var pct = Math.round(item.progress * 100);
  var el = document.getElementById('bk-prog-' + item.uid);
  if(el){
    el.style.width = pct + '%';
    var track = el.parentElement;
    if(track) track.setAttribute('aria-valuenow', String(pct));
  }
  var st = document.querySelector('[data-q="' + item.uid + '"] [data-status]');
  if(st) st.innerHTML = statusChip(item);
}
document.getElementById(prefix + '-queue').addEventListener('input', function(e){
  var card = e.target.closest('[data-q]'); if(!card) return;
  var item = queue.find(function(q){ return q.uid === card.getAttribute('data-q'); });
  if(!item) return;
  var f = e.target.getAttribute('data-f');
  if(f === 'title') item.title = e.target.value;
  else if(f === 'author') item.author = e.target.value;
  else if(f === 'lang') item.lang = e.target.value;
  else if(f === 'tags') item.tags = e.target.value;
});
document.getElementById(prefix + '-queue').addEventListener('change', function(e){
  var card = e.target.closest('[data-q]'); if(!card) return;
  var item = queue.find(function(q){ return q.uid === card.getAttribute('data-q'); });
  if(!item) return;
  /* 完成卡换封面：选图后压缩 WebP → POST cover → PUT book */
  if(e.target.hasAttribute('data-coverfile')){
    var cf = e.target.files && e.target.files[0];
    e.target.value = '';
    if(cf) replaceCover(item, cf);
    return;
  }
  var f = e.target.getAttribute('data-f');
  if(f === 'vis'){
    item.visibility = e.target.checked ? 'public' : 'private';
    var lbl = e.target.closest('label').querySelector('span:last-child');
    if(lbl) lbl.textContent = e.target.checked ? T.pub : T.priv;
  }else if(f === 'inShelf'){
    item.inShelf = e.target.checked;
  }
});
document.getElementById(prefix + '-queue').addEventListener('click', function(e){
  var btn = e.target.closest('[data-qact]'); if(!btn) return;
  var card = btn.closest('[data-q]');
  var item = queue.find(function(q){ return q.uid === card.getAttribute('data-q'); });
  if(!item) return;
  var act = btn.getAttribute('data-qact');
  if(act === 'upload') uploadItem(item);
  else if(act === 'cancel') cancelItem(item);
  else if(act === 'remove') removeItem(item);
  else if(act === 'editmeta'){
    item.editing = true; item.metaErr = '';
    renderQueue();
    var inp = document.querySelector('[data-q="' + item.uid + '"] [data-titleinput]');
    if(inp){ inp.focus(); try{ inp.select(); }catch(x){} }
  }
  else if(act === 'savemeta') saveMeta(item);
  else if(act === 'cancelmeta'){ item.editing = false; item.metaErr = ''; renderQueue(); }
  else if(act === 'cover'){
    var fi = card.querySelector('[data-coverfile]');
    if(fi) fi.click();
  }
});

/* ============ R2 multipart 上传 ============ */
async function uploadItem(item){
  if(item.status === 'uploading') return;
  item.cancelled = false;
  item.status = 'uploading'; item.progress = 0; item.err = '';
  item.abort = new AbortController();
  var signal = item.abort.signal;
  renderQueue();
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  try{
    /* 会话已死（服务端 abort/过期/404）时自动从 init 重来一次；只重来一次，避免死循环。
       重建时若通行证真失效，init 会返回需授权的 403，走跳授权页逻辑。 */
    var restarted = false;
    for(;;){
      try{
        await uploadAttempt(item, signal, sleep);
        break;
      }catch(e){
        if(e && e.sessionGone && !restarted && !signal.aborted && !item.cancelled){
          item.uploadId = null; item.key = null; item.parts = null;
          restarted = true;
          item.progress = 0; item.speed = 0; updateProg(item);
          continue;
        }
        throw e;
      }
    }
  }catch(e){
    if(signal.aborted || item.cancelled){ item.status = 'cancelled'; }
    else{
      item.status = 'error'; item.err = (e && e.message) || String(e);
      /* 只有纯网络错误保留断点续传状态；其他失败（服务端已 abort/4xx/会话问题）
         清掉续传状态，下次手动重试从 init 重新开始 */
      if(!(e && e.networkOnly)){ item.uploadId = null; item.key = null; item.parts = null; }
    }
    renderQueue();
  }
}
/* 单次上传尝试：init（如需）→ 分片 → 封面 → complete。
   会话类错误抛带 sessionGone 标记的 Error；纯网络错误耗尽重试后抛带 networkOnly 标记的 Error。 */
async function uploadAttempt(item, signal, sleep){
    /* 断点续传：如果已有 uploadId 且有已上传的分片，直接从断点继续，不重新 init。
       网络瞬断不应导致整本失败，而是自动从失败的分片续传。 */
    var canResume = item.uploadId && item.key && item.parts && item.parts.length > 0;
    if(!canResume){
      /* init（含 SHA-256 去重） */
      var initR = await api('/api/admin/upload/init', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: signal,
        body: JSON.stringify({filename: item.file.name, size: item.file.size, sha256: item.sha256, format: item.format.toLowerCase()})
      });
      if(initR.status === 409){
        var j409 = await initR.json().catch(function(){ return {}; });
        item.status = 'exists'; item.existsInfo = j409.book || null;
        renderQueue(); return;
      }
      if(initR.status === 403){
        // 403 按错误码给中文提示；需重新授权的直接跳授权页（带 return）
        var d403 = await window.SgxUploadQueue.describe403(initR, isEn);
        if(d403.reauth){
          item.status = 'error'; item.err = d403.msg; renderQueue();
          item.uploadId = null; item.key = null; item.parts = null; /* 跳授权页前清掉续传状态 */
          window.location.href = window.SgxUploadQueue.appVerifyUrl();
          return;
        }
        throw new Error(d403.msg);
      }
      if(!initR.ok) throw new Error('init HTTP ' + initR.status);
      var init = await initR.json();
      item.uploadId = init.uploadId; item.key = init.key;
      item.parts = [];
    }
    /* 切片上传：4xx 与服务端已中止的错误不重试（重试只会得到 norow，掩盖首次错误）；
       只对网络错误/可重试错误重试；网络错误最多 5 次（指数退避），其他可重试错误最多 3 次；
       错误显示首次错误码并附重试次数 */
    var total = item.file.size, n = Math.max(1, Math.ceil(total / CHUNK));
    var parts = item.parts || [];
    var startIdx = parts.length; /* 断点续传：从已上传分片之后开始 */
    var uploadedBytes = 0, lastTime = Date.now(), lastBytes = 0;
    item.speed = 0;
    var retrySuffix = function(k){ return isEn ? ' (retried ' + k + '×)' : '（已重试' + k + '次）'; };
    for(var i = startIdx; i < n; i++){
      var blob = item.file.slice(i * CHUNK, Math.min(total, (i + 1) * CHUNK));
      var etag = null, firstErrMsg = null, attempts = 0, done = false;
      var isNetErr = false, allNetErr = true;
      while(!done){
        attempts++;
        var pr = null, perr = null;
        isNetErr = false;
        try{
          pr = await api('/api/admin/upload/part?uploadId=' + encodeURIComponent(item.uploadId) +
            '&key=' + encodeURIComponent(item.key) + '&partNumber=' + (i + 1),
            {method: 'POST', body: blob, signal: signal});
        }catch(netErr){
          if(signal.aborted) throw netErr;
          /* 网络错误：可重试 */
          isNetErr = true;
          perr = { msg: (netErr && netErr.message) || 'network error', retryable: true, reauth: false, sessionGone: false };
        }
        if(pr){
          if(pr.ok){
            var pj = await pr.json();
            etag = pj.etag; done = true; continue;
          }
          perr = await window.SgxUploadQueue.describePartError(pr, i + 1, isEn);
          allNetErr = false;
          if(perr.reauth){
            /* 需要重新授权：清掉续传状态再跳授权页 */
            item.uploadId = null; item.key = null; item.parts = null;
            window.location.href = window.SgxUploadQueue.appVerifyUrl();
            throw new Error(perr.msg);
          }
          if(perr.sessionGone){
            /* 会话已不存在：不重试，抛标记错误由外层自动从 init 重来一次 */
            var sgErr = new Error(perr.msg);
            sgErr.sessionGone = true;
            throw sgErr;
          }
        }
        if(!firstErrMsg) firstErrMsg = perr.msg;
        /* 网络错误最多 5 次（指数退避 0.8s/1.6s/3.2s/6.4s），其他可重试错误最多 3 次 */
        var maxAttempts = isNetErr ? 5 : 3;
        if(!perr.retryable || attempts >= maxAttempts){
          /* 不可重试，或已达上限：抛首次错误（附重试次数） */
          var finErr = new Error(firstErrMsg + (attempts > 1 ? retrySuffix(attempts - 1) : ''));
          if(allNetErr) finErr.networkOnly = true; /* 纯网络错误：保留断点续传状态 */
          throw finErr;
        }
        await sleep(800 * Math.pow(2, attempts - 1));
      }
      if(!done) throw new Error(firstErrMsg || 'part failed');
      parts.push({partNumber: i + 1, etag: etag});
      item.parts = parts; /* 持久化已上传分片，支持断点续传 */
      uploadedBytes += blob.size;
      var now = Date.now(), dt = (now - lastTime) / 1000;
      if(dt >= 1){
        item.speed = (uploadedBytes - lastBytes) / dt;
        lastTime = now; lastBytes = uploadedBytes;
      }
      item.progress = ((i + 1) / n) * 0.9;
      updateProg(item);
    }
    /* 封面（WebP 宽 600）：key 为 covers/<uuid>.webp，uuid 取自文件 key */
    var coverKey = null;
    if(item.coverBlob){
      var _uuid = item.key.slice('books/'.length, item.key.lastIndexOf('.'));
      var cr = await api('/api/admin/cover?key=' + encodeURIComponent('covers/' + _uuid + '.webp'),
        {method: 'POST', body: item.coverBlob, headers: {'Content-Type': 'image/webp'}, signal: signal});
      if(cr.status === 403){
        var cd403 = await window.SgxUploadQueue.describe403(cr, isEn);
        if(cd403.reauth){
          item.uploadId = null; item.key = null; item.parts = null; /* 跳授权页前清掉续传状态 */
          window.location.href = window.SgxUploadQueue.appVerifyUrl();
        }
        throw new Error(cd403.msg);
      }
      if(!cr.ok) throw new Error('cover HTTP ' + cr.status);
      coverKey = (await cr.json()).key || null;
    }
    item.progress = 0.95; updateProg(item);
    /* complete */
    var meta = {
      title: item.title, author: item.author, lang: item.lang,
      tags: item.tags.split(/[,，]/).map(function(s){ return s.trim(); }).filter(Boolean),
      visibility: item.visibility, in_shelf: item.inShelf ? 1 : 0, coverKey: coverKey
    };
    var cr2 = await api('/api/admin/upload/complete', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, signal: signal,
      body: JSON.stringify({uploadId: item.uploadId, key: item.key, parts: parts, sha256: item.sha256, meta: meta})
    });
    if(cr2.status === 403){
      var c2d403 = await window.SgxUploadQueue.describe403(cr2, isEn);
      if(c2d403.reauth){
        item.uploadId = null; item.key = null; item.parts = null; /* 跳授权页前清掉续传状态 */
        window.location.href = window.SgxUploadQueue.appVerifyUrl();
      }
      throw new Error(c2d403.msg);
    }
    if(!cr2.ok) throw new Error('complete HTTP ' + cr2.status);
    var done = await cr2.json();
    item.status = 'done'; item.progress = 1;
    item.parts = null; /* 上传完成，清理断点续传状态 */
    item.coverKey = coverKey;
    item.book = {
      id: done.id, title: item.title, author: item.author, lang: item.lang,
      format: item.format, size: item.file.size, sha256: item.sha256,
      cover_key: coverKey, pages: item.pages, tags: meta.tags,
      visibility: item.visibility, in_shelf: item.inShelf ? 1 : 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
    renderQueue();
    /* 传完不刷新：交给 onBookAdded 回调（管理页 prepend / 书架页刷新），不直接碰页面列表 */
    (opts.onBookAdded || function(){}).call(null, item.book);
    var it = item;
    setTimeout(function(){
      queue = queue.filter(function(q){ return q !== it; });
      renderQueue();
    }, 2500);
}
async function cancelItem(item){
  item.cancelled = true;
  if(item.abort) try{ item.abort.abort(); }catch(e){}
  if(item.uploadId && item.key){
    try{
      await api('/api/admin/upload/abort', {method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({uploadId: item.uploadId, key: item.key})});
    }catch(e){}
  }
  item.status = 'cancelled';
  item.parts = null; item.uploadId = null; /* 取消后会话已 abort，清理断点续传状态 */
  renderQueue();
}
/* 从队列移除（上传中只能先取消） */
function removeItem(item){
  if(item.status === 'uploading') return;
  if(item.coverURL){ try{ URL.revokeObjectURL(item.coverURL); }catch(e){} }
  queue = queue.filter(function(q){ return q !== item; });
  renderQueue();
}
/* 完成卡：补充/修改书名 → PUT /api/admin/book */
async function saveMeta(item){
  var input = document.querySelector('[data-q="' + item.uid + '"] [data-titleinput]');
  var title = input ? String(input.value).trim() : item.title;
  if(!title || !item.book){ item.editing = false; renderQueue(); return; }
  item.editing = false; item.metaErr = '';
  renderQueue();
  try{
    var r = await api('/api/admin/book?id=' + encodeURIComponent(item.book.id),
      {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: title})});
    if(r.status === 403){
      var md403 = await window.SgxUploadQueue.describe403(r, isEn);
      if(md403.reauth){
        window.location.href = window.SgxUploadQueue.appVerifyUrl();
      }
      throw new Error(md403.msg);
    }
    if(!r.ok) throw new Error('HTTP ' + r.status);
    item.title = title; item.book.title = title; item.book.updated_at = new Date().toISOString();
    (opts.onBookUpdated || function(){}).call(null, item.book);
  }catch(e){
    item.editing = true;
    item.metaErr = (e && e.message) || String(e);
  }
  renderQueue();
}
/* 完成卡：换封面 → 压 WebP 600 → POST /api/admin/cover → PUT book */
async function replaceCover(item, file){
  if(!item.book || !item.key) return;
  item.coverBusy = true; item.coverErr = '';
  renderQueue();
  try{
    var webp = await toWebp600(file);
    /* key 沿用上传时的 covers/<uuid>.webp（uuid 取自文件 key） */
    var uuid = item.key.slice('books/'.length, item.key.lastIndexOf('.'));
    var r = await api('/api/admin/cover?key=' + encodeURIComponent('covers/' + uuid + '.webp'),
      {method: 'POST', body: webp, headers: {'Content-Type': 'image/webp'}});
    if(r.status === 403){
      var rd403 = await window.SgxUploadQueue.describe403(r, isEn);
      if(rd403.reauth){
        window.location.href = window.SgxUploadQueue.appVerifyUrl();
      }
      throw new Error(rd403.msg);
    }
    if(!r.ok) throw new Error('cover HTTP ' + r.status);
    var key = (await r.json()).key;
    var r2 = await api('/api/admin/book?id=' + encodeURIComponent(item.book.id),
      {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({coverKey: key})});
    if(!r2.ok) throw new Error('put HTTP ' + r2.status);
    if(item.coverURL){ try{ URL.revokeObjectURL(item.coverURL); }catch(e2){} }
    item.coverBlob = webp;
    item.coverURL = (window.URL && URL.createObjectURL) ? URL.createObjectURL(webp) : item.coverURL;
    item.coverKey = key;
    item.book.cover_key = key; item.book.updated_at = new Date().toISOString();
    (opts.onBookUpdated || function(){}).call(null, item.book);
  }catch(e){
    item.coverErr = (e && e.message) || String(e);
  }
  item.coverBusy = false;
  renderQueue();
}
// Expose helpers for admin management UI
window.SgxUploadQueue.helpers = function(isEn){
  "use strict";
  var T = {
    title: isEn ? 'Title' : '书名',
    author: isEn ? 'Author' : '作者',
    lang: isEn ? 'Language' : '语言',
    tags: isEn ? 'Tags' : '标签',
    tagsPh: isEn ? 'Comma separated' : '逗号分隔',
    pub: isEn ? 'Public' : '公开',
    priv: isEn ? 'Private' : '私有',
    inShelf: isEn ? 'Feature in shelf' : '放进书单',
    upload: isEn ? 'Upload' : '上传',
    cancel: isEn ? 'Cancel' : '取消',
    retry: isEn ? 'Retry' : '重试',
    parsing: isEn ? 'Parsing…' : '解析中…',
    ready: isEn ? 'Ready to upload' : '就绪，可上传',
    uploading: function(p){ return (isEn ? 'Uploading ' : '上传中 ') + p + '%'; },
    done: isEn ? 'Done' : '已完成',
    exists: isEn ? 'Already exists — skipped' : '已存在，已跳过',
    errMagic: isEn ? 'Invalid file header (not a real EPUB/PDF)' : '文件头校验失败（不是有效的 EPUB/PDF）',
    errMime: isEn ? 'Not a valid EPUB (mimetype missing)' : '不是有效的 EPUB（缺少 mimetype）',
    errExt: isEn ? 'Only .epub / .pdf accepted' : '仅接受 .epub / .pdf',
    errSize: isEn ? 'File too large (max 500 MB)' : '文件过大（上限 500MB）',
    errUpload: isEn ? 'Upload failed: ' : '上传失败：',
    cancelled: isEn ? 'Cancelled' : '已取消',
    stats: function(n, s){ return isEn ? (n + ' books · ' + s + ' used') : ('共 ' + n + ' 本 · 已用 ' + s); },
    editInfo: isEn ? 'Edit info' : '编辑信息',
    replaceCover: isEn ? 'Replace cover' : '换封面',
    del: isEn ? 'Delete' : '删除',
    edit: isEn ? 'Edit' : '编辑',
    delConfirm: function(t){ return isEn ? ('Delete "' + t + '"?\nThis removes the file, cover and database record.') : ('确定删除《' + t + '》吗？\n将同时删除 R2 文件、封面和数据库记录。'); },
    delFail: isEn ? 'Delete failed' : '删除失败',
    saveFail: isEn ? 'Save failed' : '保存失败',
    shelf: isEn ? 'Shelf' : '书单'
  };
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function fmtSize(b){
    b = Number(b) || 0;
    if(b < 1024) return b + ' B';
    if(b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if(b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  function fmtDate(s){
    if(!s) return '—';
    try{ return new Date(s).toLocaleDateString(isEn ? 'en-US' : 'zh-CN'); }
    catch(e){ return '—'; }
  }
  function api(path, opts){
    opts = opts || {};
    opts.credentials = 'same-origin';
    return fetch(path, opts).then(function(res){
      checkAppAuth(res);
      return res;
    });
  }
  return {T: T, esc: esc, fmtSize: fmtSize, fmtDate: fmtDate, api: api,
    toWebp600: toWebp600, switchHTML: switchHTML};
};
/* 测试钩子：tests/upload-resume.test.mjs 用 mock fetch 驱动真实上传流程做行为测试。
   仅当 window.__sgxUploadTest 已设置时生效，生产环境无影响。 */
if(window.__sgxUploadTest){
  window.__sgxUploadTest.uploadItem = uploadItem;
  window.__sgxUploadTest.items = function(){ return queue; };
}
};
