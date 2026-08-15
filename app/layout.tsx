import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知识库",
  description: "个人知识库 · OKF v0.2 导出",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-zinc-100 text-zinc-900 antialiased">
        {children}
      </body>
    </html>
  );
}