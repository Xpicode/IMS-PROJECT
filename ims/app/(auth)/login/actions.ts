"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth/auth";
import { safeNext } from "@/lib/safe-next";

export type LoginState = { error?: string; email?: string };

const MESSAGES: Record<string, string> = {
  invalid_login: "Email or password is wrong. Check both and try again.",
  account_inactive: "This account has been deactivated. Ask an administrator if you need access.",
  too_many_attempts:
    "Too many wrong attempts. Wait 15 minutes and try again, or ask an administrator to reset your password.",
};

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };
  try {
    await signIn("credentials", { email, password, redirectTo: safeNext(form.get("next")) });
  } catch (e) {
    if (e instanceof AuthError) {
      const code = "code" in e && typeof e.code === "string" ? e.code : "";
      return { error: MESSAGES[code] ?? "Sign-in didn't work. Try again in a moment.", email };
    }
    throw e; // includes the success redirect
  }
  return {};
}
