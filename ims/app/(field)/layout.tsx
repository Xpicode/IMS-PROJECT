import { ServiceWorkerProvider } from "@/components/field/sw-provider";

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return <ServiceWorkerProvider>{children}</ServiceWorkerProvider>;
}
