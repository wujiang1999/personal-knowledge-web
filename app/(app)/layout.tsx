import { requireUser } from "@/lib/requireUser";
import { countReviewItems } from "@/lib/reviews";
import { LogoutButton } from "@/components/logout-button";
import { NavLinks } from "@/components/nav-links";
import { QuickSwitcher } from "@/components/quick-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

const baseLinks = [
  { href: "/dashboard", label: "概览" },
  { href: "/knowledge", label: "知识" },
  { href: "/graph", label: "图谱" },
  { href: "/sources", label: "来源" },
  { href: "/stats", label: "统计" },
  { href: "/logs", label: "记录" },
  { href: "/trash", label: "回收站" },
  { href: "/reviews", label: "审核" },
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
  const links =
    user.role === "admin"
      ? [...withBadges.slice(0, 8), { href: "/users", label: "账户" }, ...withBadges.slice(8)]
      : withBadges;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <nav className="flex items-center gap-1">
            <span className="mr-2 font-semibold">知识库</span>
            <NavLinks items={links} />
          </nav>
          <div className="flex items-center gap-1">
            <QuickSwitcher />
            <ThemeToggle />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{user.username}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}