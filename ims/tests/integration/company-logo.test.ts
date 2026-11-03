import { beforeEach, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { loadAccessUser } from "@/lib/users/access";
import { companyLogo, logoVersion, removeCompanyLogo, setCompanyLogo } from "@/lib/documents/logo";
import { renderPdf } from "@/lib/documents/pdf";
import { ctx, makeLocation, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const BAD_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => (e as ApiError).code,
  );

describe("company logo on forms", () => {
  it("administrators add and remove it; others can't; unusable images are refused; forms draw it", async () => {
    const wh = await makeLocation("WH-A");
    const admin = (await loadAccessUser((await makeUser("ADMIN")).id))!;
    const sup = (await loadAccessUser((await makeUser("SUPERVISOR", [{ id: wh.id }])).id))!;

    expect(await code(setCompanyLogo(sup, PNG, ctx()))).toBe("FORBIDDEN");
    expect(await code(setCompanyLogo(admin, Uint8Array.from([1, 2, 3]), ctx()))).toBe("VALIDATION_FAILED");
    expect(await code(setCompanyLogo(admin, BAD_JPEG, ctx()))).toBe("VALIDATION_FAILED"); // looks like JPEG, isn't
    expect(await companyLogo()).toBeNull();

    await setCompanyLogo(admin, PNG, ctx());
    expect((await companyLogo())?.type).toBe("png");
    expect(await logoVersion()).toMatch(/^png-/);

    const snap = {
      templateVersion: "IMS-GEN-1",
      title: "Stock Issuance",
      reference: "ISS-2026-000001",
      company: { name: "Acme", address: "Cebu" },
      issuedAtText: "3 Nov 2026",
      fields: [],
      columns: [{ key: "a", label: "Item", width: 1 }],
      rows: [{ a: "Bond paper" }],
      signatures: [{ role: "Prepared by" }],
    };
    const page = await (
      await getDocument({ data: await renderPdf(snap, { logo: await companyLogo() }) }).promise
    ).getPage(1);
    const ops = await page.getOperatorList();
    const { OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    expect(ops.fnArray).toContain(OPS.paintImageXObject);
    expect((await page.getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join(" ")).toContain("Acme");

    await removeCompanyLogo(admin, ctx());
    expect(await companyLogo()).toBeNull();
    expect(await prisma.auditEvent.count({ where: { eventType: "company.logo_changed" } })).toBe(2);
  });
});
