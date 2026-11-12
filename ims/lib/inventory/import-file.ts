import { fromBuffer } from "yauzl";
import { SaxesParser } from "saxes";
import { readSheet } from "read-excel-file/node";
import { ApiError } from "@/lib/api/errors";

export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_IMPORT_ROWS = 2000;
export const MAX_EXPANDED_BYTES = 16_000_000;
export const IMPORT_COLUMNS = ["sku", "name", "category", "unit", "min_stock", "description", "barcode"] as const;
export const IMPORT_TEMPLATE_TITLE = "Item Import Template";
export const IMPORT_TEMPLATE_INSTRUCTIONS =
  "Replace the example rows. Keep column names unchanged; use existing units/categories and text SKU/barcode values. No quantities or formulas. Maximum 2000 data rows.";
const TEMPLATE_HEADER_ROW = 6;
const MAX_WORKSHEET_ROWS = MAX_IMPORT_ROWS + TEMPLATE_HEADER_ROW;
export type ItemWorkbook = { rows: string[][]; headerRow: number };

const invalid = (message: string) => new ApiError("VALIDATION_FAILED", message);

/** Check actual inflated bytes before handing the archive to the Excel reader. */
async function preflight(buffer: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      let expanded = 0;
      let entries = 0;
      const names = new Set<string>();
      const fail = (e: unknown) => {
        zip.close();
        reject(e);
      };
      zip.on("error", fail);
      zip.on("end", resolve);
      zip.on("entry", (entry) => {
        if (names.has(entry.fileName)) return fail(invalid("The workbook contains duplicate archive entries."));
        names.add(entry.fileName);
        if (++entries > 128 || expanded + entry.uncompressedSize > MAX_EXPANDED_BYTES)
          return fail(invalid("The expanded workbook is too large. Split it into smaller files."));
        if (entry.generalPurposeBitFlag & 1 || /vbaProject\.bin$/i.test(entry.fileName))
          return fail(invalid("Encrypted or macro-enabled workbooks are not supported. Use a plain .xlsx file."));
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return fail(e);
          const chunks: Buffer[] = [];
          stream.on("error", fail);
          stream.on("data", (chunk: Buffer) => {
            expanded += chunk.length;
            if (expanded > MAX_EXPANDED_BYTES) {
              stream.destroy();
              return fail(invalid("The expanded workbook is too large. Split it into smaller files."));
            }
            if (/\.xml$/i.test(entry.fileName)) chunks.push(chunk);
          });
          stream.on("end", () => {
            try {
              if (chunks.length) {
                const parser = new SaxesParser({ xmlns: true });
                let rowCount = 0;
                let cellCount = 0;
                parser.on("doctype", () => {
                  throw invalid("Workbook XML declarations are not supported.");
                });
                parser.on("opentag", (tag) => {
                  if (tag.local === "f")
                    throw invalid("Formula cells are not supported. Replace formulas with values before importing.");
                  if (tag.local === "row" || tag.local === "c") {
                    const ref = tag.attributes.r?.value;
                    if (tag.local === "row" && ++rowCount > MAX_WORKSHEET_ROWS)
                      throw invalid(`Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
                    if (tag.local === "c" && ++cellCount > MAX_WORKSHEET_ROWS * IMPORT_COLUMNS.length)
                      throw invalid("Use only the seven template columns and up to 2000 data rows.");
                    if (tag.local === "row" && ref && (!/^[1-9]\d*$/.test(ref) || Number(ref) > MAX_WORKSHEET_ROWS))
                      throw invalid(`Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
                    if (tag.local === "c" && ref) {
                      if (!/^[A-G]([1-9]\d{0,3})$/.test(ref))
                        throw invalid("Use only the seven template columns (A through G).");
                      if (Number(ref.slice(1)) > MAX_WORKSHEET_ROWS)
                        throw invalid(`Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
                    }
                  }
                });
                parser.write(Buffer.concat(chunks).toString("utf8")).close();
              }
              zip.readEntry();
            } catch (err) {
              fail(err);
            }
          });
        });
      });
      zip.readEntry();
    });
  });
}

export async function parseItemWorkbook(buffer: Buffer): Promise<ItemWorkbook> {
  if (buffer.length > MAX_IMPORT_BYTES) throw invalid("The file is larger than 2 MB. Split it into smaller files.");
  try {
    await preflight(buffer);
    // Sheet 1 is intentional. Text cells and raw numeric strings avoid coercing codes.
    const rows = await readSheet(buffer, 1, { trim: false, parseNumber: (value) => value });
    const table = rows.map((row) =>
      row.map((value) => {
        if (value instanceof Date || typeof value === "boolean")
          throw invalid("Use text for item codes and details, not dates or boolean cells.");
        return value == null ? "" : String(value);
      }),
    );
    // Only the shipped preamble is recognized, never an arbitrary search through data.
    let headerRow = 1;
    if (table[1]?.[0] === IMPORT_TEMPLATE_TITLE) {
      const singleCell = (index: number) => table[index]?.slice(1).every((value) => value === "");
      if (
        !table[0]?.[0]?.trim() ||
        ![0, 1, 2, 3].every(singleCell) ||
        !table[2]?.[0]?.startsWith("Generated: ") ||
        table[3]?.[0] !== IMPORT_TEMPLATE_INSTRUCTIONS ||
        !table[4]?.every((value) => value === "") ||
        table[5]?.length !== IMPORT_COLUMNS.length ||
        !IMPORT_COLUMNS.every((column, index) => table[5][index] === column)
      )
        throw invalid("The template header is invalid. Keep the metadata and seven column names unchanged.");
      headerRow = TEMPLATE_HEADER_ROW;
    }
    if (table.length - headerRow > MAX_IMPORT_ROWS) throw invalid(`Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
    return { rows: table.slice(headerRow - 1), headerRow };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalid("The workbook is invalid, corrupt, or unsupported. Save it as a plain .xlsx file and try again.");
  }
}

/** Bound the multipart body even when Content-Length is absent or incorrect. */
export async function readImportForm(req: Request): Promise<FormData> {
  const limit = MAX_IMPORT_BYTES + 64_000;
  const reader = req.body?.getReader();
  if (!reader) throw invalid("Choose an .xlsx or .csv file to import.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw invalid("The file is larger than 2 MB. Split it into smaller files.");
      }
      chunks.push(value);
    }
    return await new Response(Buffer.concat(chunks), {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalid("The upload is invalid. Choose the file again.");
  }
}
