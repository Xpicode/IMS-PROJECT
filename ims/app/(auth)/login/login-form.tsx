"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground">Use your work email and password.</p>
      </div>
      {notice && !state.error && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {state.error && (
        <Alert variant="destructive" aria-live="assertive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="next" value={next} />
      <Field id="email" label="Email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          autoFocus
        />
      </Field>
      <Field id="password" label="Password">
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className="pr-20"
          />
          {/* Typing a password on a phone outdoors is error-prone; let people check it. */}
          <Button
            type="button"
            variant="ghost"
            aria-controls="password"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute inset-y-1 right-1 h-auto px-3 text-sm font-semibold text-primary"
          >
            {showPassword ? "Hide" : "Show"}
            <span className="sr-only"> password</span>
          </Button>
        </div>
      </Field>
      <Button type="submit" loading={pending} className="mt-2 w-full">
        Sign in
      </Button>
      <Link href="/forgot-password" className="self-center py-2 text-primary underline underline-offset-4">
        Forgot password?
      </Link>
    </form>
  );
}
