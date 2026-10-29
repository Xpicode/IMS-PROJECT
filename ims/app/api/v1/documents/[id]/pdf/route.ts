import { idParam, route } from "@/lib/api/route";
import { documentFile } from "@/lib/documents/service";

/**
 * GET → the stored PDF, only after a permission and checksum check (§13.4, §16).
 * ?download=1 saves it; otherwise it opens in the browser for viewing/printing.
 */
export const GET = route({ auth: true }, async ({ req, user, params }) => {
  const f = await documentFile(user, idParam(params, "id", "document"));
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(Buffer.from(f.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${f.filename}"`,
      "x-content-type-options": "nosniff",
    },
  });
});
