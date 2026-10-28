// Copies the barcode decoder (WASM) into public/ so it is served locally and
// precached for offline scanning (never loaded from a CDN).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const src = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
const dest = path.join(process.cwd(), "public", "zxing", "zxing_reader.wasm");
mkdirSync(path.dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("copied", path.relative(process.cwd(), dest));
