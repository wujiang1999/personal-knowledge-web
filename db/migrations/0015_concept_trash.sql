-- 回收站（软删除）：DELETE 语义改为标记 deleted_at，版本/附件/来源全部保留，
-- 只有回收站里的「彻底删除」才走原 CASCADE 路径。对齐知识库规划 P0 验收项：
-- 「删除或归档后不会继续被默认检索」「编辑错误要能恢复」。

ALTER TABLE concepts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 默认可见面（列表/搜索/图谱/导出/链接网络）一律过滤 deleted_at IS NULL；
-- 部分索引让"几乎从不过回收站"的热路径查询不受影响。
CREATE INDEX IF NOT EXISTS idx_concepts_alive_owner_updated
  ON concepts (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_concepts_trash
  ON concepts (owner_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
