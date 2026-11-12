import { describe, expect, it, vi, afterEach } from "vitest";
import {
  borrowSelectionError,
  createScanGate,
  itemSelectionError,
  outstandingReturnLine,
  resolveCameraCode,
} from "@/lib/camera-selection";

afterEach(() => vi.unstubAllGlobals());

describe("camera form selection", () => {
  const item = { id: "i", sku: "SKU", trackingType: "ASSET" };
  const asset = { id: "a", tag: "TAG", locationId: "site", status: "AVAILABLE" };

  it("resolves the raw scan, not an autocomplete query, and rejects the wrong record type", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: "location", id: "l" }) });
    vi.stubGlobal("fetch", fetch);
    await expect(resolveCameraCode("IMS:asset/a?x=1", "item")).rejects.toThrow("not an item");
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/lookup?code=IMS%3Aasset%2Fa%3Fx%3D1");
    await expect(resolveCameraCode("SKU", "asset")).rejects.toThrow("not an asset");
  });

  it("keeps stock tracking and duplicate checks", () => {
    expect(itemSelectionError(item, "STOCK", [])).toContain("individual assets");
    expect(itemSelectionError({ ...item, trackingType: "STOCK" }, "ASSET", [])).toContain("counted stock");
    expect(itemSelectionError(item, "ASSET", ["i"])).toContain("already");
    expect(itemSelectionError(item, "ASSET", [])).toBeNull();
  });

  it("only borrows available assets at the release location without duplicates", () => {
    expect(borrowSelectionError(asset, "elsewhere", [])).toContain("release location");
    expect(borrowSelectionError(asset, null, [])).toContain("release location");
    for (const status of ["BORROWED", "LOST", "RETIRED", "NEEDS_REVIEW", "UNDER_MAINTENANCE"])
      expect(borrowSelectionError({ ...asset, status }, "site", [])).toContain("can't be borrowed");
    expect(borrowSelectionError(asset, "site", ["a"])).toContain("already");
    expect(borrowSelectionError(asset, "site", [])).toBeNull();
  });

  it("returns only OUT assets on the current loan", () => {
    const lines = [
      { assetId: "a", status: "OUT" },
      { assetId: "b", status: "RETURNED" },
      { assetId: "c", status: "PENDING" },
    ];
    expect(outstandingReturnLine(lines, "a")).toBe(lines[0]);
    for (const id of ["b", "c", "another-loan"])
      expect(() => outstandingReturnLine(lines, id)).toThrow("not outstanding on this loan");
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
