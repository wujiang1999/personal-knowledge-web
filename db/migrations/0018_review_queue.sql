-- 冲突/近似重复审核队列（2026-09-10）：把「写路径被拦下的内容」从一次性报告
-- 变成持久收件箱。
--
-- 此前三处治理共用一个缺口——发现相似/冲突之后无处安放：
--   · ingest CLI 的近似重复直接跳过，只打印一行，重跑即遗忘；
--   · OKF 导入的同名异内容冲突只活在返回给浏览器的那一份报告里；
--   · MCP 写路径判出 conflict / merge_suggestion 后只把候选回给 agent。
-- 「人工裁决」喊了很久，却没有真正的入口。本表就是那个入口：一行 = 一份完整
-- 待裁决内容（payload）+ 它撞上的目标条目 + 触发来源与相似度信号。
--
-- 不变量：
-- 1) payload 存 ConceptInput 形态的完整正文（jsonb），裁决时无需回查原始来源；
-- 2) target_concept_id 用 ON DELETE SET NULL：目标被彻底删除后记录仍在，
--    target_title 快照保证历史可读（与 sources 的审计行同一取舍）；
-- 3) 裁决不改写任何历史——adopted_new / merged 走 addConceptVersion 生成新版本，
--    kept_both 走 createConcept 建新条目，kept_old 只落状态；
-- 4) 待裁决集合按 (owner, 目标, 正文哈希) 去重，重复 ingest 不会把队列灌满。

CREATE TABLE IF NOT EXISTS review_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                text NOT NULL,                      -- conflict | near_duplicate
  source              text NOT NULL,                      -- ingest | okf-import | mcp | api
  status              text NOT NULL DEFAULT 'pending',    -- pending | resolved
  title               text NOT NULL,                      -- 待裁决内容的标题（快照）
  payload             jsonb NOT NULL,                     -- {type,title,description,category,tags,status,body}
  content_hash        text NOT NULL,                      -- sha256:… of payload.body
  target_concept_id   uuid REFERENCES concepts(id) ON DELETE SET NULL,
  target_title        text,                               -- 目标条目标题快照
  similarity          real,                               -- 余弦相似度（语义检索命中时）
  score               real,                               -- 词法/融合检索分（BM25 尺度）
  reason              text,                               -- 判别器给出的理由
  resolved_action     text,                               -- kept_old | adopted_new | merged | kept_both
  resolved_concept_id uuid REFERENCES concepts(id) ON DELETE SET NULL,
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 待裁决列表（/reviews 首屏）与已裁决历史各一条部分索引：两张列表都是
-- 「先按状态过滤、再按时间倒序」，部分索引让各自的扫描面互不干扰。
CREATE INDEX IF NOT EXISTS idx_review_items_pending
  ON review_items (owner_id, created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_review_items_resolved
  ON review_items (owner_id, resolved_at DESC) WHERE status = 'resolved';

-- 并发兜底：两个入口同时把同一份内容撞到同一条目时，只留一行待裁决记录。
-- 目标为 NULL 的行不在此索引覆盖范围（PG 视 NULL 互不相等），那一路由
-- enqueueReview 的 WHERE NOT EXISTS 守卫处理。两边都是「重复即忽略」，
-- 队列宁可少一行，也不会因为一次重跑而重复。
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_items_dedupe
  ON review_items (owner_id, content_hash, target_concept_id) WHERE status = 'pending';
