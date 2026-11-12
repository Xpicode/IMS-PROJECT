import { crc32, deflateRawSync } from "node:zlib";

/**
 * One-sheet Excel file for people to read: dark header, frozen headings, columns sized
 * to their content, numbers right-aligned, long text wrapped. An .xlsx is zipped XML, so
 * node:zlib is enough. Text is stored as text and never evaluated, so unlike CSV it needs
 * no formula guard, and codes like 00123 keep their zeros.
 */
export type XlsxValue = string | number | null | undefined;
export type XlsxFormat = "integer" | "signed" | "date" | "datetime" | "text";
export type XlsxMetadata = { company: string; title: string; details: string[] };

/** Excel has no timezone: store the company-local wall clock, not the UTC clock. */
export function excelDate(value: Date, dateOnly = false): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: process.env.NEXT_PUBLIC_COMPANY_TIMEZONE || "Asia/Manila",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .map((p) => [p.type, p.value]),
  );
  return (
    (Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      dateOnly ? 0 : Number(parts.hour),
      dateOnly ? 0 : Number(parts.minute),
    ) -
      Date.UTC(1899, 11, 30)) /
    86_400_000
  );
}

const MIN_WIDTH = 8;
const MAX_WIDTH = 50;
const MAX_CELL = 32767; // Excel refuses a file with a longer cell
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006";

// Indexes into cellXfs in STYLES.
const HEAD = 1;
const HEAD_RIGHT = 2;
const TEXT = 3;
const NUMBER = 4;
const FORMATS: Record<XlsxFormat, number> = { integer: 5, signed: 6, date: 7, datetime: 8, text: 11 };

// Match the app's navy sidebar, blue primary and slate surfaces (app/globals.css).
const bodyStyle = (numFmtId: number, fillId = 0, wrap = false) =>
  `<xf numFmtId="${numFmtId}" fontId="0" fillId="${fillId}" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"${wrap ? ' wrapText="1"' : ""}/></xf>`;
