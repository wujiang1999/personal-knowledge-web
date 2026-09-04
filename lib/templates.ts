/** Body skeletons for the create form's template picker (Obsidian templates
 * pattern, adapted: frontmatter-equivalent fields live in the form — type,
 * category, tags, status — so templates only fill the body). Create-mode
 * only; applying appends, never overwrites existing content. */
export interface BodyTemplate {
  id: string;
  label: string;
  /** Suggested value for the type field when applying. */
  type: string;
  body: string;
}

export const BODY_TEMPLATES: BodyTemplate[] = [
  {
    id: "decision",
    label: "决策记录",
    type: "Decision",
    body: "## 背景\n\n## 备选方案\n\n## 决定\n\n## 理由\n\n## 影响与后续\n",
  },
  {
    id: "booknote",
    label: "书摘笔记",
    type: "Reference",
    body: "## 出处\n\n（书名 · 章节）\n\n## 摘录\n\n> \n\n## 要点\n\n- \n\n## 我的想法\n\n",
  },
  {
    id: "tech",
    label: "技术方案",
    type: "Technical Note",
    body: "## 问题\n\n## 方案\n\n## 权衡\n\n## 验证\n",
  },
  {
    id: "procedure",
    label: "操作手册",
    type: "Procedure",
    body: "## 前置条件\n\n## 步骤\n\n1. \n\n## 验证\n\n## 常见问题\n",
  },
  {
    id: "meeting",
    label: "会议纪要",
    type: "Note",
    body: "## 参会\n\n## 议题\n\n## 结论\n\n## 待办\n\n- [ ] \n",
  },
];
