import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import bwipjs from "bwip-js/node";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { codeVariants, labelPayload } from "@/lib/codes";

const require = createRequire(import.meta.url);
const ID = "6f1c2d3e-4b5a-4c6d-8e7f-901234567890";

beforeAll(async () => {
  const wasm = readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
  await prepareZXingModule({
    overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer },
    fireImmediately: true,
  });
});

async function roundTrip(bcid: string, text: string) {
  // White background and quiet zone, like a printed label.
  const png = await bwipjs.toBuffer({
    bcid,
    text,
    scale: 3,
    backgroundcolor: "FFFFFF",
    paddingwidth: 12,
    paddingheight: 12,
    ...(bcid === "qrcode" ? {} : { height: 12 }),
  });
  const r = await readBarcodes(new Uint8Array(png), {
    formats: ["QRCode", "Code128", "EAN13", "UPCA"],
    tryHarder: true,
  });
  return r.map((x) => [x.format, x.text]);
}

describe("A11: the field scanner decodes every label and barcode type we use", () => {
  it("IMS label QR (ims:asset:<uuid>)", async () => {
    expect(await roundTrip("qrcode", labelPayload("asset", ID))).toEqual([["QRCode", `ims:asset:${ID}`]]);
  });
  it("Code 128 (SKU / asset tag on IMS labels)", async () => {
    expect(await roundTrip("code128", "TOOL-0001")).toEqual([["Code128", "TOOL-0001"]]);
  });
  it("EAN-13 (manufacturer barcode)", async () => {
    expect(await roundTrip("ean13", "4006381333931")).toEqual([["EAN13", "4006381333931"]]);
  });
  it("UPC-A (manufacturer barcode), even when the decoder reports it as EAN-13 with a leading 0", async () => {
    const [[format, text]] = await roundTrip("upca", "036000291452");
    expect(["UPCA", "EAN13"]).toContain(format);
    // The stored code is the 12-digit UPC; the lookup must still match.
    expect(codeVariants(text)).toContain("036000291452");
  });
});
