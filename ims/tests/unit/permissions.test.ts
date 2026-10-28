import { describe, expect, it } from "vitest";
import { can, requireAccess, type Action, type AccessUser } from "@/lib/permissions";
import { ApiError } from "@/lib/api/errors";

const WH_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";
const WH_C = "33333333-3333-4333-8333-333333333333";

function user(role: AccessUser["role"], locations: AccessUser["locations"] = []): AccessUser {
  return { id: "u-" + role, role, status: "ACTIVE", locations };
}

const admin = user("ADMIN");
const supervisor = user("SUPERVISOR", [
  { id: WH_A, access: "FULL" },
  { id: WH_C, access: "VIEW_ONLY" },
]);
const field = user("FIELD", [{ id: SITE_B, access: "FULL" }]);

// Spec §5 role matrix. "assigned" = only at the user's assigned locations.
// "own" = only the user's own work/records.
type Expect = "yes" | "no" | "assigned" | "own";
const MATRIX: Record<Action, [admin: Expect, supervisor: Expect, field: Expect]> = {
  "settings.manage": ["yes", "no", "no"],
  "masterData.manage": ["yes", "assigned", "no"],
  "locations.manage": ["yes", "assigned", "no"],
  "locations.view": ["yes", "assigned", "assigned"],
  "records.view": ["yes", "assigned", "assigned"],
  "counts.create": ["yes", "assigned", "no"],
  "counts.perform": ["yes", "assigned", "assigned"],
  "counts.submit": ["yes", "assigned", "assigned"],
  "counts.approve": ["yes", "assigned", "no"],
  "stock.move": ["yes", "assigned", "no"],
  "drafts.prepare": ["yes", "assigned", "assigned"],
  "custody.confirm": ["yes", "assigned", "no"],
  "documents.download": ["yes", "assigned", "own"],
  "reports.view": ["yes", "assigned", "own"],
};

describe("permission matrix (§5)", () => {
  const people = [
    ["ADMIN", admin, null],
    ["SUPERVISOR", supervisor, WH_A],
    ["FIELD", field, SITE_B],
  ] as const;

  for (const [action, expectations] of Object.entries(MATRIX) as [Action, Expect[]][]) {
    people.forEach(([role, u, home], i) => {
      const expected = expectations[i];
      it(`${role} ${action}: ${expected}`, () => {
        const other = role === "FIELD" ? WH_A : SITE_B;
        switch (expected) {
          case "yes":
            expect(can(u, action)).toBe(true);
            expect(can(u, action, WH_A)).toBe(true);
            expect(can(u, action, SITE_B)).toBe(true);
            break;
          case "no":
            expect(can(u, action)).toBe(false);
            expect(can(u, action, home ?? WH_A)).toBe(false);
            break;
          case "assigned":
          case "own":
            expect(can(u, action, home!)).toBe(true);
            expect(can(u, action, other)).toBe(false);
            break;
        }
      });
    });
  }
});

describe("requireAccess", () => {
  it("returns global scope for admin", () => {
    expect(requireAccess(admin, "stock.move", WH_A)).toEqual({ scope: "global" });
  });

  it("returns the assigned location ids for list queries without a location", () => {
    expect(requireAccess(supervisor, "records.view")).toEqual({
      scope: "assigned",
      locationIds: [WH_A, WH_C],
    });
  });

  it("returns own scope for field reports", () => {
    expect(requireAccess(field, "reports.view")).toEqual({ scope: "own", locationIds: [SITE_B] });
  });

  it("throws FORBIDDEN (403) when the role lacks the action (A22)", () => {
    try {
      requireAccess(field, "stock.move", SITE_B);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).code).toBe("FORBIDDEN");
    }
  });

  it("throws FORBIDDEN for another site's location (A23)", () => {
    expect(() => requireAccess(field, "records.view", WH_A)).toThrow(ApiError);
  });

  it("allows reads but blocks writes on a VIEW_ONLY location", () => {
    expect(can(supervisor, "records.view", WH_C)).toBe(true);
    expect(can(supervisor, "stock.move", WH_C)).toBe(false);
    expect(can(supervisor, "masterData.manage", WH_C)).toBe(false);
  });

  it("leaves VIEW_ONLY locations out of write-scope lists", () => {
    expect(requireAccess(supervisor, "stock.move")).toEqual({
      scope: "assigned",
      locationIds: [WH_A],
    });
  });

  it("blocks a write-scope list when no location has FULL access", () => {
    const viewer = user("SUPERVISOR", [{ id: WH_C, access: "VIEW_ONLY" }]);
    expect(() => requireAccess(viewer, "stock.move")).toThrow(ApiError);
  });

  it("treats an inactive user as signed out (401) even for admins", () => {
    const gone = { ...admin, status: "INACTIVE" as const };
    expect(can(gone, "records.view")).toBe(false);
    try {
      requireAccess(gone, "records.view");
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).status).toBe(401);
      expect((e as ApiError).code).toBe("ACCOUNT_INACTIVE");
    }
  });

  it("denies a supervisor with no assigned locations", () => {
    const lonely = user("SUPERVISOR");
    expect(can(lonely, "records.view")).toBe(false);
    expect(can(lonely, "records.view", WH_A)).toBe(false);
  });
});
