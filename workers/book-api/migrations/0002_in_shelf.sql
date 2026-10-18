-- 0002: books 表新增 in_shelf 字段（主站书单展示开关，1=上架到主站书单）。
-- 注：schema.sql 的建表语句已包含该字段；此迁移仅用于已按旧 schema 建表的 D1 实例。
-- D1 的 ALTER TABLE 不支持 IF NOT EXISTS，对已含该字段的表重复执行会报错，属预期行为。
ALTER TABLE books ADD COLUMN in_shelf INTEGER DEFAULT 0;
