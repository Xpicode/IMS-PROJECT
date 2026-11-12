import { describe, expect, it, vi, afterEach } from "vitest";
import { createScanGate, itemSelectionError, outstandingReturnLine, resolveCameraCode } from "@/lib/camera-selection";

afterEach(() => vi.unstubAllGlobals());

describe("camera form selection", () => {
  const item = { id: "i", sku: "SKU" };

  it("resolves the raw scan, not an autocomplete query, and rejects the wrong record type", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: "location", id: "l" }) });
    vi.stubGlobal("fetch", fetch);
    await expect(resolveCameraCode("IMS:item/a?x=1", "item")).rejects.toThrow("not an item");
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/lookup?code=IMS%3Aitem%2Fa%3Fx%3D1");
    fetch.mockResolvedValue({ ok: true, json: async () => ({ type: "item", id: "i" }) });
    expect(await resolveCameraCode("SKU", "item")).toBe("i");
  });

  it("refuses an item already in the list", () => {
    expect(itemSelectionError(item, ["i"])).toContain("already");
    expect(itemSelectionError(item, [])).toBeNull();
  });

  it("returns only the line of this item that still has some out", () => {
    const lines = [
      { itemId: "a", status: "OUT" },
      { itemId: "b", status: "RETURNED" },
      { itemId: "c", status: "PENDING" },
    ];
    expect(outstandingReturnLine(lines, "a")).toBe(lines[0]);
    for (const id of ["b", "c", "another-loan"])
      expect(() => outstandingReturnLine(lines, id)).toThrow("not out on this loan");
  });

  it("ignores repeated frames in flight and invalidates a late result on close", async () => {
    const gate = createScanGate();
    let finish!: () => void;
    let current!: () => boolean;
    const pending = gate.run(async (isCurrent) => {
      current = isCurrent;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return isCurrent();
    });
    const repeated = vi.fn();
    expect(await gate.run(repeated)).toBe(false);
    expect(repeated).not.toHaveBeenCalled();
    gate.close();
    gate.open();
    expect(current()).toBe(false);
    finish();
    expect(await pending).toBe(false);
    expect(await gate.run(async () => true)).toBe(true);
    gate.close();
    expect(await gate.run(repeated)).toBe(false);
  });
});
