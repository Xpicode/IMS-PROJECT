/**
 * CSV for spreadsheets (spec §9.5). UTF-8 with BOM so Excel reads accents,
 * CRLF line ends, text cells always quoted. Text that a spreadsheet would run
 * as a formula (= + - @, tab, CR, even after spaces) gets a leading apostrophe.
 * Real numbers stay numbers, so "-5" from the ledger is still a number.
 */
const FORMULA = /^[\s]*[=+\-@\t\r]/;

export type CsvValue = string | number | null | undefined;

export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = FORMULA.test(v) ? `'${v}` : v;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  const line = (cells: CsvValue[]) => cells.map(csvCell).join(",") + "\r\n";
  return "\uFEFF" + line(header) + rows.map(line).join("");
}
