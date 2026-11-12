import { crc32, inflateRawSync } from "node:zlib";
import { expect } from "vitest";

/** Read the central directory as Excel does and verify each member's size and CRC. */
export function unzipXlsx(buf: Buffer): Record<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
  expect(end).toBe(buf.length - 22);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const name = buf.toString("ascii", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26);
    const raw = inflateRawSync(buf.subarray(start, start + size));
    expect(raw.length).toBe(buf.readUInt32LE(p + 24));
    expect(crc32(raw)).toBe(buf.readUInt32LE(p + 16));
    out[name] = raw.toString("utf8");
    p += 46 + nameLen;
  }
  return out;
}
