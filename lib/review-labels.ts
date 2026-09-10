/** 审核队列的展示文案（纯常量，服务端与客户端同源）。
 *
 * 刻意放在独立模块而不是客户端组件里：`"use client"` 模块的导出在服务端
 * 渲染时是「客户端引用」而不是值，页面直接读 `REVIEW_ACTION_LABEL[key]` 只会
 * 拿到 undefined 并回落到原始英文 key（2026-09-10 线上实测发现的渲染缺陷）。
 * 与 `lib/attachment-mime.ts` 同一取舍：两侧共用一份、不 import 任何运行时。 */

export const REVIEW_ACTION_LABEL: Record<string, string> = {
  kept_old: "保留旧内容",
  adopted_new: "采用新内容",
  merged: "合并",
  kept_both: "分别保留",
};

export const REVIEW_KIND_LABEL: Record<string, string> = {
  conflict: "事实冲突",
  near_duplicate: "近似重复",
};

export const REVIEW_SOURCE_LABEL: Record<string, string> = {
  ingest: "ingest",
  "okf-import": "OKF 导入",
  mcp: "Agent 写入",
  api: "API",
};
