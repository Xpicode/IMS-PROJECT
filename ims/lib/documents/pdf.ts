import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Official form renderer (spec §13). One controlled layout for all four
 * templates; each template is described entirely by its snapshot, which holds
 * the exact printable values frozen at confirm time (§13.4), so a reprint is
 * always identical.
 *
 * Layout: A4; company header + form title + reference on every page; info
 * block on page 1; an item table that flows onto more pages with its heading
 * repeated; remarks and signature blocks after the last row (moved to a new
 * page whole, never split); footer with reference, template version,
 * "Continued on next page" and "Page X of Y". Previews say DRAFT and carry no number.
 */
export type DocSnapshot = {
  templateVersion: string;
  title: string;
  /** Null only for draft previews. */
  reference: string | null;
  company: { name: string; address?: string | null };
  issuedAtText: string;
  fields: { label: string; value: string }[];
  columns: { key: string; label: string; width: number; align?: "left" | "right" }[];
  rows: Record<string, string>[];
  remarks?: string | null;
  signatures: { role: string; name?: string | null }[];
};

const A4: [number, number] = [595.28, 841.89];
const M = 40; // margin
const W = A4[0] - 2 * M;
const FOOTER = 40; // reserved at the bottom
const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.36, 0.4, 0.47);
const RULE = rgb(0.8, 0.82, 0.86);
const HEAD_BG = rgb(0.93, 0.94, 0.96);

let fonts: { regular: Buffer; bold: Buffer } | null = null;
function fontBytes() {
  if (!fonts) {
    const dir = path.join(process.cwd(), "assets", "fonts");
    fonts = {
      regular: readFileSync(path.join(dir, "Inter_400Regular.ttf")),
      bold: readFileSync(path.join(dir, "Inter_700Bold.ttf")),
    };
  }
  return fonts;
}

