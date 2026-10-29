/**
 * k6 load test at pilot size (spec §17, build plan Phase 6).
 *
 *   10 office users giving out stock at the same time, mostly the same 5 items
 *      (worst case for the row locks), plus dashboard/stock list reads;
 *   30 field phones sending count batches (50 lines each) in bursts.
 *
 * Runs against the app directly on the compose network (NGINX rate limits are
 * per IP and would only measure the limiter). See docs/runbook.md "Load test".
 *
 *   docker run --rm -i --network <project>_default -e BASE=http://web:3000 \
 *     -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... \
 *     grafana/k6 run - < load/pilot.js
 */
import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE = __ENV.BASE || "http://web:3000";
const ORIGIN = __ENV.ORIGIN || BASE;
const OFFICE = Number(__ENV.OFFICE || 10);
const FIELD = Number(__ENV.FIELD || 30);
const RUN = __ENV.RUN_ID || String(Date.now()).slice(-6);
// Pilot mode: people pause 3-8 s between actions. STRESS=1: no pauses, to find the limit.
const STRESS = __ENV.STRESS === "1";
const think = () => {
  if (!STRESS) sleep(3 + Math.random() * 5);
};

const issued = new Counter("units_issued");
const issueRefused = new Counter("issues_refused_409_422");
const syncAcked = new Counter("sync_ops_acked");
const syncOther = new Counter("sync_ops_conflict_or_rejected");
const issueTime = new Trend("issue_duration", true);
const syncTime = new Trend("sync_push_duration", true);

export const options = {
  setupTimeout: "5m",
  scenarios: {
    office_issues: { executor: "constant-vus", vus: OFFICE, duration: STRESS ? "90s" : "3m", exec: "office" },
    // All phones send at once (worst case: everyone back in signal at the same time).
    field_sync: {
      executor: "per-vu-iterations",
      vus: FIELD,
      iterations: 3,
      maxDuration: "4m",
      exec: "field",
      startTime: "10s",
    },
  },
  // Pilot targets (Phase 6): screens people wait on stay under 2 s for 95% of
  // requests; a worst-case sync burst (every phone sending 50 lines in the same
  // second) finishes within 15 s, in the background on the phone.
  thresholds: {
    http_req_failed: ["rate<0.01"], // 409/422 are expected answers, not failures
    issue_duration: ["p(95)<2000"],
    "http_req_duration{kind:read}": ["p(95)<2000"],
    sync_push_duration: ["p(95)<15000"],
  },
};
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409, 422));

function login(email, password) {
  // Cookies by hand: production cookies are Secure (__Host-), and k6's jar won't
  // send those back over the plain-HTTP internal connection.
  const c0 = http.get(`${BASE}/api/v1/auth/csrf`, { jar: null });
  const pre = Object.entries(c0.cookies)
    .map(([n, v]) => `${n}=${v[0].value}`)
    .join("; ");
  const r = http.post(
    `${BASE}/api/v1/auth/callback/credentials`,
    { email, password, csrfToken: c0.json("csrfToken"), callbackUrl: `${ORIGIN}/` },
    { redirects: 0, jar: null, headers: { origin: ORIGIN, cookie: pre } },
  );
  const c = Object.entries(r.cookies).find(([n]) => n.endsWith("ims_session"));
  if (!c) fail(`login failed for ${email}: HTTP ${r.status} ${r.headers.Location || ""}`);
  return `${c[0]}=${c[1][0].value}`;
}
const H = (cookie, extra = {}) => ({
  headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...extra },
});
function post(cookie, path, body, extra) {
  const r = http.post(`${BASE}${path}`, JSON.stringify(body), H(cookie, extra));
  if (r.status >= 300) fail(`${path} -> ${r.status} ${r.body}`);
  return r.json();
}

