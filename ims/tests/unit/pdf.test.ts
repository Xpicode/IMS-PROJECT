import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import fontkit from "@pdf-lib/fontkit";
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { renderPdf, type DocSnapshot } from "@/lib/documents/pdf";

/** Text of each page, as a viewer would extract it. */
async function pagesText(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice() }).promise;
  const out: { text: string; width: number; height: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    out.push({
      text: tc.items
        .map((x: object) => ("str" in x ? (x as { str: string }).str : ""))
        .join(" ")
        .replace(/\s+/g, " "),
      width: vp.width,
      height: vp.height,
    });
  }
  return out;
}

const base = (rows: number, over: Partial<DocSnapshot> = {}): DocSnapshot => ({
  templateVersion: "IMS-GEN-1",
  title: "Equipment Borrowing Form",
  reference: "BOR-2026-000001",
  company: { name: "Acme Field Services", address: "12 Rizal St., Cebu City" },
  issuedAtText: "28 Oct 2026, 5:40 PM",
  fields: [
    { label: "Borrower", value: "José Peña" },
    { label: "Department / site", value: "Site B" },
    { label: "Purpose", value: "WO-2001 pump repair" },
    { label: "Due", value: "4 Nov 2026" },
  ],
  columns: [
    { key: "no", label: "#", width: 0.06, align: "right" },
    { key: "code", label: "Asset tag", width: 0.18 },
    { key: "desc", label: "Description", width: 0.46 },
    { key: "cond", label: "Condition", width: 0.14 },
    { key: "acc", label: "Accessories", width: 0.16 },
  ],
  rows: Array.from({ length: rows }, (_, i) => ({
    no: String(i + 1),
    code: `TOOL-${String(i + 1).padStart(4, "0")}`,
    desc:
      i % 3 === 0
        ? `Cordless drill ${i + 1} with a longer description that has to wrap onto a second line`
        : `Cordless drill ${i + 1}`,
    cond: "Good",
    acc: "Charger, case",
  })),
  remarks: "Return clean and charged.",
  signatures: [
    { role: "Prepared by", name: "Sam Supervisor" },
    { role: "Released by", name: "Sam Supervisor" },
    { role: "Received by (borrower)", name: "José Peña" },
  ],
  ...over,
});

describe("PDF renderer (§13, A24)", () => {
  it("draws an A4 form with every printed value, including accented names", async () => {
    const [p, ...rest] = await pagesText(await renderPdf(base(3)));
    expect(rest).toHaveLength(0);
    expect([Math.round(p.width), Math.round(p.height)]).toEqual([595, 842]);
    for (const s of [
      "Acme Field Services",
      "12 Rizal St., Cebu City",
      "Equipment Borrowing Form",
      "BOR-2026-000001",
      "28 Oct 2026, 5:40 PM",
      "José Peña",
      "WO-2001 pump repair",
      "TOOL-0003",
      "Charger, case",
      "Return clean and charged.",
      "Prepared by",
      "Received by (borrower)",
      "Page 1 of 1",
      "IMS-GEN-1",
    ]) {
      expect(p.text, s).toContain(s);
    }
    expect(p.text).not.toMatch(/DRAFT/);
  });

  it("flows a 30-row form onto more pages: heading repeated, page X of Y, signatures only at the end", async () => {
    const pages = await pagesText(await renderPdf(base(30)));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const n = pages.length;
    pages.forEach((p, i) => {
      expect(p.text).toContain(`Page ${i + 1} of ${n}`);
      expect(p.text).toContain("BOR-2026-000001");
      expect(p.text).toContain("Asset tag");
      expect(p.text).toContain("Description");
      if (i < n - 1) {
        expect(p.text).toContain("Continued on next page");
        expect(p.text).not.toContain("Released by");
      }
    });
    expect(pages[n - 1].text).toContain("Released by");
    expect(pages[n - 1].text).not.toContain("Continued on next page");
    // Every row exactly once, none lost at a page break.
    const all = pages.map((p) => p.text).join(" ");
    for (let i = 1; i <= 30; i++) {
      expect(all.match(new RegExp(`TOOL-${String(i).padStart(4, "0")}\\b`, "g")), `row ${i}`).toHaveLength(1);
    }
  });

  it("never leaves a page holding only the signature block without any heading", async () => {
    for (const rows of [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 80]) {
      const pages = await pagesText(await renderPdf(base(rows)));
      for (const p of pages) expect(p.text).toContain("Equipment Borrowing Form");
      expect(pages.at(-1)!.text).toContain("Received by (borrower)");
    }
  }, 60_000);

  it("keeps every line on the page and clear of the footer (nothing printed over it or cut off)", async () => {
    for (const rows of [10, 18, 20, 22, 24, 26, 30, 45]) {
      const doc = await getDocument({ data: (await renderPdf(base(rows))).slice() }).promise;
      for (let i = 1; i <= doc.numPages; i++) {
        const items = (await (await doc.getPage(i)).getTextContent()).items.filter((x) => "str" in x && x.str.trim());
        for (const it of items as { str: string; transform: number[] }[]) {
          const y = it.transform[5];
          const footer = /^Page \d+ of \d+$|IMS-GEN-1|^Continued on next page$/.test(it.str.trim());
          if (footer) expect(y, `${rows} rows, page ${i}: footer "${it.str}"`).toBeLessThan(45);
          else
            expect(y, `${rows} rows, page ${i}: "${it.str}" is in the footer zone or off the page`).toBeGreaterThan(55);
        }
      }
    }
  }, 60_000);

  it("marks previews DRAFT with no official number", async () => {
    const [p] = await pagesText(await renderPdf(base(2, { reference: null }), { draft: true }));
    expect(p.text).toContain("DRAFT");
    expect(p.text).toMatch(/not an official document/i);
    expect(p.text).not.toContain("BOR-2026");
  });

  it("every printed character has a real glyph in the embedded font (no blank gaps on paper)", async () => {
    // pdf-lib's font subsetting dropped most of Inter's glyphs: the text layer
    // still read correctly (so the text tests passed) but the page printed gaps.
    const snap = base(3);
    const doc = await PDFDocument.load(await renderPdf(snap));
    const programs = doc.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of("Type")) === PDFName.of("FontDescriptor"))
      .map((d) => d.lookup(PDFName.of("FontFile2")) as PDFRawStream);
    expect(programs).toHaveLength(2);
    const text = [
      snap.company.name,
      snap.title,
      ...snap.fields.flatMap((f) => [f.label.toUpperCase(), f.value]),
      ...snap.rows.flatMap(Object.values),
      "Page 1 of 1",
    ].join("");
    for (const stream of programs) {
      const font = fontkit.create(Buffer.from(decodePDFRawStream(stream).decode())) as fontkit.Font;
      const missing = [...new Set(text.replace(/\s/g, ""))].filter((ch) => {
        const g = font.glyphForCodePoint(ch.codePointAt(0)!);
        return !g || g.id === 0 || g.path.toSVG() === "";
      });
      expect(missing.join(""), "characters with no glyph").toBe("");
    }
  });

  it("is stable: the same snapshot gives the same pages and text", async () => {
    const a = await pagesText(await renderPdf(base(30)));
    const b = await pagesText(await renderPdf(base(30)));
    expect(b).toEqual(a);
  });
});
