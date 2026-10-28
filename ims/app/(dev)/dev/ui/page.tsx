import { notFound } from "next/navigation";
import { StyleGuide } from "./style-guide";

export const metadata = { title: "UI style guide" };

/** Living style guide (IMS_BUILD_PLAN Phase 1). Not served in production. */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <StyleGuide />;
}
