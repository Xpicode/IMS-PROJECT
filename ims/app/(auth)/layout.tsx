import { Boxes } from "lucide-react";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 p-4">
      <div className="flex items-center gap-2 text-xl font-bold">
        <span className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Boxes className="size-6" aria-hidden />
        </span>
        IMS
      </div>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">{children}</div>
    </main>
  );
}