/** Split text into lines that fit `width`, breaking long words if needed. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of (text || "").split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= width) {
        line = tryLine;
        continue;
      }
      if (line) out.push(line);
      // A single word wider than the column: break it by characters.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) {
        let n = w.length - 1;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--;
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

export async function renderPdf(snap: DocSnapshot, opts: { draft?: boolean } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const f = fontBytes();
  // Embed whole fonts: pdf-lib's subsetting drops most of Inter's glyphs (the text
  // layer still reads fine, but the printed page shows gaps). Costs ~0.6 MB per PDF.
  const regular = await pdf.embedFont(f.regular, { subset: false });
  const bold = await pdf.embedFont(f.bold, { subset: false });
  const draft = !!opts.draft;
  const refText = snap.reference ?? "Not yet numbered";
  pdf.setTitle(`${snap.reference ?? "DRAFT"} ${snap.title}`);
  pdf.setAuthor(snap.company.name);
  pdf.setProducer("IMS");
  pdf.setCreator("IMS");

  const text = (page: PDFPage, s: string, x: number, y: number, size: number, font = regular, color = INK) =>
    page.drawText(s, { x, y, size, font, color });
  const right = (page: PDFPage, s: string, xRight: number, y: number, size: number, font = regular, color = INK) =>
    text(page, s, xRight - font.widthOfTextAtSize(s, size), y, size, font, color);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  /** New page with the header (company, title, reference). Returns the y below it. */
  const newPage = () => {
    page = pdf.addPage(A4);
    pages.push(page);
    let top = A4[1] - M;
    text(page, snap.company.name, M, top - 12, 13, bold);
    if (snap.company.address) text(page, snap.company.address, M, top - 26, 9, regular, MUTED);
    right(
      page,
      draft ? "DRAFT – not an official document" : refText,
      M + W,
      top - 12,
      12,
      bold,
      draft ? rgb(0.7, 0.1, 0.1) : INK,
    );
    right(page, `Issued ${snap.issuedAtText}`, M + W, top - 26, 9, regular, MUTED);
    top -= 48;
    text(page, snap.title + (pages.length > 1 ? " (continued)" : ""), M, top - 16, 16, bold);
    top -= 26;
    page.drawLine({ start: { x: M, y: top }, end: { x: M + W, y: top }, thickness: 1, color: INK });
    if (draft) {
      page.drawText("DRAFT", {
        x: 130,
        y: 260,
        size: 130,
        font: bold,
        color: rgb(0.85, 0.2, 0.2),
        opacity: 0.12,
        rotate: degrees(40),
      });
    }
    y = top - 14;
  };

  newPage();

  // Info block (page 1): two columns of label / value.
  const colW = (W - 20) / 2;
  for (let i = 0; i < snap.fields.length; i += 2) {
    const pair = snap.fields.slice(i, i + 2);
    const blocks = pair.map((fl) => wrap(fl.value || "—", regular, 10, colW));
    const h = 12 + Math.max(...blocks.map((b) => b.length)) * 13 + 6;
    pair.forEach((fl, k) => {
      const x = M + k * (colW + 20);
      text(page, fl.label.toUpperCase(), x, y - 8, 7.5, bold, MUTED);
      blocks[k].forEach((ln, j) => text(page, ln, x, y - 21 - j * 13, 10));
    });
    y -= h;
  }
  y -= 6;

  // Item table.
  const cols = snap.columns.map((c) => ({ ...c, w: c.width * W }));
  const PAD = 4;
  const drawTableHead = () => {
    const h = 18;
    page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: HEAD_BG });
    let x = M;
    for (const c of cols) {
      if (c.align === "right") right(page, c.label, x + c.w - PAD, y - 12.5, 8.5, bold);
      else text(page, c.label, x + PAD, y - 12.5, 8.5, bold);
      x += c.w;
    }
    y -= h;
  };
  drawTableHead();
  const bottom = M + FOOTER;
  for (const row of snap.rows) {
    const cells = cols.map((c) => wrap(row[c.key] ?? "", regular, 9, c.w - 2 * PAD));
    const h = Math.max(...cells.map((l) => l.length)) * 11.5 + 7;
    if (y - h < bottom) {
      newPage();
      drawTableHead();
    }
    let x = M;
    cols.forEach((c, k) => {
      cells[k].forEach((ln, j) => {
        const ty = y - 11 - j * 11.5;
        if (c.align === "right") right(page, ln, x + c.w - PAD, ty, 9);
        else text(page, ln, x + PAD, ty, 9);
      });
      x += c.w;
    });
    y -= h;
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: RULE });
  }
  if (!snap.rows.length) {
    text(page, "No items.", M + PAD, y - 12, 9, regular, MUTED);
    y -= 18;
  }

  // Remarks + signatures stay together; if they don't fit, they start a new page.
  const remarks = snap.remarks ? wrap(snap.remarks, regular, 9.5, W) : [];
  const perRow = Math.min(3, Math.max(1, snap.signatures.length));
  const sigRows = Math.ceil(snap.signatures.length / perRow);
  const tailH = (remarks.length ? 20 + remarks.length * 12.5 : 0) + 18 + sigRows * 78;
  if (y - tailH < bottom) newPage();
  if (remarks.length) {
    y -= 14;
    text(page, "REMARKS", M, y, 7.5, bold, MUTED);
    remarks.forEach((ln, j) => text(page, ln, M, y - 13 - j * 12.5, 9.5));
    y -= 13 + remarks.length * 12.5;
  }
  y -= 18;
  const sigW = (W - (perRow - 1) * 24) / perRow;
  snap.signatures.forEach((s, i) => {
    const r = Math.floor(i / perRow);
    const k = i % perRow;
    const x = M + k * (sigW + 24);
    const top = y - r * 78;
    text(page, s.role, x, top - 8, 8.5, bold, MUTED);
    const lineY = top - 42;
    page.drawLine({ start: { x, y: lineY }, end: { x: x + sigW, y: lineY }, thickness: 0.8, color: INK });
    text(page, s.name || "Name", x, lineY - 12, 9, regular, s.name ? INK : MUTED);
    text(page, "Signature over printed name · Date", x, lineY - 23, 7, regular, MUTED);
  });

  // Footers, now that the page count is known.
  const n = pages.length;
  pages.forEach((p, i) => {
    const fy = M - 6;
    p.drawLine({ start: { x: M, y: fy + 14 }, end: { x: M + W, y: fy + 14 }, thickness: 0.5, color: RULE });
    text(p, `${draft ? "DRAFT" : refText} · ${snap.templateVersion}`, M, fy, 8, regular, MUTED);
    if (i < n - 1) {
      const c = "Continued on next page";
      text(p, c, M + W / 2 - regular.widthOfTextAtSize(c, 8) / 2, fy, 8, bold, MUTED);
    }
    right(p, `Page ${i + 1} of ${n}`, M + W, fy, 8, regular, MUTED);
  });

  return pdf.save();
}
