import { IBM_Plex_Mono } from "next/font/google";
import { Boxes } from "lucide-react";
import { LabelScene } from "./label-scene";
import "./auth.css";

// Label-printer face for codes on the sign-in scene only; the app itself stays on Inter.
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "600"] });

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div
      className={`${plexMono.variable} grid min-h-dvh flex-1 grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-1`}
    >
      <LabelScene />
      <main className="flex flex-col bg-card px-4 py-8 sm:px-8 lg:justify-center lg:py-12">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-8">
          <div className="flex items-center gap-2 text-xl font-bold">
            <span className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Boxes className="size-6" aria-hidden />
            </span>
            IMS
          </div>
          <div className="auth-rise">{children}</div>
        </div>
      </main>
    </div>
  );
}