const STYLES = `${XML}<styleSheet xmlns="${MAIN}">
<numFmts count="3"><numFmt numFmtId="164" formatCode="+#,##0;-#,##0;0"/><numFmt numFmtId="165" formatCode="d mmm yyyy"/><numFmt numFmtId="166" formatCode="d mmm yyyy, h:mm AM/PM"/></numFmts>
<fonts count="5"><font><sz val="11"/><color rgb="FF0F172A"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="18"/><color rgb="FF0B1B33"/><name val="Arial"/></font><font><b/><sz val="12"/><color rgb="FF0B1B33"/><name val="Arial"/></font><font><sz val="10"/><color rgb="FF475569"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B1B33"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="medium"><color rgb="FF2563EB"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style="hair"><color rgb="FFE2E8F0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="20"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
${["left", "right"].map((align) => `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${align}" vertical="center" wrapText="1"/></xf>`).join("")}
${[0, 0, 3, 164, 165, 166].map((id, i) => bodyStyle(id, 0, i === 0)).join("")}
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
${bodyStyle(49, 0, true)}
${[0, 0, 3, 164, 165, 166, 49].map((id, i) => bodyStyle(id, 3, i === 0 || i === 6)).join("")}
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Escape for XML, dropping what XML can't hold (control characters, broken surrogates). */
function esc(s: string): string {
  return s
    .slice(0, MAX_CELL)
    .toWellFormed()
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function cell(ref: string, v: XlsxValue, style: number): string {
  if (typeof v === "number")
    return Number.isFinite(v) ? `<c r="${ref}" s="${style}"><v>${v}</v></c>` : `<c r="${ref}" s="${style}"/>`;
  if (v === null || v === undefined || v === "") return `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

/** Plain zip, deflated. Enough for a generated workbook: ASCII names, well under 4 GB. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8");
    const data = deflateRawSync(raw);
    const fileName = Buffer.from(name, "ascii");
    // The header part both records share: version, flags, method, time, date, crc, sizes, name length.
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0);
    common.writeUInt16LE(8, 4);
    common.writeUInt16LE(0x21, 8); // 1 January 1980: a zero date is invalid
    common.writeUInt32LE(crc32(raw), 10);
    common.writeUInt32LE(data.length, 14);
    common.writeUInt32LE(raw.length, 18);
    common.writeUInt16LE(fileName.length, 22);
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), common, fileName, data]);
    const tail = Buffer.alloc(14); // comment length, disk, attributes: 0; then this file's offset
    tail.writeUInt32LE(offset, 10);
    central.push(Buffer.concat([Buffer.from([0x50, 0x4b, 1, 2, 20, 0]), common, tail, fileName]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function toXlsx(
  sheetName: string,
  header: string[],
  rows: XlsxValue[][],
  formats: (XlsxFormat | undefined)[] = [],
  metadata?: XlsxMetadata,
): Buffer {
  const preamble = metadata ? [metadata.company, metadata.title, ...metadata.details] : [];
  const headingRow = metadata ? preamble.length + 2 : 1;
  const dataRow = headingRow + 1;
  const numeric = header.map(
    (_, c) => (Boolean(formats[c]) && formats[c] !== "text") || rows.some((r) => typeof r[c] === "number"),
  );
  const widths = header.map((h, c) => {
    const displayLength = (v: XlsxValue) =>
      typeof v === "number" && formats[c] === "date"
        ? 11
        : typeof v === "number" && formats[c] === "datetime"
          ? 21
          : Math.max(
              ...String(v ?? "")
                .split(/\r?\n/)
                .map((line) => line.length),
            );
    const longest = rows.reduce((max, r) => Math.max(max, displayLength(r[c])), h.length + 2);
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + 2));
  });
  const cols = widths
    .map(
      (width, c) =>
        `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"${formats[c] === "text" ? ' style="11"' : ""}/>`,
    )
    .join("");
  const head = header.map((h, c) => cell(`${colName(c)}${headingRow}`, h, numeric[c] ? HEAD_RIGHT : HEAD)).join("");
  const headingHeight = Math.max(
    30,
    ...header.map(
      (text, c) =>
        text.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / (widths[c] - 4))), 0) * 15 +
        8,
    ),
  );
  // Merged cells do not auto-fit in Excel. Account for font size and explicit newlines.
  const preambleWidth = widths.reduce((sum, width) => sum + width * 7, 0) - 12;
  const preambleRows = preamble
    .map((text, i) => {
      const fontSize = i === 1 ? 18 : i === 0 ? 12 : 10;
      const lineHeight = i === 1 ? 24 : i === 0 ? 18 : 14;
      const capacity = Math.max(1, Math.floor(preambleWidth / (fontSize * 0.75)));
      const lines = text
        .slice(0, MAX_CELL)
        .split(/\r?\n/)
        .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / capacity)), 0);
      const height = Math.min(409, lines * lineHeight + (i === 1 ? 10 : 6));
      return `<row r="${i + 1}" ht="${height}" customHeight="1">${cell(`A${i + 1}`, text, i === 1 ? 9 : i === 0 ? 10 : 19)}</row>`;
    })
    .join("");
  const spacer = metadata ? `<row r="${headingRow - 1}" ht="8" customHeight="1"/>` : "";
  const lastCol = colName(header.length - 1);
  const merges =
    metadata && header.length > 1
      ? `<mergeCells count="${preamble.length}">${preamble.map((_, i) => `<mergeCell ref="A${i + 1}:${lastCol}${i + 1}"/>`).join("")}</mergeCells>`
      : "";
  const autoFilter = `<autoFilter ref="A${headingRow}:${lastCol}${headingRow + rows.length}"/>`;
  const body = rows
    .map((r, i) => {
      const n = i + dataRow;
      const lines = header.reduce(
        (max, _, c) =>
          Math.max(
            max,
            String(r[c] ?? "")
              .split(/\r?\n/)
              .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / (widths[c] - 2))), 0),
          ),
        1,
      );
      return `<row r="${n}" ht="${Math.min(96, Math.max(24, lines * 15 + 8))}" customHeight="1">${header
        .map((_, c) => {
          const style =
            formats[c] === "text"
              ? FORMATS.text
              : typeof r[c] === "number"
                ? formats[c]
                  ? FORMATS[formats[c]]
                  : NUMBER
                : TEXT;
          const bandedStyle = style === FORMATS.text ? 18 : style + 9;
          return cell(`${colName(c)}${n}`, r[c], i % 2 ? bandedStyle : style);
        })
        .join("")}</row>`;
    })
    .join("");
  const sheet = `${XML}<worksheet xmlns="${MAIN}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastCol}${headingRow + rows.length}"/><sheetViews><sheetView tabSelected="1" showGridLines="0" workbookViewId="0"><pane ySplit="${headingRow}" topLeftCell="A${dataRow}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${dataRow}" sqref="A${dataRow}"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${cols}</cols><sheetData>${preambleRows}${spacer}<row r="${headingRow}" ht="${headingHeight}" customHeight="1">${head}</row>${body}</sheetData>${autoFilter}${merges}<printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const printSheet = esc(sheetName).replace(/"/g, "&quot;").replace(/'/g, "''");
  return zip({
    "[Content_Types].xml": `${XML}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="${esc(sheetName).replace(/"/g, "&quot;")}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${printSheet}'!$${headingRow}:$${headingRow}</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">'${printSheet}'!$A$1:$${lastCol}$${headingRow + rows.length}</definedName></definedNames></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheet,
    "xl/styles.xml": STYLES,
  });
}
