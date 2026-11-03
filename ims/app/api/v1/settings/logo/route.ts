import { ApiError, errors } from "@/lib/api/errors";
import { json, route } from "@/lib/api/route";
import { requireAccess } from "@/lib/permissions";
import { companyLogo, MAX_LOGO_BYTES, removeCompanyLogo, setCompanyLogo } from "@/lib/documents/logo";

/** GET → the company logo printed on forms. */
export const GET = route({ auth: true }, async ({ user }) => {
  requireAccess(user, "records.view");
  const logo = await companyLogo();
  if (!logo) throw errors.notFound("logo");
  return new Response(Buffer.from(logo.bytes), {
    headers: { "content-type": logo.type === "png" ? "image/png" : "image/jpeg" },
  });
});

/** PUT (raw PNG or JPEG body, up to 1 MB) → add or replace the logo. Administrators. */
export const PUT = route({ auth: true }, async ({ req, user, ctx }) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_LOGO_BYTES)
    throw new ApiError("VALIDATION_FAILED", "The logo is larger than 1 MB.", { status: 413 });
  await setCompanyLogo(user, new Uint8Array(await req.arrayBuffer()), ctx);
  return json({ ok: true });
});

/** DELETE → forms go back to the company name only. */
export const DELETE = route({ auth: true }, async ({ user, ctx }) => {
  await removeCompanyLogo(user, ctx);
  return json({ ok: true });
});
