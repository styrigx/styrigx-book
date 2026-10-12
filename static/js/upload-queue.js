/* Shared upload queue (extracted from admin.html). Init with SgxUploadQueue.init(prefix, {isEn, onBookAdded}) */
window.SgxUploadQueue = window.SgxUploadQueue || {};

/* ---- 通行证 403 分类（顶层：FAB 预检与队列共用） ----
   只有 error 为 app-token-required / app-token-invalid 时才跳主站复验；
   其他 403（visitor / 会话失效 / 上传会话无效）走原有逻辑，不跳。 */
window.SgxUploadQueue.appVerifyUrl = function(){
  return 'https://styrigx.com/app-verify/?aud=book&scope=upload&return=' + encodeURIComponent(window.location.href);
};
window.SgxUploadQueue.appTokenErrorCode = async function(res){
  if(!res || res.status !== 403) return null;
  try{
    var j = await res.clone().json();
    var e = j && j.error;
    if(e === 'app-token-required' || e === 'app-token-invalid') return e;
  }catch(x){}
  return null;
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

/* 上传中途被拒：先提示「需要重新验证，已完成的不受影响」，用户点确认后再跳，不直接 location.href */
async function confirmReauth(){
  var msg = isEn ? 'Re-verification needed. Completed uploads are not affected. Go to verify now?'
                 : '需要重新验证，已完成的不受影响，现在去验证吗？';
  if(window.confirm(msg)){
    window.location.href = window.SgxUploadQueue.appVerifyUrl();
    return true;
  }
  return false;
}
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
  try{
    var bmp = await createImageBitmap(blob);
    var w = 600, h = Math.max(1, Math.round(bmp.height * (600 / bmp.width)));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if(bmp.close) bmp.close();
    return await new Promise(function(res){ cv.toBlob(res, 'image/webp', 0.85); });
  }catch(e){ return blob; }
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
function statusText(item){
  if(item.status === 'parsing') return '<span class="text-m-on-surface-variant">' + T.parsing + '</span>';
  if(item.status === 'ready') return '<span class="text-m-tertiary">' + T.ready + '</span>';
  if(item.status === 'uploading'){
    var pct = Math.round(item.progress * 100);
    var spd = item.speed > 0 ? ' · ' + fmtSpeed(item.speed) : '';
    return '<span class="text-m-primary">' + T.uploading(pct) + spd + '</span>';
  }
  if(item.status === 'done') return '<span class="text-m-tertiary font-bold">' + T.done + '</span>';
  if(item.status === 'exists'){
    var t = item.existsInfo && item.existsInfo.title ? '《' + esc(item.existsInfo.title) + '》' : '';
    return '<span class="text-m-warm font-bold">' + T.exists + ' ' + t + '</span>';
  }
  if(item.status === 'cancelled') return '<span class="text-m-on-surface-variant">' + T.cancelled + '</span>';
  if(item.status === 'error') return '<span class="text-red-500 font-semibold">' + T.errUpload + esc(item.err) + '</span>';
  return '';
}
function renderQueue(){
  var box = document.getElementById(prefix + '-queue');
  box.innerHTML = queue.map(function(item){
    var cover = item.coverURL
      ? '<img src="' + item.coverURL + '" alt="" class="w-full h-full object-cover">'
      : '<div class="w-full h-full flex items-center justify-center bg-m-container text-m-on-surface-variant text-xl font-extrabold">' + esc(String(item.title || item.file.name).slice(0, 1)) + '</div>';
    var canEdit = item.status === 'ready' || item.status === 'error' || item.status === 'parsing';
    var field = function(fid, label, val, ph){
      return '<label class="block min-w-0"><span class="text-[11px] font-bold text-m-on-surface-variant">' + esc(label) + '</span>' +
        '<input data-f="' + fid + '" value="' + esc(val) + '" placeholder="' + esc(ph || '') + '"' + (canEdit ? '' : ' disabled') +
        ' class="mt-1 w-full h-10 px-3 rounded-xl bg-m-container text-sm text-m-on-surface outline-none focus:ring-2 focus:ring-m-primary/50 disabled:opacity-60"></label>';
    };
    var actions = '';
    if(item.status === 'ready' || item.status === 'error' || item.status === 'cancelled'){
      actions = '<button type="button" data-qact="upload" class="h-9 px-4 rounded-full bg-m-primary text-m-on-primary text-xs font-bold">' + T.upload + '</button>';
    }else if(item.status === 'uploading'){
      actions = '<button type="button" data-qact="cancel" class="h-9 px-4 rounded-full bg-m-container text-m-on-surface text-xs font-bold">' + T.cancel + '</button>';
    }
    return '<div class="rounded-2xl bg-m-container-lowest border border-m-outline/40 p-4" data-q="' + item.uid + '">' +
      '<div class="flex gap-3">' +
        '<div class="w-14 h-[84px] rounded-lg overflow-hidden bg-m-container flex-shrink-0">' + cover + '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<p class="text-sm font-bold truncate">' + esc(item.file.name) + '</p>' +
          '<p class="text-xs text-m-on-surface-variant mt-0.5">' + esc(item.format || '…') + ' · ' + esc(fmtSize(item.file.size)) + '</p>' +
          '<div class="mt-2 h-2 rounded-full bg-m-container overflow-hidden' + (item.status === 'uploading' ? '' : ' hidden') + '">' +
            '<div id="bk-prog-' + item.uid + '" class="h-full rounded-full bg-m-primary" style="width:' + Math.round(item.progress * 100) + '%"></div></div>' +
          '<p class="text-xs mt-1.5" data-status="1">' + statusText(item) + '</p>' +
        '</div>' +
        '<div class="flex flex-col gap-1.5 flex-shrink-0">' + actions + '</div>' +
      '</div>' +
      '<div class="grid grid-cols-2 gap-2 mt-3">' +
        field('title', T.title, item.title) + field('author', T.author, item.author) +
        field('lang', T.lang, item.lang) + field('tags', T.tags, item.tags, T.tagsPh) +
      '</div>' +
      '<div class="flex items-center gap-6 mt-3">' +
        switchHTML('vis', item.visibility === 'public' ? T.pub : T.priv, item.visibility === 'public') +
        switchHTML('inShelf', T.inShelf, item.inShelf) +
      '</div>' +
    '</div>';
  }).join('');
}
function updateProg(item){
  var el = document.getElementById('bk-prog-' + item.uid);
  if(el) el.style.width = Math.round(item.progress * 100) + '%';
  var card = document.querySelector('[data-q="' + item.uid + '"] [data-status]');
  if(card) card.innerHTML = statusText(item);
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
      // 通行证问题 → 先提示再跳；其他 403 走原有错误逻辑
      if(await window.SgxUploadQueue.appTokenErrorCode(initR)){
        await confirmReauth();
        item.status = 'error'; item.err = T.needReauth; renderQueue(); return;
      }
      throw new Error('init HTTP 403');
    }
    if(!initR.ok) throw new Error('init HTTP ' + initR.status);
    var init = await initR.json();
    item.uploadId = init.uploadId; item.key = init.key;
    /* 切片上传，每片失败重试 3 次 */
    var total = item.file.size, n = Math.max(1, Math.ceil(total / CHUNK));
    var parts = [];
    var uploadedBytes = 0, lastTime = Date.now(), lastBytes = 0;
    item.speed = 0;
    for(var i = 0; i < n; i++){
      var blob = item.file.slice(i * CHUNK, Math.min(total, (i + 1) * CHUNK));
      var etag = null, lastErr = null;
      for(var a = 0; a < 3; a++){
        try{
          var pr = await api('/api/admin/upload/part?uploadId=' + encodeURIComponent(item.uploadId) +
            '&key=' + encodeURIComponent(item.key) + '&partNumber=' + (i + 1),
            {method: 'POST', body: blob, signal: signal});
          if(pr.status === 403){
            // 通行证问题不重试：先提示，用户确认后再跳
            if(await window.SgxUploadQueue.appTokenErrorCode(pr)){
              await confirmReauth();
              throw new Error(T.needReauth);
            }
            throw new Error('part ' + (i + 1) + ' HTTP 403');
          }
          if(!pr.ok) throw new Error('part ' + (i + 1) + ' HTTP ' + pr.status);
          var pj = await pr.json();
          etag = pj.etag; lastErr = null; break;
        }catch(e){
          lastErr = e;
          if(signal.aborted) throw e;
          await sleep(800 * (a + 1));
        }
      }
      if(etag == null) throw lastErr || new Error('part failed');
      parts.push({partNumber: i + 1, etag: etag});
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
      if(cr.status === 403 && await window.SgxUploadQueue.appTokenErrorCode(cr)){
        await confirmReauth();
        throw new Error(T.needReauth);
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
    if(cr2.status === 403 && await window.SgxUploadQueue.appTokenErrorCode(cr2)){
      await confirmReauth();
      throw new Error(T.needReauth);
    }
    if(!cr2.ok) throw new Error('complete HTTP ' + cr2.status);
    var done = await cr2.json();
    item.status = 'done'; item.progress = 1;
    renderQueue();
    /* 传完不刷新：直接 prepend 到管理列表 */
    (opts.onBookAdded || function(){}).call(null, {
      id: done.id, title: item.title, author: item.author, lang: item.lang,
      format: item.format, size: item.file.size, sha256: item.sha256,
      cover_key: coverKey, pages: item.pages, tags: meta.tags,
      visibility: item.visibility, in_shelf: item.inShelf ? 1 : 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    renderList(); renderStats();
    var it = item;
    setTimeout(function(){
      queue = queue.filter(function(q){ return q !== it; });
      renderQueue();
    }, 2500);
  }catch(e){
    if(signal.aborted || item.cancelled){ item.status = 'cancelled'; }
    else{ item.status = 'error'; item.err = (e && e.message) || String(e); }
    renderQueue();
  }
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
  return {T: T, esc: esc, fmtSize: fmtSize, fmtDate: fmtDate, api: api};
};
};
