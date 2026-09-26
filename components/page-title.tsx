"use client";

import { usePathname } from "next/navigation";
import type { NavGroup, NavItem } from "@/components/nav-links";
import { UiIcon, routeIcon } from "@/components/ui-icon";

const descriptions: Record<string, string> = {
  "/dashboard": "让每一次积累，都成为下一次灵感的起点。",
  "/knowledge": "整理、连接与发现，让知识持续生长。",
  "/graph": "沿着关联，发现知识之间的新路径。",
  "/sources": "保留原始出处，让每一条知识有迹可循。",
  "/trash": "查看已删除的知识，需要时可以恢复。",
  "/ask": "从你的积累中，找到有依据的答案。",
  "/quality": "发现问题，完善内容，构建可信的知识库。",
  "/reviews": "逐项审阅建议，让每一次变更由你决定。",
  "/stats": "了解知识积累、检索表现与服务使用情况。",
  "/logs": "回看检索与调用记录，掌握每一次交互。",
  "/version": "了解当前版本，以及知识库的演进。",
  "/users": "管理账户与权限，共享有边界的知识空间。",
  "/settings": "管理个人偏好、访问密钥与数据迁移。",
};

export function PageTitle({ overview, groups }: { overview: NavItem; groups: NavGroup[] }) {
  const pathname = usePathname();
  const active = [overview, ...groups.flatMap((group) => group.items)].find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );
  if (!active) return null;
  const group = groups.find((g) => g.items.some((item) => item.href === active.href));
  return (
    <div data-testid="page-title" className="page-heading mb-7 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="mb-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400"><UiIcon name={routeIcon(active.href)} />个人工作台<span aria-hidden="true">/</span>{group?.label ?? "概览"}</p>
        <h1 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">{active.href === "/dashboard" ? "知识概览" : active.label}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{descriptions[active.href]}</p>
      </div>
      <span className="mt-1 hidden rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] tracking-wide text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 sm:block">我的知识空间</span>
    </div>
  );
}
