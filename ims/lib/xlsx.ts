import { crc32, deflateRawSync } from "node:zlib";

/**
 * One-sheet Excel file for people to read: bold header, frozen top row, columns sized
 * to their content, numbers right-aligned, long text wrapped. An .xlsx is zipped XML, so
 * node:zlib is enough. Text is stored as text and never evaluated, so unlike CSV it needs
 * no formula guard, and codes like 00123 keep their zeros.
 */
export type XlsxValue = string | number | null | undefined;

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

const STYLES = `${XML}<styleSheet xmlns="${MAIN}">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EAF0"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8A93A3"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs>
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
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}" s="${NUMBER}"><v>${v}</v></c>` : "";
  if (v === null || v === undefined || v === "") return "";
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

export function toXlsx(sheetName: string, header: string[], rows: XlsxValue[][]): Buffer {
  const numeric = header.map((_, c) => rows.some((r) => typeof r[c] === "number"));
  const cols = header
    .map((h, c) => {
      const longest = rows.reduce((max, r) => Math.max(max, String(r[c] ?? "").length), h.length + 2);
      const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + 2));
      return `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`;
    })
    .join("");
  const head = header.map((h, c) => cell(`${colName(c)}1`, h, numeric[c] ? HEAD_RIGHT : HEAD)).join("");
  const body = rows
    .map((r, i) => {
      const n = i + 2;
      return `<row r="${n}">${header.map((_, c) => cell(`${colName(c)}${n}`, r[c], TEXT)).join("")}</row>`;
    })
    .join("");
  const sheet = `${XML}<worksheet xmlns="${MAIN}"><sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><cols>${cols}</cols><sheetData><row r="1">${head}</row>${body}</sheetData></worksheet>`;
  return zip({
    "[Content_Types].xml": `${XML}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheet,
    "xl/styles.xml": STYLES,
  });
}
