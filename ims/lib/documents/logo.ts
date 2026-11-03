import "server-only";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { requireAccess, type AccessUser } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { sniff } from "@/lib/inventory/item-photo";
import { documentsDir } from "./service";
import type { Ctx } from "@/lib/context";

/** The company logo printed at the top of every new form. One file, in the private folder. */
export const MAX_LOGO_BYTES = 1024 * 1024;
export type Logo = { bytes: Uint8Array; type: "png" | "jpg" };
const EXTS = ["png", "jpg"] as const;
const file = (ext: string) => path.join(/*turbopackIgnore: true*/ documentsDir(), "branding", `logo.${ext}`);

export async function companyLogo(): Promise<Logo | null> {
  for (const type of EXTS) {
    const b = await readFile(/*turbopackIgnore: true*/ file(type)).catch(() => null);
    if (b) return { bytes: new Uint8Array(b), type };
  }
  return null;
}

/** Changes whenever the logo does (for the preview URL); null when there is none. */
export async function logoVersion(): Promise<string | null> {
  for (const ext of EXTS) {
    const s = await stat(/*turbopackIgnore: true*/ file(ext)).catch(() => null);
    if (s) return `${ext}-${Math.round(s.mtimeMs)}`;
  }
  return null;
}

/** Add or replace the logo (administrators). PNG or JPEG, checked by drawing it into a PDF. */
export async function setCompanyLogo(actor: AccessUser, bytes: Uint8Array, ctx: Ctx) {
  requireAccess(actor, "settings.manage");
  if (bytes.length > MAX_LOGO_BYTES) throw new ApiError("VALIDATION_FAILED", "The logo is larger than 1 MB.");
  const kind = sniff(bytes);
  if (!kind || kind.ext === "webp") throw new ApiError("VALIDATION_FAILED", "Use a PNG or JPEG logo.");
  const type = kind.ext as Logo["type"];
  try {
    const pdf = await PDFDocument.create();
    await (type === "png" ? pdf.embedPng(bytes) : pdf.embedJpg(bytes));
  } catch {
    throw new ApiError("VALIDATION_FAILED", "This image can't be printed on forms. Save it as a normal PNG or JPEG.");
  }
  const target = file(type);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(target), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ `${target}.tmp`, bytes);
  await rename(/*turbopackIgnore: true*/ `${target}.tmp`, target);
  for (const other of EXTS) if (other !== type) await rm(/*turbopackIgnore: true*/ file(other), { force: true });
  await writeAudit(prisma, {
    actorId: actor.id,
    eventType: "company.logo_changed",
    recordType: "company",
    after: { logo: type, bytes: bytes.length },
    requestId: ctx.requestId,
  });
}

export async function removeCompanyLogo(actor: AccessUser, ctx: Ctx) {
  requireAccess(actor, "settings.manage");
  if (!(await companyLogo())) return;
  for (const ext of EXTS) await rm(/*turbopackIgnore: true*/ file(ext), { force: true });
  await writeAudit(prisma, {
    actorId: actor.id,
    eventType: "company.logo_changed",
    recordType: "company",
    after: { logo: null },
    requestId: ctx.requestId,
  });
}
