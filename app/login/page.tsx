import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/dashboard");
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="fixed right-5 top-5">
        <ThemeToggle />
      </div>
      <LoginForm next={next} />
    </main>
  );
}
