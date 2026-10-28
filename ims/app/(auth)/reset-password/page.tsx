import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Reset password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  if (typeof token !== "string" || token.length < 20) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Link not valid</h1>
        <p>This reset link is incomplete. Copy the full link from your administrator, or ask for a new one.</p>
        <Button asChild variant="outline">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }
  return <ResetForm token={token} />;
}
