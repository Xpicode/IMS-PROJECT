import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getCurrentUser()) redirect(next);
  const notice = sp.reset === "1" ? "Password changed. Sign in with your new password." : undefined;
  return <LoginForm next={next} notice={notice} />;
}
