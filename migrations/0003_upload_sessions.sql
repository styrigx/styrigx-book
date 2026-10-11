-- 0003: upload_sessions 表（书架 FAB 上传）。
-- init 成功后记录 uploadId（绑定创建时的 sgx-app epoch）；
-- part / complete / abort 只验 owner + 会话（存在、2 小时内、epoch 未变），否则 403。
-- 这样 sgx-app（10 分钟有效期）过期不会导致大文件分片中途 403。
CREATE TABLE IF NOT EXISTS upload_sessions (
  upload_id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  app_epoch INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