export function setup() {
  const admin = login(__ENV.ADMIN_EMAIL, __ENV.ADMIN_PASSWORD);
  const wh = post(admin, "/api/v1/locations", {
    code: `LOAD-WH-${RUN}`,
    name: `Load warehouse ${RUN}`,
    type: "WAREHOUSE",
  });
  const site = post(admin, "/api/v1/locations", { code: `LOAD-SITE-${RUN}`, name: `Load site ${RUN}`, type: "SITE" });
  const unit = post(admin, "/api/v1/units", { code: `u${RUN}`, name: `Unit ${RUN}` });
  const items = [];
  for (let i = 0; i < 60; i++)
    items.push(
      post(admin, "/api/v1/items", {
        sku: `LD${RUN}-${i}`,
        name: `Load item ${i}`,
        unitId: unit.id,
        trackingType: "STOCK",
        minStock: 5,
      }).id,
    );
  const lines = items.map((itemId) => ({ itemId, quantity: 100000 }));
  post(admin, "/api/v1/stock/receipts", { locationId: wh.id, lines }, { "idempotency-key": uuidv4() });
  post(admin, "/api/v1/stock/receipts", { locationId: site.id, lines }, { "idempotency-key": uuidv4() });

  const field = [];
  for (let i = 0; i < FIELD; i++) {
    const email = `load${RUN}-${i}@load.local`;
    const password = `${uuidv4()}x`;
    const u = post(admin, "/api/v1/users", {
      name: `Load phone ${i}`,
      email,
      password,
      role: "FIELD",
      locations: [{ id: site.id }],
    });
    field.push({ id: u.id, email, password });
  }
  const count = post(admin, "/api/v1/counts", {
    name: `Load count ${RUN}`,
    locationId: site.id,
    assigneeIds: field.map((f) => f.id),
  });
  const office = [];
  for (let i = 0; i < OFFICE; i++) office.push(admin); // admins share one session: fine, issues are per request
  const fieldCookies = field.map((f) => login(f.email, f.password));
  return { wh: wh.id, items, office, fieldCookies, countId: count.id };
}

export function office(d) {
  const cookie = d.office[(__VU - 1) % d.office.length];
  // 80% of issues on the 5 hottest items (row-lock contention), the rest spread out.
  const itemId =
    Math.random() < 0.8 ? d.items[Math.floor(Math.random() * 5)] : d.items[5 + Math.floor(Math.random() * 55)];
  const t0 = Date.now();
  const r = http.post(
    `${BASE}/api/v1/stock/issues`,
    JSON.stringify({
      locationId: d.wh,
      lines: [{ itemId, quantity: 1 }],
      recipientName: `Load ${__VU}`,
      purpose: `Load test ${RUN}`,
    }),
    { ...H(cookie, { "idempotency-key": uuidv4() }), tags: { kind: "write" } },
  );
  issueTime.add(Date.now() - t0);
  if (r.status === 201 || r.status === 200) issued.add(1);
  else if (r.status === 409 || r.status === 422) issueRefused.add(1);
  check(r, { "issue saved": (x) => x.status === 201 || x.status === 200 });
  if (__ITER % 5 === 0) {
    const s = http.get(`${BASE}/api/v1/stock/balances?locationId=${d.wh}`, {
      headers: { cookie },
      tags: { kind: "read" },
    });
    check(s, { "stock list ok": (x) => x.status === 200 });
    const p = http.get(`${BASE}/`, { headers: { cookie }, tags: { kind: "read" } });
    check(p, { "dashboard ok": (x) => x.status === 200 });
  }
  think();
}

export function field(d) {
  const cookie = d.fieldCookies[(__VU - 1) % d.fieldCookies.length];
  const b = http.get(`${BASE}/api/v1/sync/bootstrap?sessionId=${d.countId}`, {
    headers: { cookie },
    tags: { kind: "read" },
  });
  if (!check(b, { "bootstrap ok": (x) => x.status === 200 })) return;
  const targets = b.json("targets");
  // Each phone counts 50 of the 60 lines, starting at a different place, so
  // some lines are counted by several phones (real overlap, conflicts expected).
  const start = (__VU * 7 + __ITER * 13) % targets.length;
  const operations = [];
  for (let k = 0; k < 50; k++) {
    const t = targets[(start + k) % targets.length];
    operations.push({
      operationId: uuidv4(),
      type: "SUBMIT_COUNT",
      sessionId: d.countId,
      targetId: t.id,
      baseVersion: t.version ?? 1,
      payload: { quantity: 99990 + (k % 10), notes: "" },
    });
  }
  const t0 = Date.now();
  const r = http.post(`${BASE}/api/v1/sync/push`, JSON.stringify({ deviceId: `load-${__VU}`, operations }), {
    ...H(cookie),
    tags: { kind: "sync" },
  });
  syncTime.add(Date.now() - t0);
  if (!check(r, { "sync push ok": (x) => x.status === 200 })) return;
  for (const res of r.json("results")) (res.status === "ACKED" ? syncAcked : syncOther).add(1);
  if (!STRESS) sleep(20 + Math.random() * 20); // next batch after more counting
}
