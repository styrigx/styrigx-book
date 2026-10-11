-- 0004: upload_sessions.app_epoch 列（2.10.0 应用纪元）。
-- 语义变更：该列从「建会话时的 session epoch」改为「建会话时的 app epoch」。
-- init 写入 sgx-app 的 appEpoch；part/complete/abort 校验 app_epoch >= 主站当前 app.book，
-- 删除该应用任一应用类通行密钥时主站把 app-epoch:<aud> 加一，进行中的上传任务被掐断。
-- 注意：0003 建表时已包含 app_epoch 列；此迁移为幂等补写，仅用于从 0003 之前版本升级的库。
-- 不要手动 apply，由所有者决定执行时机。
ALTER TABLE upload_sessions ADD COLUMN app_epoch INTEGER NOT NULL DEFAULT 0;
