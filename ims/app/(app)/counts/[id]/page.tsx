import { notFound } from "next/navigation";
import { NoAccess } from "@/components/common/no-access";
import { CountReview } from "@/components/counts/count-review";
import { pageAccess } from "@/lib/auth/page";
import { ApiError } from "@/lib/api/errors";
import { can } from "@/lib/permissions";
import { getReview } from "@/lib/counts/review";

export const metadata = { title: "Count review" };

export default async function CountReviewPage({ params }: PageProps<"/counts/[id]">) {
  const { user, allowed } = await pageAccess("counts.approve");
  if (!allowed) return <NoAccess what="Count review" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await getReview(user, id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  });
  if (!r) return <NoAccess what="this count" />;
  return (
    <CountReview data={JSON.parse(JSON.stringify(r))} canManage={can(user, "counts.create", r.session.location.id)} />
  );
}
