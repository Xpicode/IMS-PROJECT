/**
 * Small RFC 4180 CSV reader/writer for item import/export.
 * Output cells are escaped against spreadsheet formula injection (§9.5).
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(cell);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    cell = "";
  };
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else cell += c;
      i++;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") endRow();
    else if (c === "\r") {
      if (src[i + 1] !== "\n") endRow();
    } else cell += c;
    i++;
  }
  if (quoted) throw new Error('The file has a quote (") that is never closed. Check the row it starts on.');
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Escape one cell. Strings that a spreadsheet would treat as a formula get a leading apostrophe. */
export function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (FORMULA_START.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}
