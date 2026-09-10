-- 异步任务表（2026-09-10）：把「比一次请求更久的活」从请求生命周期里拿出来。
--
-- 触发它的第一个真实生产者是知识问答（/ask）：检索 + LLM 合成答复要 5-30 秒，
-- 塞进一个 HTTP 请求既撞网关/浏览器超时，也没法让用户离开页面后再回来取结果。
-- 任务表提供的是**可轮询的持久记录**：入队 → 进程内执行 → 状态与结果落库 →
-- 客户端按 id 轮询；顺带成了问答历史。
--
-- 单实例的诚实取舍（与搜索缓存/登录限流/语义探测同类，见 docs/ARCHITECTURE）：
-- 没有独立 worker，执行者是 fire-and-forget 的进程内异步（与自动摘要、用量
-- 日志同一套约定）。进程消失则任务停在 running —— 因此设**执行租约**：
-- 超过租约仍未结束的任务在下一次读取时被判为 failed，绝不会永远显示"进行中"。
-- 自动重试本批不做：问答不写知识库，重试的唯一收益是绕过一次偶发失败，而
-- "让用户重问一次"更简单也更诚实（attempts 列记录执行者是否真的启动过）。
--
-- 重复提交由 /api/ask 的"同一问题在飞行中则复用该任务"挡掉，不需要 idempotency
-- 键列：重复提交的真实来源是双击与客户端重试，都带着同一个问题。

CREATE TABLE IF NOT EXISTS tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,                      -- ask（知识问答）
  status      text NOT NULL DEFAULT 'queued',     -- queued | running | done | failed
  payload     jsonb NOT NULL,                     -- 输入（ask: {question, k}）
  result      jsonb,                              -- 输出（ask: {answer, citations, sources, model, tookMs}）
  error       text,
  attempts    int NOT NULL DEFAULT 0,             -- 执行者领取次数（0 = 从未启动）
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz
);

-- 历史列表：按 owner 倒序分页。
CREATE INDEX IF NOT EXISTS idx_tasks_owner_created ON tasks (owner_id, created_at DESC);
-- 租约清理与"同问题在飞行中"探测都只关心未结束的任务；部分索引让这两条
-- 查询在任务量大时也只看活动集。
CREATE INDEX IF NOT EXISTS idx_tasks_live ON tasks (status, coalesce(started_at, created_at));
