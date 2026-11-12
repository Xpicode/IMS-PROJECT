import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AccessUser } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  users: vi.fn(),
  types: vi.fn(),
  access: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    auditEvent: { findMany: mocks.findMany, count: mocks.count },
    user: { findMany: mocks.users },
    $queryRaw: mocks.types,
  },
}));
vi.mock("@/lib/auth/page", () => ({ pageAccess: mocks.access }));
vi.mock("@/components/admin/audit-list", () => ({
  AuditList: (props: { href: string; total: number }) => createElement("a", { href: props.href }, props.total),
}));

import { listAudit } from "@/lib/audit/viewer";
import AuditPage from "@/app/(app)/settings/audit/page";

const admin: AccessUser = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "ADMIN",
  status: "ACTIVE",
  locations: [],
};
const routine = [
  "auth.signed_in",
  "auth.signed_out",
  "borrowing.drafted",
  "count.submitted",
  "count.approved_matching",
  "count.created",
  "count.assignees_changed",
  "item.photo_changed",
  "company.logo_changed",
  "document.redrawn",
  "report.exported",
];
const important = [
  "auth.login_failed",
  "auth.locked",
  "auth.forbidden",
  "count.submit_denied",
  "sync.operation_reused",
  "stock.received",
  "user.updated",
  "borrowing.photo_changed",
  "future.new_action",
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.users.mockResolvedValue([]);
  mocks.types.mockResolvedValue([{ t: "auth" }, { t: "count" }]);
  mocks.access.mockResolvedValue({ user: admin, allowed: true });
});

describe("audit service (real permissions and query construction, mocked database)", () => {
  it("uses only the exact routine denylist, leaving security, mutations and unknown actions visible", async () => {
    await listAudit(admin, {});
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.NOT.eventType.in.toSorted()).toEqual(routine.toSorted());
    for (const action of important) expect(where.NOT.eventType.in).not.toContain(action);
    expect(mocks.count.mock.calls[0][0].where).toBe(where);
  });

  it("applies importance and all existing filters before pagination and calculates filtered page totals", async () => {
    mocks.count.mockResolvedValue(9);
    const result = await listAudit(admin, {
      userId: admin.id,
      from: "2026-01-01",
      to: "2026-01-02",
      page: 2,
      pageSize: 4,
    });
    const query = mocks.findMany.mock.calls[0][0];
    expect(query).toMatchObject({
      skip: 4,
      take: 4,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      where: {
        NOT: { eventType: { in: routine } },
        actorId: admin.id,
        createdAt: { gte: new Date("2025-12-31T16:00Z"), lte: new Date("2026-01-02T15:59:59.999Z") },
      },
    });
    expect(mocks.count.mock.calls[0][0].where).toBe(query.where);
    expect(result).toMatchObject({ total: 9, pageCount: 3, page: 2, view: "important" });
  });

  it.each([
    { view: "all" as const },
    { eventType: "count" },
    { eventType: "auth.signed_in", view: "important" as const },
    { recordId: "record-1" },
    { recordType: "item" },
  ])("includes routine events for All or explicit investigations: %j", async (filters) => {
    expect((await listAudit(admin, filters)).view).toBe("all");
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("NOT");
    if ("eventType" in filters) expect(where.eventType).toEqual({ startsWith: filters.eventType });
    if ("recordId" in filters) expect(where.recordId).toBe(filters.recordId);
    if ("recordType" in filters) expect(where.recordType).toBe(filters.recordType);
    expect(mocks.count.mock.calls[0][0].where).toBe(where);
  });

  it("rejects non-admins before database reads", async () => {
    await expect(listAudit({ ...admin, role: "SUPERVISOR" }, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });
});

const page = async (search: Record<string, string> = {}) =>
  renderToStaticMarkup(await AuditPage({ searchParams: Promise.resolve(search), params: Promise.resolve({}) }));

describe("audit page (real page and service, mocked database)", () => {
  it("defaults to Important, collapses accessible advanced filters, and clears to the default URL", async () => {
    const html = await page();
    expect(html).toContain('<option value="important" selected="">Important events</option>');
    expect(html).toContain('<option value="all">All events</option>');
    expect(html).toMatch(/<details[^>]*>/);
    expect(html).not.toMatch(/<details[^>]*open/);
    for (const id of ["a-view", "a-user", "a-type", "a-rec", "a-from", "a-to"]) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('href="/settings/audit"');
  });

  it.each<Record<string, string>>([{ eventType: "auth.signed_in" }, { recordId: "record-1" }])(
    "auto-opens and clearly selects All for an explicit investigation: %j",
    async (filters) => {
      const html = await page({ ...filters, view: "important", size: "50", from: "2026-01-01", page: "2" });
      expect(html).toContain('<option value="all" selected="">All events</option>');
      expect(html).toMatch(/<details[^>]*open=""/);
      expect(html).toContain("All events is active");
      expect(html).toContain('name="size" value="50"');
      expect(html).toContain(
        `href="/settings/audit?view=all&amp;${new URLSearchParams(filters)}&amp;from=2026-01-01&amp;size=50"`,
      );
      if (filters.eventType) expect(html).toContain(`<option value="${filters.eventType}" selected="">`);
    },
  );

  it("preserves By/date/All/page-size filters in pagination and opens More filters for By", async () => {
    const html = await page({ userId: admin.id, view: "all", to: "2026-01-02", size: "50", page: "2" });
    expect(html).toMatch(/<details[^>]*open=""/);
    expect(html).toContain(`href="/settings/audit?view=all&amp;userId=${admin.id}&amp;to=2026-01-02&amp;size=50"`);
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({ skip: 50, take: 50, where: { actorId: admin.id } });
    expect(mocks.findMany.mock.calls[0][0].where).not.toHaveProperty("NOT");
  });

  it("does not query audit data when page access is denied", async () => {
    mocks.access.mockResolvedValue({ user: admin, allowed: false });
    await page();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.types).not.toHaveBeenCalled();
  });

  it("preserves the special All rows page-size value", async () => {
    const html = await page({ size: "all" });
    expect(html).toContain('name="size" value="all"');
    expect(html).toContain('href="/settings/audit?view=important&amp;size=all"');
    expect(mocks.findMany.mock.calls[0][0].take).toBe(1000);
  });
});
