"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api/errors";
import { resetPasswordWithToken } from "@/lib/users/service";

export type ResetState = { error?: string; fieldError?: string };

export async function resetAction(_prev: ResetState, form: FormData): Promise<ResetState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password !== confirm) return { fieldError: "The two passwords don't match. Type the same password twice." };
  try {
    await resetPasswordWithToken(token, password, { requestId: randomUUID() });
  } catch (e) {
    if (e instanceof ApiError) {
      return e.fields?.password ? { fieldError: e.fields.password[0] } : { error: e.message };
    }
    throw e;
  }
  redirect("/login?reset=1");
}
