import { requireUser } from "@/lib/requireUser";
import { countReviewItems } from "@/lib/reviews";
import { LogoutButton } from "@/components/logout-button";
import { GroupedNavLinks, type NavGroup, type NavItem } from "@/components/nav-links";
import { ResizableAppShell } from "@/components/resizable-sidebar";
import { PageTitle } from "@/components/page-title";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileNavigation } from "@/components/mobile-navigation";

const overview: NavItem = { href: "/dashboard", label: "概览" };

const baseGroups: NavGroup[] = [
  {
    id: "knowledge",
    label: "知识管理",
    items: [
      { href: "/knowledge", label: "知识" },
      { href: "/graph", label: "图谱" },
      { href: "/sources", label: "来源" },
      { href: "/trash", label: "回收站" },
    ],
  },
  {
    id: "workflow",
    label: "智能工作流",
    items: [
      { href: "/ask", label: "问答" },
      { href: "/quality", label: "质检" },
      { href: "/reviews", label: "审核" },
    ],
  },
  {
    id: "audit",
    label: "数据与审计",
    items: [
      { href: "/stats", label: "统计" },
      { href: "/logs", label: "记录" },
      { href: "/version", label: "版本" },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const pendingReviews = await countReviewItems(user, { status: "pending" });
  const systemItems: NavItem[] = [
    ...(user.role === "admin" ? [{ href: "/users", label: "账户" }] : []),
    { href: "/settings", label: "设置" },
  ];
  const groups: NavGroup[] = [
    ...baseGroups.map((group) =>
      group.id === "workflow"
        ? {
            ...group,
            items: group.items.map((item) =>
              item.href === "/reviews" ? { ...item, badge: pendingReviews } : item
            ),
          }
        : group
    ),
    { id: "system", label: "系统管理", items: systemItems },
  ];

  return (
    <ResizableAppShell
      navigation={<GroupedNavLinks overview={overview} groups={groups} />}
      footer={
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1">
          <span className="truncate text-sm text-zinc-600 dark:text-zinc-300">{user.username}</span>
          <ThemeToggle />
          <LogoutButton />
        </div>
      }
    >
      <div className="min-w-0">
        <MobileNavigation overview={overview} groups={groups} />
        <main id="main-content" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8 md:py-9 xl:px-12">
          <PageTitle overview={overview} groups={groups} />
          {children}
        </main>
      </div>
    </ResizableAppShell>
  );
}
