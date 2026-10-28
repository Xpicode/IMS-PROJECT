# Inventory Management System (IMS)

Project tracker. **Read this before starting any IMS work.** After any work: tick the finished phase items below and add a dated line to the [Log](#log).

- **Spec (the rules):** `../../IMS_MVP.md` (v1.0, 19 Oct 2026). "§" references point here.
- **Build plan (the order):** `../../IMS_BUILD_PLAN.md` (28 Oct 2026)
- **Code:** `../../ims/` (Next.js app, single repo per spec §14)
- **Scope rule:** work stays inside `Documents\Inventory`.

---

## Handoff

**Current phase:** Phase 4 – Sync & counts **built** 28 Oct 2026 (8 of 9 items; the two-phone conflict test is left). Phase 3 – Field PWA built, still waiting on the real-phone test. Both real-phone tests can run in one session. **Phase 5 – Borrowing, handovers & PDFs is next.** Phases 1–2 done.
**Last updated:** 28 Oct 2026

**State:**
- Repo: https://github.com/Xpicode/IMS-PROJECT (public), branch `main`. Repo root is `Documents\Inventory`. Last pushed: `3dfc64e` (Phase 3 + tracker note); the user pushes from their own cmd window.
- Run: `cd ims && docker compose -f compose.dev.yaml up --build --watch` (project `inventory-ims-dev`, app on :3000, Postgres on `127.0.0.1:5433`, test DB `ims_test`). Or `npm run db:up && npm run dev` on the host. Only one `next dev` per folder.
- **The service worker only runs in a production build** (dev shows "Development mode: the offline app is turned off"). To test offline: `npm run build` then `npx next start -p 3100` (port 3000 is the Docker dev app; cookies are shared across ports on localhost). `npm run build` copies the scanner WASM to `public/zxing/` (git-ignored).
- Demo users `admin@` / `supervisor@` / `field@ims.local`, password = `SEED_PASSWORD` in `ims/.env`. Seed adds a labeled sample catalog. Test data from browser checks: ISS-2026-000001, TRN-2026-000001, RCV-2026-000003, laptops IT-0001/IT-0002, PPE-0100, PPE-0101, TOOL-GRINDER, unit `carton`, `test.counter@ims.local`, `MAIN-WH-R1`. **Phase 3 test data:** 110 items `LOAD-0001..0110` ("Load test item", 5 each at SITE-B via RCV-2026-000004/5), drills TOOL-0004/0005 at SITE-B, counts CNT-2026-000001 ("Site B – October count") and CNT-2026-000002 ("Site B – full count (offline test)"), both open and assigned to the field user. The ledger is append-only, so these stay; they are labeled as test data.
- `npm run check` = typecheck + lint + Prettier + **211 tests (109 unit, 102 integration)**, all green.
- Phase 4 code map: server `lib/counts/sync.ts` (push), `lib/counts/review.ts` (review/approve/keep/recount/approve-matching/reopen), count freeze in `lib/inventory/stock.ts` (`checkCountFreeze`); API `app/api/v1/sync/push`, `app/api/v1/counts/[id]/{review,reopen,approve-matching,lines/[lineId]/{approve,keep,recount}}`; phone `lib/field/outbox.ts`, `lib/field/refresh.ts`, sync state in `components/field/field-context.tsx`, `components/field/send-result.tsx`; office `components/counts/{counts-list,count-review,new-count-wizard}.tsx`, pages `/counts`, `/counts/new`, `/counts/[id]`. Migration `0005_sync_and_reviews`.
- **Phase 4 test data:** CNT-2026-000002 is now **closed**: 110 counts received, 10 lines reviewed (adjustments ADJ-2026-000001..000006 on LOAD-0001..0004/0006/0007), LOAD-0010 recounted after ISS-2026-000002 (issued under a count exception), 1 conflict (TOOL-0004 sent after closing). CNT-2026-000003 "Workshop tools spot check" (created with the wizard, closed). CNT-2026-000001 is still open at SITE-B, so LOAD items and PPE-0001 at SITE-B are frozen until it's closed.
- Phase 3 code map: `lib/counts/service.ts`; API `app/api/v1/counts/**`, `app/api/v1/sync/bootstrap`; phone side `lib/field/` (`db` Dexie schema, `store`, `identity`, `device`, `net` time-limited fetch, `scan-formats`); `components/field/` (`field-app` = router + boot, `field-context`, `field-shell` header/nav/update banner, `scanner`, `install-help`, `views/*`); `app/(field)/field/page.tsx`; SW `sw/sw.ts` served by `app/serwist/[path]/route.ts`; `app/manifest.ts`, `app/icons/`, `public/offline.html`; office `components/counts/*` on `/counts`, `components/scan/scan-lookup.tsx` on `/scan`.

**Still waiting on the user (Phase 0):** real inventory export, whole vs decimal quantities (built as whole numbers), location hierarchy, approvers/signers, form samples, reference number format (built as `ISS-2026-000123`), label paper size (built for A4 70×37 mm, 24/sheet), **list of pilot phones (model + OS)** for the Phase 3 device test.

**Next step:**
1. With the user, one session on real phones over HTTPS: the Phase 3 device test (install, airplane mode, 100+ lines, force-close, reopen, camera scans) **and** the Phase 4 two-device test (two phones, two accounts, count the same line differently, send, check the review shows "Counts disagree"; then pull the network mid-send and confirm no duplicates). Write a device test report here, then tick the last items of Phases 3 and 4.
2. Ask the user to confirm the two open Phase 4 decisions: the count-freeze policy, and "approving a not-found asset marks it Lost".
3. Phase 5 – Borrowing, handovers & PDFs: read `IMS_BUILD_PLAN.md` Phase 5 and spec §7.5, §7.6, §7.8, §13 first. Needs the company's real form samples (Phase 0) for the PDF templates.

**Testing tricks (needed every session):**
- Never type passwords through the browser tool. `bash AppData/Local/hermes/cache/scratch/ims-login.sh <role> > tok-<role>` logs in through the real Auth.js endpoint, then `ims_as(role)` in the browser workspace helpers sets the cookie.
- The browser tab must be in front (`ims_front()` = `Page.bringToFront` + focus emulation). A hidden tab never paints, so React never swaps streamed content in (pages stuck on "Loading…"), dialogs don't open, and screenshots hang.
- Native `curl` on Windows can't write to `/dev/null` (exit 23). Use `-o NUL`.
- Offline tests: CDP `Network.emulateNetworkConditions offline` does **not** stop the service worker's own requests, so a page can still come from the server. For a real offline test, stop the `next start` server (find its PID with `netstat -ano | grep :3100`, then `MSYS_NO_PATHCONV=1 taskkill /PID <pid> /F`).
- The test browser sometimes restarts with a fresh profile (SW + IndexedDB gone). Re-download the count before an offline test and keep offline steps in short calls. `ims_count_batch(aid, start, end)` in the browser helpers counts LOAD items through the real UI.
- Browser JS evals can't wait more than ~5 s; split waits into separate calls.
- After a schema change, the Docker web container keeps its old generated database client (`generated/` isn't synced). Run `docker compose -f compose.dev.yaml exec -T web npx prisma generate`, then `docker compose -f compose.dev.yaml restart web`.
- To simulate "server saved it but the phone lost the answer", wrap `window.fetch` in the page so the first `/sync/push` call awaits the real response and then throws. The field app calls the global `fetch` at call time.
- In confirm sheets, click the button **inside** `[role=dialog]`. `ims_click("Approve")` can hit the row's own Approve button behind the sheet.
- `npm run build` on the host writes ~1,500 files to `.next/`. Even though `.next/` is ignored, the burst of file events can crash `docker compose watch` ("Watch disabled with errors: short read in readEvents()"). The app keeps running but edits stop syncing. After a host build, restart it: `docker compose -f compose.dev.yaml watch --no-up`.

---

## Decisions

Choices made during the build that the spec/plan left open or that deviate from them. Each needs sign-off if it touches business behavior.

| Date | Decision | Why |
|---|---|---|
| 2026-10-28 | **Next.js 16.4.3 with `cacheComponents` turned off** (the create-next-app default turned it on) | Every IMS page is per-user and authenticated. Cache Components forces Suspense/`use cache: private` around every session read, which is complexity the MVP doesn't need. |
| 2026-10-28 | **Auth.js v5 (`next-auth@5.0.0-beta.32`) Credentials with database-backed sessions**: the "JWT" is replaced by an opaque random token, and its SHA-256 is stored in `sessions` | Auth.js doesn't support Credentials with its database strategy. This gives the plan's "database sessions": logout, deactivation, and role/location/password changes end sessions immediately. The cookie is `ims_session` (`__Host-ims_session` over HTTPS), HTTP-only, SameSite=Lax. |
| 2026-10-28 | Auth routes live at `/api/v1/auth/*` (Auth.js `basePath`), not `/api/v1/auth/login` | Auth.js owns the login/CSRF endpoints. Behavior matches §12.1. |
| 2026-10-28 | Prisma **7.10.1** + `@prisma/adapter-pg`; client generated to `ims/generated/prisma` | Current stable. Note: npm's `latest` tag for the `prisma` CLI points to 8.0.0-rc, so the version is pinned. |
| 2026-10-28 | Passwords: argon2id via `@node-rs/argon2` (19 MiB, t=2) | OWASP baseline. Prebuilt binaries for Windows and Alpine. |
| 2026-10-28 | **Location access is inherited:** a user assigned to a location also gets every child location (rack/area). Each assignment is `FULL` or `VIEW_ONLY`. | Spec says "assigned scope" but not how hierarchy works. **Needs confirmation (Phase 0, location hierarchy).** |
| 2026-10-28 | Admin is global (all locations). Supervisor/Field are limited to their effective locations. Only admins add top-level locations; supervisors add children inside their scope. | §5 matrix plus §16 "role and location checks on all reads and writes". |
| 2026-10-28 | Hidden records return **404**, not 403 (e.g. another site's location) | §12.3 "show not found without exposing hidden records". |
| 2026-10-28 | Password reset = **admin-issued one-time link** (1 hour, single use, stored hashed). The login page's "Forgot password?" tells users to ask their admin. | §16 requires a verified, time-limited process. There is no company email/SMTP yet. Add email delivery once SMTP is confirmed. |
| 2026-10-28 | Migration 0001 also includes `sessions`, `password_reset_tokens`, `idempotency_keys` | Needed by Phase 1 auth and `withIdempotency()`. |
| 2026-10-28 | `audit_events` is append-only, enforced by a DB trigger | §9.1/§16. `writeAudit()` also drops any key that looks like a password, hash, token, or secret. |
| 2026-10-28 | Company timezone is a setting (`NEXT_PUBLIC_COMPANY_TIMEZONE`), default `Asia/Manila` | **Placeholder until confirmed (Phase 0).** |
| 2026-10-28 | UI kit: shadcn 4.23 (`radix-nova` style, Radix base). It uses shadcn's `cn` npm package (replaces clsx + tailwind-merge, which were removed). `next-themes` removed (light only). | Plan §3.5. |
| 2026-10-28 | Controls resized to the plan: buttons/inputs 48px, field primary 56px, inputs 16px text, `--input` border #6B7280 (4.8:1; the first choice #9CA3AF measured only 2.5:1 and was corrected); `--neutral` text #4B5563 (plan's #6B7280 fails AA on its tinted chip) | §3.1/§3.4, WCAG AA. |
| 2026-10-28 | DataList: in the table view, row actions collapse into one "Actions" menu; phone cards show full buttons | Tables overflowed sideways at 768px with 2–3 action buttons. |
| 2026-10-28 | Placeholder menu pages (Stock, Assets, Counts, Borrowing, Documents, Reports, Scan, Sync) say "Not set up yet – planned for build phase N" | Lets each role see the right menu now (Phase 1 "done when") without dead ends. |
| 2026-10-28 | Top-bar search searches **locations** for now; becomes ScanInput in Phase 2 (marked `shortcut:` in code) | Nothing else to search in Phase 1. |
| 2026-10-28 | `/dev/ui` returns 404 in production | Dev style guide only. |
| 2026-10-28 | Security headers in `next.config.ts` (nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy camera=self) | §16 baseline; NGINX adds HSTS later. |
| 2026-10-28 | Dev compose project name is `inventory-ims-dev`, DB host port 5433 | `ims-dev` clashed with another project on this PC, and 5432 is already in use. |
| 2026-10-28 | **Quantities are whole numbers** (Zod `int`, DB `integer`, CHECK `quantity >= 0` on balances) | §9.2 default. **Needs confirmation (Phase 0):** if some items are measured (meters, liters), switch those to decimals before go-live. |
| 2026-10-28 | Reference numbers `RCV-/ISS-/TRN-YYYY-000001`, per type and per year (company timezone), gap-free via a locked row in `document_sequences` | §9.1. **Format needs confirmation (Phase 0).** |
| 2026-10-28 | Asset tags `PREFIX-0001`, numbered per prefix (prefix chosen when adding assets, default = first part of the SKU) | §6.2 doesn't fix a tag format. |
| 2026-10-28 | Items are company-wide master data (one record; balances per location). Supervisors may add items/units/categories; field staff can't. | §5 "manage item and asset records" for supervisors. |
| 2026-10-28 | Ledger tables (`stock_transactions`, `stock_movements`, `asset_events`) are append-only via DB triggers; corrections will be reversing transactions (Phase 4/5) | §9.3. |
| 2026-10-28 | Row-lock order for stock confirms: balances locked `ORDER BY item_id, location_id` after an upsert of missing rows | Avoids deadlocks when two transfers touch the same pair in opposite directions. |
| 2026-10-28 | Duplicate serial numbers are **flagged, not blocked**, when adding assets | §6.2 "warn". |
| 2026-10-28 | Labels: A4, 70 × 37 mm, 3 × 8 per sheet; QR = `ims:<type>:<uuid>`, Code 128 = SKU/tag; generated server-side as SVG with `bwip-js` | Common label paper. **Paper size needs confirmation (Phase 0).** |
| 2026-10-28 | Top-bar search goes to `/find`: an exact code (QR payload, SKU, tag, location code, manufacturer barcode) opens the record; anything else searches items. Camera scanning is Phase 3. | Replaces the Phase 1 locations-only search. |
| 2026-10-28 | CSV import validates the whole file first and imports **only valid rows** in one transaction; rows with errors are listed and skipped. Units/categories must exist (new "Units & categories" page) | §9.5. |
| 2026-10-28 | Seed adds a **labeled sample catalog** (description says "Sample data (seed)") with opening stock written as real receipts so ledger = balances | Real export not received yet. Remove/replace before go-live. |
| 2026-10-28 | Field app = one static page `/field` (screens by `?v=`), reads only IndexedDB; the SW serves it for any `/field?…` navigation | §10.4: field routes must not depend on a fresh server render. |
| 2026-10-28 | Scanner = `barcode-detector` ponyfill (ZXing WASM, served from our own `/zxing/`, precached), formats QR, Code 128, EAN-13, UPC-A, EAN-8, UPC-E | Spec named `@zxing/browser`; this uses the same ZXing engine through the standard BarcodeDetector API, and uses the phone's native detector when there is one. |
| 2026-10-28 | UPC-A and the same code as EAN-13 with a leading 0 are treated as one code | Phones report UPC-A either way. |
| 2026-10-28 | Blind count: expected quantities are **never** sent to or stored on the phone | §10.3. |
| 2026-10-28 | A re-count of the same item replaces the earlier value, never adds | A12. |
| 2026-10-28 | Phone data is kept per user; the last signed-in user's id/name/role (no password, no token) is kept so the app opens offline; signing out keeps unsent counts for that user | Spec §10.3. Sign-out needs internet. |
| 2026-10-28 | Phase 3 has **no sending**: counts stay on the phone as "Draft on this device"; the Sync screen says so plainly | Sending (outbox, push) is Phase 4. |
| 2026-10-28 | Count sessions: whole location only, counters must have count access there, only assigned people can see a session | Minimal creation per the plan; item picking is Phase 4. |
| 2026-10-28 | Field staff land on `/field`; their Home/Scan/Sync/Me links go to the field app. Office users get a camera Scan page that opens the record | §5 roles. |
| 2026-10-28 | Phone outbox has a separate `REJECTED` state next to the spec's 5 states (`PENDING`/`SENDING`/`ACKED`/`CONFLICT`/`FAILED`) | So "no permission / invalid" is shown differently from "session closed / recount". |
| 2026-10-28 | Counts are sent with an explicit **Send counts** step (not automatically on every save) | §7.7 step 5–6: staff can revise until submitting. |
| 2026-10-28 | Count freeze = block receive/issue/transfer of the counted items at that location while the count is open; supervisor can override with a reason; such lines need a recount before approval | §7.7 default. **Needs confirmation that this fits the sites (Phase 0).** |
| 2026-10-28 | Approving a line posts one `ADJ-YYYY-NNNNNN` adjustment for (counted − current balance), only if no stock moved since the line's snapshot | §9.3 / §11.6: never apply a stale count over later movements. |
| 2026-10-28 | Approving an asset "not found" marks it **Lost**; a found asset with a different condition gets the new condition | Spec doesn't say what an approved asset result changes. **Needs confirmation.** |
| 2026-10-28 | Lines where two counters disagree are never auto-approved: the reviewer picks one count or requests a recount | A18: no silent last-write-wins. |
| 2026-10-28 | A recount request re-takes expected from the current balance (database clock), sets the old counts aside, and raises the line and session versions; counts made before it come back as `RECOUNT_REQUESTED` conflicts | §11.1 rule 7 (base version). |
| 2026-10-28 | Counts can be reviewed and approved while the count is open or closed; recounts need it open (closed counts can be reopened) | Spec doesn't say when review may start. |
| 2026-10-28 | One adjustment per line is enforced by the database (one review per line, unique adjustment per review); row locks only turn a race into a clean "already approved" message | §9.3, A21. |

---

## Phase checklists

Copied from `IMS_BUILD_PLAN.md` §6. A phase is done only when its listed acceptance tests pass.

### Phase 0: Verify & design (Week 1)

**Business inputs (§20)**
- [ ] One real sample of each form: remittal/transmittal, borrowing, return, stock issuance
- [ ] Sanitized inventory export (Excel/CSV) to define SKUs, categories, and units
- [ ] Location hierarchy (warehouse / site / area)
- [ ] Who approves releases and adjustments, and who signs each form
- [ ] Numbering convention (default: `BOR/RET/ISS/TRN-YYYY-000001`)
- [ ] Whole-number or decimal quantities (default: whole numbers)
- [ ] Count freeze policy (default: short freeze; exceptions need recount)
- [ ] List of real field phones (model + OS), and the longest expected time offline
- [ ] Hostinger plan, domain, logo, company details

**Design work**
- [ ] 3 user stories: office admin, supervisor, field counter
- [ ] Low-fi wireframes for the 10 key screens
- [ ] Hallway test of count screen + issue wizard
- [ ] Confirm color tokens against company logo and check contrast

**Tech checks**
- [ ] Spike: `@zxing/browser` scan of QR, Code 128, EAN-13, UPC-A on field phones
- [ ] Spike: blank PWA on iPhone + Android, IndexedDB survives restart

### Phase 1: Foundation (Weeks 2–3) — ✅ DONE 28 Oct 2026

**Backend**
- [x] Repo per §14 layout. TypeScript strict, ESLint, Prettier
- [x] `compose.dev.yaml`: Postgres 17 + Next.js hot reload; `.env.example` _(built and run: migrate + seed + dev server in the container; a source edit showed up via Compose watch)_
- [x] Prisma schema, migration `0001`: `users`, `user_locations`, `locations`, `categories`, `units`, `audit_events`
- [x] Auth.js credentials login, password hashing, HTTP-only cookies, logout, deactivation enforced server-side _(real sign-in endpoint for all 3 roles; Sign out button ends the DB session, so the old token gets 401; deactivated users are blocked)_
- [x] One permission helper `requireAccess(user, action, locationId?)`, unit-tested against the role matrix
- [x] Shared helpers: Zod validation, error shape `{code, message, requestId}`, `writeAudit()`, `withIdempotency()`
- [x] `GET /api/health`, `GET /api/v1/me`
- [x] Seed: 1 admin, 1 supervisor, 1 field user, 3 locations

**UI / UX**
- [x] Tailwind tokens (§3.1) + Inter font + shadcn setup _(every text/chip pair measured ≥ 4.5:1; input border 4.8:1)_
- [x] Core components: `Button`, `Input`, `NumberInput`, `StatusChip`, `DataList`, `ConfirmSheet`, `Wizard` shell, `Toast` _(all used in the browser: steppers, letter rejection, confirm error state on phone drawer, wizard Back/Confirm)_
- [x] Responsive app shell: sidebar ≥1024, icon rail 768–1023, bottom nav <768; top bar with search + `SyncPill` placeholder
- [x] Screens: Login (clear errors + reset link), Users (list / create / deactivate), Locations _(clicked through: user edit, deactivate, reset link; location add, deactivate refusal. The sign-in form itself was not typed into by the browser tool, by rule; its endpoint and error codes were checked with curl)_
- [x] `/dev/ui` living style guide page

**Tests**
- [x] Permission matrix unit tests
- [x] First steps of A22/A23 (field user blocked by the API)

**Done when:** `docker compose up` from the README, log in as each role, right menu, layout works at 360 / 768 / 1280 px. ✅ _(9/9 role × width combinations: right menu, no horizontal page scroll)_

### Phase 2: Stock & assets (Weeks 4–5) ✅ DONE 28 Oct 2026

- [x] Migration: `items`, `item_identifiers`, `assets`, `asset_events`, `stock_balances`, `stock_transactions`, `stock_movements`
- [x] Services `receiveStock`, `issueStock`, `transferStock` (one DB transaction, row locks §9.3, no negatives, integer qty)
- [x] Asset status transition map + `changeAssetStatus()` writing `asset_event`
- [x] Idempotency key required on receive/issue/transfer
- [x] CSV import: upload → preview with row errors → commit
- [x] Label payloads `ims:item|asset|location:<uuid>`
- [x] Item list → Item detail (balances per location, movements)
- [x] Receive / Issue / Transfer wizards (review shows before → after)
- [x] Asset list → Asset detail with history timeline
- [x] "Add assets" with quantity
- [x] Label print page (A4, QR / Code 128)
- [x] CSV import screen
- [x] Dashboard v1: KPI cards + low-stock list
- [x] Tests A01–A06 incl. concurrency test on real Postgres

### Phase 3: Field PWA (Weeks 6–7) — 🟡 BUILT 28 Oct 2026, waiting on the real-phone test

- [x] Migration: `count_sessions`, `count_session_items`, `count_entries` _(`0004_counts`, plus assignees; CHECKs: kind matches asset, expected ≥ 0; partial unique indexes so an item/asset is in a session once)_
- [x] Minimal count-session creation _(office **Counts** page: name, location, due date, stock and/or assets, counters who can count at that location; Close. Whole location only; picking items is Phase 4)_
- [x] `GET /api/v1/sync/bootstrap?sessionId=` _(only assignees get it; NOT_FOUND for anyone else; never cacheable; no expected quantities)_
- [x] Manifest, icons, `offline.html`; Serwist SW (no private API caching) _(checked in a production build: 58 precached files, 0 `/api` responses in any cache; office pages show `offline.html` when the server is down)_
- [x] Field routes client-rendered from Dexie _(`/field` is a static shell; `?v=…` screens; opens from phone data in 0.3 s with the server stopped)_
- [x] Dexie DB per user (`ims-field-<userId>`)
- [x] `navigator.storage.persist()` + quota check on Me screen
- [x] Update banner (never reload during a count) _(new build → "New version ready… Update now"; nothing reloads until tapped; 110 counts kept across the update)_
- [x] Field Home, Download for offline use, Scan screen, Count screen, Asset check, My results, Install help, Storage-full error _(storage-full/disabled: unit-tested (A30); not forced in a browser)_
- [ ] Tests A11–A14, A29, A30 + device test report _(automated: A11 decode of QR / Code 128 / EAN-13 / UPC-A from generated labels, A12, A30 unit tests. Desktop Chrome at 360 px: A12 re-scan opens the old count; A13 110 lines counted with the server stopped; A14 tab closed + reopened offline, all 110 there (sum of quantities matches); A29 no camera → clear message + typing works. **Not done: real Android + iPhone in airplane mode, real camera scans, and the device test report**: needs the pilot phones (Phase 0 list))_

### Phase 4: Sync & counts (Weeks 8–9) — 🟡 BUILT 28 Oct 2026, waiting on the two-phone test

**Goal (plan):** offline work reaches the server exactly once, conflicts are visible, and stock changes only after approval.
**Done when (plan):** pull the network mid-upload, retry, and get no duplicates; approved variances post exactly one adjustment each; a supervisor can review a 100-line session in a few minutes.

- [x] Migration: `sync_operations`, `count_reviews` _(`0005_sync_and_reviews`: both tables append-only by trigger; CHECKs: an approved non-zero variance must have its adjustment, "keep expected" never has one; one review per line, one adjustment per review; lines get `snapshot_at` + `recount_requested`)_
- [x] `POST /api/v1/sync/push` (≤50 ops, §11.4 order, idempotent by user+operation_id+hash) _(`lib/counts/sync.ts`; each op its own transaction; session row locked; outcome stored with the count; 14 tests, 8 guards mutation-proven)_
- [x] Results `ACKED` / `CONFLICT` / `REJECTED` / `RETRYABLE_ERROR` _(CONFLICT codes `SESSION_CLOSED`, `RECOUNT_REQUESTED`; REJECTED codes `FORBIDDEN`, `VALIDATION_FAILED`, `OPERATION_REUSED`; each with a plain message + next action)_
- [x] Re-download assignments after push _(`lib/field/refresh.ts`: after every send, and on Sync now with nothing to send; closed counts are marked "closed by supervisor", recount requests show on the line. A recount also raises the session version. 2 unit tests; seen in the browser)_
- [x] Reconciliation service (one adjustment per line) _(`lib/counts/review.ts` + API: review, approve (Idempotency-Key), keep expected, recount, approve-matching, reopen. 12 tests + HTTP test; 8 of 10 mutations caught. The 2 that survived: "variance from expected" is the same value as from the balance whenever approval is allowed, and the line lock; one adjustment per line is enforced by the database itself (unique review per line), the locks only give a cleaner error)_
- [x] Count freeze + supervisor exception _(receive/issue/transfer of a counted item at that location is refused with `COUNT_IN_PROGRESS` while the count is open; the stock wizards then show a "Stock count in progress" box with a reason field; with a reason it goes ahead, audited as `count.exception`, and the line shows "moved during count" in the review. 5 tests, 3 guards mutation-proven; browser: ISS-2026-000002 issued under an exception)_
- [x] Client outbox lifecycle, auto-retry, Sync now, no cross-account sends _(`lib/field/outbox.ts`: frozen ops, double-tap safe, same IDs on retry, SENDING recovery, batches of 50, wrong-user/signed-out stop; 9 tests, 6 guards mutation-proven. Auto-retry every 30 s and when back online. Browser: response to the first batch thrown away after the server saved it → automatic retry → 110 entries, 110 operations, no duplicates)_
- [x] Sync screen, live `SyncPill`, Count sessions office UI, Reconciliation review _(Sync screen with per-state counts, need-attention list (message + next action + Send again); live pill and badge; Counts list with progress, Review/Close/Reopen; `/counts/new` 5-step wizard with category filter; `/counts/[id]` review with filters, inline Approve, Choose count, Request recount, Keep expected, Approve-all-matching. Sweep admin + supervisor × 360/768/1280: no failures. At 768 the review table scrolls sideways inside its box)_
- [ ] Tests A15–A21, A28, §11.5 scenarios, two-device test _(automated: A15–A21, A28 and the §11.5 scenarios all pass (server + phone tests); A16/A19/A20/A21 also checked in the browser. **Not done: the two-device conflict test on real phones** (A18 is covered by tests with two accounts, not two real devices))_

#### Phase 4 design (written before coding, 28 Oct 2026)

**1. Database (migration `0005_sync_and_reviews`)**
- `sync_operations`: one row per (user, operation ID): device ID, type, payload hash (SHA-256), result (`ACKED` / `CONFLICT` / `REJECTED`), the stored response, time. Primary key (`user_id`, `operation_id`). `RETRYABLE_ERROR` is never stored, so a retry runs again.
- `count_reviews`: one row per count line (unique per line): decision (`APPROVED` / `KEPT_EXPECTED`), expected, counted, variance, which count entry was used, the adjustment transaction (unique, so one line can never post two adjustments), reviewer, time, note.
- `count_session_items`: add a per-line snapshot time and a "recount requested" flag. A recount takes a fresh expected quantity and raises the line's version.
- `count_entries` (exists): a new count from the same person for the same line marks their older one `SUPERSEDED`. Counts from **different** people stay side by side (A18).

**2. Sending counts: `POST /api/v1/sync/push`** (spec §11.3–11.4)
- Up to 50 operations per request. Each one is handled **separately, in its own database transaction**, in the order sent.
- For each operation: check the shape → look up (user, operation ID): same hash = return the stored answer; different hash = `REJECTED`, original kept (A17) → lock the session → checks → save the count, audit event, and outcome **in the same transaction**.
- Results:
  - `ACKED`: saved.
  - `CONFLICT`: session closed/cancelled (A19), or a recount was requested (line version changed). The count is kept on the phone and the message says what to do.
  - `REJECTED`: the person lost access, was deactivated, or was removed from the count (A28), or the data is invalid. The count is kept on the phone for review.
  - `RETRYABLE_ERROR`: unexpected server error; the phone retries with the same ID.

**3. Phone side (outbox, spec §11.2)**
- New **"Send counts"** button on the assignment / My results screen: copies every new or changed count into the outbox as a frozen operation with a new UUID. Counts can still be edited afterwards; an edit becomes a new operation that replaces the older one on the server (never changing an already-sent payload).
- Outbox states: `PENDING` (submitted on device) → `SENDING` → `ACKED` (received by server) / `CONFLICT` / `REJECTED` / `FAILED` (retry). `SENDING` rows found when the app starts are re-sent with the **same** ID (A16).
- **Sync now** button is always there; while the app is open and online it also retries by itself (every 30 s and when the connection returns).
- Never sends under another account: before sending, the phone checks that the signed-in server user is the same person who owns the outbox; otherwise it stops and says so.
- After a send, it re-downloads open assignments (simple pull, §11.3), marks closed ones as "Closed by supervisor", and shows "Recount requested" on lines whose version went up.
- The header pill shows live state: "N not sent", "Sending…", "N need attention", "All sent".

**4. Count freeze (§7.7)**
- While a count is **open** at a location, receive / issue / transfer of items in that count is blocked there with a clear message.
- A supervisor/admin can go ahead anyway by recording an **exception with a reason** (audit event + reason on the transaction). That line is then flagged "stock moved during the count" in the review and needs a recount before it can be approved.

**5. Reconciliation review (supervisor)**
- New page `/counts/[id]`: progress per counter and per line, plus the review table: expected / counted / variance (colored) / counter notes / stock moved during the count / status.
- Actions per line: **Approve** (posts **one** `ADJ-` adjustment for the difference; zero difference posts nothing), **Request recount** (session must be open), **Keep expected** (no change).
- **Approve all with no difference** in one click; lines with a difference must be approved one by one (plan rule).
- Approval is blocked when stock moved during the count, when two counters disagree (pick one or recount), or when the session was cancelled. Repeating an approval never posts twice (A21: idempotency key + unique adjustment per line).
- Assets: approving "not found" sets the asset to **Lost**; approving a changed condition updates the condition (asset history event).
- Filters so 100+ lines are quick: Needs decision / Has difference / No difference / Done.

**6. Office count screens**
- `/counts/new` wizard: location → what to count (everything, or chosen categories) → people → due date → review.
- Counts list gets a progress column and opens the session page. Close and **Reopen** buttons.

**7. Tests to write first**
- Server: A16 (same op twice = one count), A17 (same ID, changed data → rejected, original kept), A18 (two people → two entries, review shows "counts disagree"), A19 (closed session → conflict, no adjustment), A20 (approve → exactly one adjustment, ledger = balances), A21 (repeat approve → no second adjustment), A28 (access removed while offline → rejected), freeze + exception, 50-op limit.
- Phone (fake-indexeddb + fake server): A15 (queue clears only for acknowledged), §11.5 "response lost" retry, `SENDING` recovery on restart, double-tap = one operation, site down = queue stays, different account = nothing sent.
- Browser: send 110 offline counts after reconnecting, cut the network mid-send and retry (no duplicates), review and approve a 100-line session, timed.

### Phase 5: Borrowing, handovers & PDFs (Weeks 10–11)

- [ ] Migration: `borrowings`, `borrowing_lines`, transmittals, `document_sequences`, `pdf_documents`
- [ ] Release (locks, AVAILABLE only, one transaction)
- [ ] Per-line returns; header closes when all lines resolved
- [ ] Transmittal confirm links to real event
- [ ] Number allocation in confirm transaction; immutable snapshot
- [ ] `pdf-lib` renderer for 4 templates
- [ ] Private PDF storage, access-checked route
- [ ] PDF failure → retry from snapshot
- [ ] Borrow wizard, Loans list, Return flow, Field drafts, Document center, post-confirm success screen
- [ ] Tests A07–A10, A24, A25 + paper print check

### Phase 6: Hardening, deployment & pilot (Weeks 12–14)

- [ ] 5 fixed reports + CSV (formula-injection escaping)
- [ ] Audit log viewer
- [ ] Dashboard v2 "Needs your action"
- [ ] Accessibility pass, Lighthouse ≥ 90
- [ ] Responsive pass 360 / 390 / 768 / 1024 / 1440
- [ ] Security review (§16 + OWASP ASVS)
- [ ] k6 load test
- [ ] Dockerfile, production compose, NGINX + Certbot, `limit_req`
- [ ] VPS hardening (§15.6)
- [ ] Migrations as separate step after backup
- [ ] Nightly encrypted `pg_dump` + PDF volume off-VPS
- [ ] Witnessed restore (A26); container replacement (A27)
- [ ] Monitoring
- [ ] Quick guides, training, pilot, §19 turnover items

---

## Log

- **2026-10-28** – Tracker created in `Documents\Inventory\Projects\Code\`. No prior handoff existed; the two plan docs had no progress recorded. Started Phase 1: scaffolded `ims/` with `create-next-app@16.4.3` (TypeScript, Tailwind v4, ESLint, App Router).
- **2026-10-28** – Phase 1 backend. Installed deps (Prisma 7.10.1, next-auth 5 beta.32, Zod 4, Vitest 5, argon2). Wrote `prisma/schema.prisma` and migration `0001_foundation` (6 planned tables + `sessions`, `password_reset_tokens`, `idempotency_keys`, check constraints, append-only audit trigger). Built `lib/permissions` (`requireAccess`/`can`), `lib/api` (error shape, `route()` wrapper with request id, CSRF origin check, audit of denied access), `lib/validation`, `lib/audit`, `lib/idempotency`, `lib/auth` (Auth.js + DB sessions), and the user and location services. Added API routes: health, me, users (+ `[id]`, password-reset), locations (+ `[id]`), and the Auth.js handler. Added seed and `compose.dev.yaml`. 82 tests green, and a mutation check confirmed the A22/CSRF tests fail when their guards are removed. tsc and ESLint are clean.
- **2026-10-28** – Incident: the first `docker compose up` used project name `ims-dev`, which replaced the stopped `ims-dev-db-1` container of another project on this PC (`Documents\KIan\IMS PROJECT`). That project's data volume `ims-dev_ims-dev-db` was not touched. Running its own compose again recreates the container. Renamed this project to `inventory-ims-dev`.
- **2026-10-28** – (Tooling, outside the app) Added the Ponytail skills to Hermes at the user's request. The plugin installer rejected the package's manifest, so the 6 `SKILL.md` files were installed as skills instead.
- **2026-10-28** – Phase 1 UI (session 2). Fixed `next.config.ts`: Cache Components was still on even though the Decisions table said it was off. shadcn init (radix-nova) + 16 components. §3.1 tokens in `globals.css`, Inter via `next/font`, 48px controls, focus ring, tabular numbers. Built common components: `StatusChip` (all §3.2 statuses), `DataList` (table ↔ cards, empty/loading, pagination, row-actions menu), `ConfirmSheet`, `ResponsiveDialog` (Dialog ↔ bottom Drawer), `NumberInput`, `Wizard` shell, `SyncPill` placeholder, `Field`, `EmptyState`, `PageHeader`. Responsive `AppShell` with role menus (`lib/nav.ts`). Pages: dashboard/My assignments, Me, 8 placeholder sections, Users (list, add, edit, deactivate/reactivate, one-time reset link), Locations (list, search, add, edit, deactivate), login/forgot/reset-password, `/dev/ui`, loading/error/not-found. `verifyCredentials` now reports deactivated accounts so login can say why (test changed first). Added `lib/format.ts` (company-time dates) and `lib/safe-next.ts` (open-redirect guard), each with tests. **92 tests pass** (62 unit + 30 integration, each in their latest run); tsc and ESLint clean.
- **2026-10-28** – Checked in a real browser and with curl: Auth.js credentials login works for admin/supervisor/field (302 to `/`, HTTP-only `ims_session` cookie); a wrong password redirects with `code=invalid_login`; `/api/v1/me` scope is correct per role; a field user gets 403 on `/api/v1/users`. Users page at 1280, Locations at 768, Users at 360: right layout and no horizontal page scroll (measured `scrollWidth == innerWidth`). **Not done:** the Add-user dialog didn't open in the browser test (a hydration mismatch between server/client `Button` sizes was reported after hot reload; cause not yet confirmed). Found a second `next dev` (PID 7472) already serving this folder on :3000. All browser tests ran against it, and the one I started exited. My shell command to inspect that process was **blocked waiting for approval**, so testing stopped there until the user answers.
- **2026-10-28** – Put the project under git (repo root `Documents\Inventory`) and pushed it to **https://github.com/Xpicode/IMS-PROJECT** (`main` at `043f3fd`, merged with GitHub's initial README). Confirmed on GitHub: `ims/`, `Projects/`, the two plan docs, and README are there; `ims/.env` is not (404). The repo is **public**. The earlier remote `Xpicode/IMS` still has only its README commit.
- **2026-10-28** – **Phase 1 finished (session 3).** The "Add user dialog doesn't open" bug was **not an app bug**: the test browser tab was hidden, so no frames were painted (React waits for a frame to swap streamed content in and to animate dialogs). Fixed in the test helpers (`ims_front`). With the user's OK, stopped the stray `next dev` servers (PID 7472 had already exited; killed 16240, started our own) and later moved to the Docker stack. Clicked through in the browser: Add-user field errors; edit user (role → Supervisor, MAIN-WH) → toast + list updated; deactivate via confirm sheet → Inactive; one-time reset link shown with expiry; add location `MAIN-WH-R1` inside MAIN-WH (code uppercased); deactivating MAIN-WH refused with the error kept in the sheet; field user gets "You don't have access" on Users and sees only SITE-B; supervisor sees only MAIN-WH/R1/WORKSHOP and no Users menu; Sign out → /login and the old token gets 401. `/dev/ui`: NumberInput steppers and letter rejection, Wizard to Review (fixed "R…" truncation at 360 with a "Step 4 of 4: Review" line), ConfirmSheet as a phone drawer with its error state. Docker dev stack built and run (migrate + seed + dev), health OK, hot reload via Compose watch confirmed (test edit reverted). Added `.prettierrc.json` and formatted the codebase, npm scripts (`check`, `test:*`, `db:*`), `ims/README.md`. Contrast measured: all text/chip pairs ≥ 4.5:1, **input border failed (2.54:1) and was fixed** to #6B7280. Done-when sweep: 3 roles × 360/768/1280 → right menu, no sideways scroll, 9/9. `npm run check` green (92 tests). Test data added: user `test.counter@ims.local` (created via API, now inactive), location `MAIN-WH-R1`.
- **2026-10-28** – **Phase 2 finished (session 4).** Migrations `0002_stock_and_assets` (items, identifiers, assets, asset events, balances, transactions, movements; CHECKs for normalized codes and no negative stock; append-only triggers) and `0003_append_only_message`. Services written test-first: `receiveStock`/`issueStock`/`transferStock` (one DB transaction, row locks in a fixed order, gap-free references, `withIdempotency`, audit event), `createAssets` (×N tags, serial-duplicate warning), `changeAssetStatus` (§9.4 map + version check + asset event), `updateAsset`, CSV preview/commit, `resolveCode` (QR payload, SKU, tag, location, barcode). Mutation checks: removing `FOR UPDATE` makes the A04 concurrency test fail (`['ok','ok']`, two issues of the last 3 units); removing the asset version check makes the stale-update test fail. API: items (+ export CSV, import), stock receipts/issues/transfers/balances, assets (+ status), lookup, units, categories; HTTP tests include A22 (field user → 403, balance unchanged) and replay with the same Idempotency-Key. Screens: Stock list (search, category, All/Low/Out), item detail (balances per location, movement history), Receive/Issue/Transfer wizards (review shows before → after at **both** ends of a transfer), Add item dialog, CSV import (drop/pick file, red error rows, "Import N valid rows"), Assets list/detail with history timeline and Change status, Add assets ×N, A4 label sheet, Units & categories, Dashboard v1 (6 KPI cards + low/out list), top-bar search → `/find`. Browser checks in Docker: Issue on a phone (360) incl. "Only 120 pair left" block and recipient errors → ISS-2026-000001; Transfer on desktop → TRN-2026-000001; Receive on a tablet via SKU + Enter (scanner style) → RCV-2026-000003; 2 laptops → IT-0001/0002 with duplicate-serial warning; status change with reason; labels printed to PDF (A4, 26 labels = 2 pages, header hidden); CSV with 8 rows → 3 imported, 5 clear errors. Fixed during checks: phone result buttons collapsed (`flex-1` in a column), asset Condition blank (constant imported from a client file), label page sideways scroll at 360/768, CSV error pointed to a page that didn't exist (built Units & categories). Sweep admin + supervisor × 360/768/1280 × 12 pages: 72/72 load with no sideways scroll and 0 dev-overlay issues; field user gets "You don't have access" on all stock/asset pages and 0 labels for another site's asset. Dev DB check: ledger sums = balances (8 rows), transfers net to 0. `npm run check` green: **140 tests (81 unit, 59 integration)**. Added deps `bwip-js`. Still pending from the user: Phase 0 inputs (see Handoff).
- **2026-10-28** – **Phase 3 built (session 5); real-phone test still to do.** Test-first: migration `0004_counts`; count service (create/list/my assignments/bootstrap/close; only assignees see a session: a mutation check showed this guard wasn't tested, so a "colleague at the same site" test was added); UPC-A ↔ EAN-13 code equivalence; Dexie store (re-count replaces, storage errors never claim "saved": both proven by mutation checks); scan formats decoded by ZXing from real generated labels (first failed: transparent PNGs without a quiet zone → white background + padding). Built the field app (`/field`): My assignments, Download for offline use, Scan (camera + typing; clear message with no camera / denied permission), Count, Asset check (Found/Not found + condition), My results (editable), Sync (honest "on this phone, not sent"), Me (storage use, "Keep my data safe", install help, sign-out warning about unsent counts), update banner. Office: Counts page (create/close), camera Scan page; field users are sent to `/field`. Browser checks (Docker dev, 360 px): created CNT-2026-000001 on desktop; as the field user downloaded it, typed an unknown code (clear message), counted PPE-0001 = 38, re-scan showed "Already counted: 38… replaces, not added" (A12), asset check blocked "Found" without a condition, saved TOOL-0004 Damaged + TOOL-0005 Not found. Production build on :3100: SW active, 58 files precached; with the **server stopped** the app opened from the phone in 0.3 s, **110 counts** entered offline (A13), tab closed and reopened offline → 110/110 there, quantity sum 2505 as typed, no expected quantities on the phone (A14); deep link to My results offline works; a new build showed "New version ready" and waited for the tap, counts kept. Fixed during checks: Home stuck on "Loading…" and pill saying "Online" when the server was unreachable (fetch without a time limit; now 4–6 s limits, phone data shown first, pill tracks whether the server answered); office pages offline showed Chrome's error page instead of `offline.html` (no SW route for them; added a network-only route so the fallback applies); form errors stayed visible after fixing the field (New count, Asset check). Sweep admin + supervisor × 360/768/1280 on `/counts` and `/scan`: no failures. `npm run check` green: **166 tests (97 unit, 69 integration)**. Not done: real Android/iPhone + real camera + device test report (needs pilot phones and HTTPS). Test data added: LOAD-0001..0110 (5 each at SITE-B), TOOL-0004/0005, CNT-2026-000001/2. Deps added: `dexie`, `barcode-detector`, `serwist`, `@serwist/turbopack`, dev `fake-indexeddb`. Committed as "Phase 3 built…"; **push from the agent shell hung on the GitHub login, so the user pushes from their own cmd window.**
- **2026-10-28** – **Phase 4 started (session 6).** Confirmed the user pushed `6b09d29` + `3dfc64e` (local `main` = `origin/main`). Re-read build plan Phase 4 and spec §7.7, §9.3, §10.3–10.6, §11 and A15–A21/A28, plus the current count schema, Dexie DB, stock service and idempotency helper. Wrote the Phase 4 design into this note (database, push endpoint, phone outbox, count freeze, reconciliation, office screens, tests) and logged 5 new decisions, 2 of which need the user's confirmation (count freeze policy; what approving an asset result does). No code changed yet.
- **2026-10-28** – Phase 4 progress (session 6, part 1). Migration `0005_sync_and_reviews` applied to the dev DB. **Server send endpoint** `POST /api/v1/sync/push` built test-first (`tests/integration/sync.test.ts`, 13 tests + 1 HTTP test): ACK stores the count + audit + outcome in one transaction; same op again → same answer, one count (also when two copies arrive at once) (A16); same ID with changed content → REJECTED, original kept, audit `sync.operation_reused` (A17); a person's new count supersedes their old one; two people → two observations (A18); closed session → CONFLICT, evidence in audit `count.conflict`, retry gets the same answer (A19); recount requested → CONFLICT with the new version; lost access / removed from count → REJECTED (A28); deactivated account → whole request refused; bad ops rejected without blocking good ones; >50 ops refused. Mutation checks: removing each of 8 guards (hash check, advisory lock, version check, assignee check, permission check, supersede, closed check, shape check) made a test fail. **Phone outbox** logic built test-first (`tests/unit/field-outbox.test.ts`, 9 tests, fake IndexedDB + fake server): A15, A16 lost response, SENDING recovery, site down, RETRYABLE_ERROR, wrong account/signed-out/offline send nothing, batches of 50, Send again. 6 guards mutation-proven. Dexie DB is now version 2 (outbox indexes). Next: wire Send counts / Sync now / pill / auto-retry into the field screens, then freeze, reconciliation, office screens.
- **2026-10-28** – Phase 4 progress (session 6, part 2). Field screens wired to sync: shared sync state with auto-retry (30 s + when back online, queued counts only), live header pill (Offline · N not sent / Sending… / N need attention / N not sent / All sent), Sync badge, **Send counts** on the assignment and My results, status chip per line (incl. "Not accepted" and "Recount requested"), Sync screen rebuilt (counts per state, Sync now, need-attention list with the server's message + next action + Open count / Send again, per assignment), recount notice on the count screen, re-download of assignments after a send (`lib/field/refresh.ts`, 2 tests). **Count freeze** in `lib/inventory/stock.ts` (5 tests). **Reconciliation** `lib/counts/review.ts` (12 tests) + routes under `app/api/v1/counts/[id]/…`. Not yet: office review screen, count list progress/reopen, create wizard, exception in stock wizards, browser tests.
- **2026-10-28** – **Phase 4 built (session 6, part 3); two-phone test still to do.** Office screens: `/counts/[id]` review (filters Needs decision / Has difference / No difference / Not counted / Done / All, inline Approve, Choose count, Request recount, Keep expected, Approve all with no difference, Close/Reopen), Counts list with progress, `/counts/new` 5-step wizard (category filter added to count creation, test-first). Stock wizards offer the count-freeze exception. Browser checks in Docker: field user counted 110 lines at 360 px and sent them while the first batch's answer was thrown away (server had saved it) → automatic retry → **110 entries, 110 operations, no duplicates** (A16); admin approved 3 matching lines in one go (no adjustment) and 6 variance lines one by one (~2 s each in the test tool) → **ADJ-2026-000001..000006, one per line, ledger = balances** (A20); Issue of LOAD-0010 at SITE-B refused with "Stock count in progress", issued with a reason (ISS-2026-000002), line shown "moved −2 during count", recount requested, phone saw "Recount requested" after Sync now, recounted 3, approved; count closed, then a count sent from the phone came back as a conflict with a plain explanation and stayed on the phone, nothing saved on the server (A19); wizard at 360 created CNT-2026-000003. **Bugs found and fixed:** (1) "Couldn't reach the server" stayed on screen after the automatic retry succeeded; it now shows the latest result. (2) The review table was wider than a 1280 px screen and rows were ~150 px tall; the moved amount and the counter's name now sit inside other cells, so it fits and rows are ~100 px. (3) Approve appeared twice on phone cards. (4) **A recount request never reached phones**: it raised only the line version and Sync now did nothing when nothing was queued; now the session version goes up too (test-first) and Sync now always re-downloads. (5) The phone offered "Keep 10" on a line that needed a recount (that would only cause a conflict); it is hidden now. (6) Leaving the exception reason empty said "check the highlighted fields" but highlighted nothing; the reason box now shows the error. Also: the Docker container needed `prisma generate` + restart after the schema change. `npm run check` green: **211 tests (109 unit, 102 integration)**; production build OK. **Unexplained:** one standalone run of the integration tests had 42 failures; 3 reruns plus the full check all passed, and that run's log wasn't kept, so the cause is unknown (integration files already run one at a time).
