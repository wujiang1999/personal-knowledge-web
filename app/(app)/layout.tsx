import { requireUser } from "@/lib/requireUser";
import { countReviewItems } from "@/lib/reviews";
import { LogoutButton } from "@/components/logout-button";
import { NavLinks } from "@/components/nav-links";
import { ResizableAppShell } from "@/components/resizable-sidebar";
import { QuickSwitcher } from "@/components/quick-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

const baseLinks = [
  { href: "/dashboard", label: "概览" },
  { href: "/knowledge", label: "知识" },
  { href: "/graph", label: "图谱" },
  { href: "/ask", label: "问答" },
  { href: "/sources", label: "来源" },
  { href: "/stats", label: "统计" },
  { href: "/logs", label: "记录" },
  { href: "/trash", label: "回收站" },
  { href: "/quality", label: "质检" },
  { href: "/reviews", label: "审核" },
  // 版本排在「设置」之前：账户入口是靠 slice(0, -1) 插到最后一项前面的，
  // 把新项追加到末尾会让账户入口插错位置。
  { href: "/version", label: "版本" },
  { href: "/settings", label: "设置" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // 待裁决数挂在导航上：队列没人知道就不会有人清（一次索引计数，代价可忽略）。
  const pendingReviews = await countReviewItems(user, "pending");
  // 账户管理是管理员入口；普通用户不渲染也不可达（页面自身还有直接 URL 守卫）。
  const withBadges = baseLinks.map((l) =>
    l.href === "/reviews" ? { ...l, badge: pendingReviews } : l
  );
  // 「账户」插在最后一项（设置）之前：用 slice(0, -1) 而不是硬编码下标，
  // 新增导航项时不必再回来改这里。
  const links =
    user.role === "admin"
      ? [...withBadges.slice(0, -1), { href: "/users", label: "账户" }, ...withBadges.slice(-1)]
      : withBadges;

  return (
    <ResizableAppShell
      navigation={<NavLinks items={links} vertical />}
      footer={
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2">
          <QuickSwitcher />
          <span className="truncate text-sm text-zinc-600 dark:text-zinc-300">{user.username}</span>
          <ThemeToggle />
          <LogoutButton />
        </div>
      }
    >
      <div className="min-w-0">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 md:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <span className="shrink-0 font-semibold">知识库</span>
            <div className="flex items-center gap-1">
              <QuickSwitcher />
              <ThemeToggle />
              <span className="hidden text-sm text-zinc-500 dark:text-zinc-400 sm:inline">{user.username}</span>
              <LogoutButton />
            </div>
          </div>
          <nav className="flex overflow-x-auto px-2 py-2">
            <NavLinks items={links} />
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </ResizableAppShell>
  );
}