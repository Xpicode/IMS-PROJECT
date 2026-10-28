import { redirect } from "next/navigation";

/** Sync lives in the field app, where the device's counts are. */
export default function Page() {
  redirect("/field?v=sync");
}
