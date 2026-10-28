"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describedBy, Field } from "@/components/common/field";
import { resetAction, type ResetState } from "./actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error} <Link href="/login" className="underline">Back to sign in</Link>
          </AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="token" value={token} />
      <Field id="password" label="New password" hint="At least 10 characters." error={state.fieldError}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} {...describedBy("password", state.fieldError, true)} />
      </Field>
      <Field id="confirm" label="Type it again">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" loading={pending} className="w-full">
        Save new password
      </Button>
    </form>
  );
}
