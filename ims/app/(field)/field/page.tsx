import { Suspense } from "react";
import { FieldApp } from "@/components/field/field-app";

export const metadata = { title: "Field" };
// Static shell with no user data in it: the service worker precaches it, and
// the app reads the signed-in user's assignments from IndexedDB on the device.
export const dynamic = "force-static";

export default function FieldPage() {
  return (
    <Suspense fallback={<p className="p-6 text-lg">Opening IMS…</p>}>
      <FieldApp />
    </Suspense>
  );
}
