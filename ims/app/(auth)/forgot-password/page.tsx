import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Forgot your password?</h1>
      <p>Ask your administrator for a reset link. It works once and expires after 1 hour.</p>
      <p className="text-muted-foreground">For your safety, IMS never sends or shows passwords.</p>
      <Button asChild variant="outline" className="w-full">
        <Link href="/login">Back to sign in</Link>
      </Button>
    </div>
  );
}
