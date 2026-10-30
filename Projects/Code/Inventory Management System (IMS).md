---
tags:
  - project
type: code
status: in-progress
started: 2026-10-19
stack: Next.js, TypeScript, Tailwind + shadcn/ui, PostgreSQL, Prisma, Dexie (PWA offline), Docker, NGINX
hosting: Hostinger KVM VPS
---

# Inventory Management System (IMS)

Project tracker. **Read this before starting any IMS work.** After any work: tick the finished phase items below and add a dated line to the [Log](#log).

> The master copy lives in the repo (`C:\Users\UPRHT-PC8-2025\Documents\Inventory\Projects\Code\`). The Obsidian vault holds a copy. Edit the repo copy, then copy it over the vault note. Relative paths below start from the repo copy.

- **Spec (the rules):** `../../IMS_MVP.md` (v1.0, 19 Oct 2026). "§" references point here.
- **Build plan (the order):** `../../IMS_BUILD_PLAN.md` (28 Oct 2026)
- **Code:** `../../ims/` (Next.js app, single repo per spec §14)
- **Scope rule:** work stays inside `Documents\Inventory`.

---

## Handoff

> **Phase 6 in progress (30 Oct 2026), 11/14 items.** Done: accessibility pass (Lighthouse 100 on every page) and responsive pass (no sideways scroll at 360–1440), plus a login redesign. Done and rehearsed locally: reports, audit log, dashboard v2, security review (`ims/docs/security-review.md`), production Docker/NGINX/HTTPS, backups + restore (A26 rehearsal), container replacement (A27), monitoring, k6 load test. Left: quick guides, and everything that needs the company: the VPS (hardening + real deploy + **witnessed restore**), off-server backup bucket, alert webhook/email, training and the pilot. How-to for the server: `ims/docs/runbook.md`.
>
> **Phase 5 built (29 Oct 2026), 9/10 items.** Left: print the four forms (Stock Issuance, Transmittal, Equipment Borrowing, Return Acknowledgment) on A4 at 100% and check signature space and readability; then send the real company templates/logo (Phase 0) and set `COMPANY_NAME`/`COMPANY_ADDRESS` in `ims/.env`. Next phase: 6 (hardening, deployment & pilot). Open phone tests: Phase 3 airplane mode, Phase 4 two-phone conflict.

**Current phase:** **Phase 6 – Hardening, deployment & pilot: IN PROGRESS** (started 29 Oct 2026; design under Phase 6). Phase 5 built (paper print check left). Phase 4 built (two-phone test left), Phase 3 built (real-phone test left); both phone tests can run in one session. Phases 1–2 done.
**Last updated:** 29 Oct 2026

**State:**
- Repo: https://github.com/Xpicode/IMS-PROJECT (public), branch `main`. Repo root is `Documents\Inventory`. Last pushed: `3afd7f9` (Phase 6 part 2), so `main` matched GitHub on 29 Oct 2026; the user pushes from their own cmd window.
- Run: `cd ims && docker compose -f compose.dev.yaml up --build --watch` (project `inventory-ims-dev`, app on :3000, Postgres on `127.0.0.1:5433`, test DB `ims_test`). Or `npm run db:up && npm run dev` on the host. Only one `next dev` per folder.
- **The service worker only runs in a production build** (dev shows "Development mode: the offline app is turned off"). To test offline: `npm run build` then `npx next start -p 3100` (port 3000 is the Docker dev app; cookies are shared across ports on localhost). `npm run build` copies the scanner WASM to `public/zxing/` (git-ignored).
- Demo users `admin@` / `supervisor@` / `field@ims.local`, password = `SEED_PASSWORD` in `ims/.env`. Seed adds a labeled sample catalog. Test data from browser checks: ISS-2026-000001, TRN-2026-000001, RCV-2026-000003, laptops IT-0001/IT-0002, PPE-0100, PPE-0101, TOOL-GRINDER, unit `carton`, `test.counter@ims.local`, `MAIN-WH-R1`. **Phase 3 test data:** 110 items `LOAD-0001..0110` ("Load test item", 5 each at SITE-B via RCV-2026-000004/5), drills TOOL-0004/0005 at SITE-B, counts CNT-2026-000001 ("Site B – October count") and CNT-2026-000002 ("Site B – full count (offline test)"), both open and assigned to the field user. The ledger is append-only, so these stay; they are labeled as test data.
- `npm run check` = typecheck + lint + Prettier + **265 tests**, all green (29 Oct 2026).
- **Production rehearsal stack** (local): `docker compose -p inventory-ims-prodtest -f compose.yaml -f compose.local-test.yaml --env-file .env.prodtest up -d` → https://localhost:8448 (mkcert certificate; `.env.prodtest` and the certs are git-ignored; admin `admin@rehearsal.local`, random password in the Hermes scratch folder). Holds load-test data (`LOAD-*`). Images: `ims-web`, `ims-migrate`, `ims-backup` (`:latest`).
- Phase 4 code map: server `lib/counts/sync.ts` (push), `lib/counts/review.ts` (review/approve/keep/recount/approve-matching/reopen), count freeze in `lib/inventory/stock.ts` (`checkCountFreeze`); API `app/api/v1/sync/push`, `app/api/v1/counts/[id]/{review,reopen,approve-matching,lines/[lineId]/{approve,keep,recount}}`; phone `lib/field/outbox.ts`, `lib/field/refresh.ts`, sync state in `components/field/field-context.tsx`, `components/field/send-result.tsx`; office `components/counts/{counts-list,count-review,new-count-wizard}.tsx`, pages `/counts`, `/counts/new`, `/counts/[id]`. Migration `0005_sync_and_reviews`.
- **Phase 4 test data:** CNT-2026-000002 is now **closed**: 110 counts received, 10 lines reviewed (adjustments ADJ-2026-000001..000006 on LOAD-0001..0004/0006/0007), LOAD-0010 recounted after ISS-2026-000002 (issued under a count exception), 1 conflict (TOOL-0004 sent after closing). CNT-2026-000003 "Workshop tools spot check" (created with the wizard, closed). CNT-2026-000001 is still open at SITE-B, so LOAD items and PPE-0001 at SITE-B are frozen until it's closed.
- Phase 3 code map: `lib/counts/service.ts`; API `app/api/v1/counts/**`, `app/api/v1/sync/bootstrap`; phone side `lib/field/` (`db` Dexie schema, `store`, `identity`, `device`, `net` time-limited fetch, `scan-formats`); `components/field/` (`field-app` = router + boot, `field-context`, `field-shell` header/nav/update banner, `scanner`, `install-help`, `views/*`); `app/(field)/field/page.tsx`; SW `sw/sw.ts` served by `app/serwist/[path]/route.ts`; `app/manifest.ts`, `app/icons/`, `public/offline.html`; office `components/counts/*` on `/counts`, `components/scan/scan-lookup.tsx` on `/scan`.

**Still waiting on the user (Phase 0):** real inventory export, whole vs decimal quantities (built as whole numbers), location hierarchy, approvers/signers, form samples, reference number format (built as `ISS-2026-000123`), label paper size (built for A4 70×37 mm, 24/sheet), **list of pilot phones (model + OS)** for the Phase 3 device test.

**Next step:**
1. Write the quick guides. The screenshots are already in `ims/docs/guides/img/`; the guide text isn't written yet.
2. With the user, one session on real phones over HTTPS: the Phase 3 device test (install, airplane mode, 100+ lines, force-close, reopen, camera scans) **and** the Phase 4 two-device test (two phones, two accounts, count the same line differently, send, check the review shows "Counts disagree"; then pull the network mid-send and confirm no duplicates). Write a device test report here, then tick the last items of Phases 3 and 4.
3. The user prints the four Phase 5 forms on A4 at 100% (signature space, readability).
4. Ask the user for the Phase 0 inputs and the two open Phase 4 decisions: the count-freeze policy, and "approving a not-found asset marks it Lost".
5. When the VPS, domain, backup bucket and alert destination exist: follow `ims/docs/runbook.md` (hardening, deploy, witnessed restore), then training and the pilot.

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
| 2026-10-28 | **Transmittal = the printed form of a confirmed stock transfer (TRN)**; there is no separate transmittal table. The Stock Issuance form is the printed form of an issue (ISS) | §7.8: the document must link to a real transfer/issue/custody event, and a form alone never changes balances. TRN/ISS numbers already come from the confirm transaction. **Needs confirmation of what "remittal" means at the company (§7.8).** |
| 2026-10-28 | PDF templates are generic (spec §13.2 fields, company name/address from settings, no logo), template version `IMS-GEN-1` | The company's real forms (Phase 0) haven't arrived. **Must be redone from the samples before go-live.** |
| 2026-10-28 | PDF font: Inter (Regular + Bold TTF, SIL OFL) embedded in every PDF, files in `ims/assets/fonts` | §13.6 local characters (ñ etc.). |
| 2026-10-28 | PDFs are drawn right after the confirm, in the same request but outside the database transaction; a failure leaves `PDF_FAILED` + Retry | §13.7. Simple, no job queue needed for the MVP. |
| 2026-10-28 | Returned in Good/Fair condition → Available; Damaged → the receiver chooses Under maintenance or Needs review | §7.6 step 5. |

---
| 29 Oct 2026 | PDFs embed the **whole** Inter font (~360 KB per PDF) | pdf-lib's font subsetting dropped most letters on the page (the text layer looked fine). A unit test checks every printed character has a glyph. |
| 29 Oct 2026 | Document file paths are runtime-only (`turbopackIgnore`) and stored with `/` | Otherwise the build traces the whole project, including the private PDF folder, into the server output; `/` keeps paths valid on Windows and Linux. |
| 29 Oct 2026 | A refused field borrow request must be fixed before resending | Sending it unchanged would be refused again; editing makes a new request (new Idempotency-Key). |
| 29 Oct 2026 | Audit log viewer is **admin only** | Audit events aren't tied to a location, so a supervisor view would show other sites' activity. Supervisors use the reports (all location-scoped). |
| 29 Oct 2026 | Dashboard low/out alerts only for items **with a low-stock level** (`minStock > 0`) | Otherwise every catalog item never stocked at a location shows as "out" (112 on the demo data). The Stock list filters are unchanged. |
| 29 Oct 2026 | **Sign-in lock:** 5 wrong passwords lock that email for 15 min (unknown emails too); NGINX adds 30 sign-ins/min per IP | §16 brute force. Per-email so one office sharing an IP isn't locked out by one person; per-IP limit set generously for shared site internet. |
| 29 Oct 2026 | Search text is always literal (`%`, `_` escaped) via `lib/db/search.ts` | Searching "_" listed every record. |
| 29 Oct 2026 | Count submissions take a **shared** lock on the count and an exclusive lock on their own line; closing/reviewing take the exclusive lock | All phones were queuing on one lock (22 s per batch at pilot load → 0.6 s). Still: nothing is saved after a close; a person's two counts of a line can't both stay current. |
| 29 Oct 2026 | Production: one `web` container, Next standalone, non-root, no npm in the runtime image; DB never published; migrations only via the one-off `migrate` service after a backup; first admin via `scripts/create-admin.ts` (no demo seed) | §15. Load test shows one web process is enough for the pilot (limit is one CPU core); add a second web container if needed. |
| 29 Oct 2026 | Backups: `pg_dump` custom format + PDF folder in one `age`-encrypted file, 14 daily / 8 weekly, rclone off-server; the private key never on the server | §15.7. Restore script refuses a non-empty DB and checks row counts + ledger. |
| 29 Oct 2026 | CSP allows inline scripts for now | Next.js bootstrap needs them unless every page gets a nonce; logged as a known limitation in the security review. |
| 29 Oct 2026 | Report CSVs: UTF-8 with BOM, every text cell quoted, formula-looking text prefixed with `'`, max 50,000 rows, downloads audited | §9.5 formula-injection rule; BOM so Excel shows "Peña". |

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

### Phase 5: Borrowing, handovers & PDFs (Weeks 10–11) — 🟡 BUILT 29 Oct 2026, waiting on the paper print check

**Goal (plan):** equipment custody is traceable, and every confirmed transaction can be printed as an official document.
**Done when (plan):** two supervisors racing to release the same drill → exactly one success; all four PDFs match the approved company templates on paper.

- [x] Migration: `borrowings`, `borrowing_lines`, transmittals, `document_sequences`, `pdf_documents`
- [x] Release (locks, AVAILABLE only, one transaction)
- [x] Per-line returns; header closes when all lines resolved
- [x] Transmittal confirm links to real event
- [x] Number allocation in confirm transaction; immutable snapshot
- [x] `pdf-lib` renderer for 4 templates
- [x] Private PDF storage, access-checked route
- [x] PDF failure → retry from snapshot
- [x] Borrow wizard, Loans list, Return flow, Field drafts, Document center, post-confirm success screen
- [ ] Tests A07–A10, A24, A25 + paper print check — automated tests ✅ all pass; **paper print check left (needs the user)**

#### Phase 5 design (written before coding, 28 Oct 2026)

**1. Database (migration `0006_borrowing_documents`)**
- `borrowings`: one loan. Status `DRAFT` (prepared, no number, nothing changes) → `OPEN` (released: number `BOR-YYYY-NNNNNN`, assets borrowed) → `CLOSED` (every line returned). Borrower name, department/site, purpose, due date, the person who physically receives, prepared by, released by, times, version.
- `borrowing_lines`: one asset per line: condition and accessories when released; status `PENDING` (draft) → `OUT` → `RETURNED`; return condition, missing accessories, notes, and which return it came back on. **Database rule: an asset can be on only one `OUT` line at a time** (partial unique index), so two releases can never both succeed (A08), even if the app check is skipped.
- `asset_returns`: one return event, `RET-YYYY-NNNNNN`: loan, receiving location, who brought it back, who received it, time, notes. One return can cover some or all lines (partial returns, A09).
- `pdf_documents`: one official document per confirmed transaction: type (Stock Issuance / Transmittal / Equipment Borrowing / Return Acknowledgment), the transaction's reference, template version, an **immutable snapshot** of every printed value (database trigger refuses changes to it), status `PENDING` → `READY` / `FAILED` (or `VOID` later), file path, SHA-256 checksum, size, attempts, last error.
- Numbers come from the existing `document_sequences` in the **same transaction** as the confirm (new prefixes BOR and RET).

**2. Release (§7.5, §9.3)**
- One transaction: lock the assets in a fixed order → each must be `AVAILABLE` and not on an open loan line → loan `OPEN` with a new number → assets `BORROWED` with the borrower as custodian → asset history events → audit → document snapshot. Requires `custody.confirm` at the location; Idempotency-Key, so a double tap releases once.

**3. Return (§7.6)**
- Tick which lines come back, set the condition for each: Good/Fair → `AVAILABLE` at the receiving location; Damaged → `UNDER_MAINTENANCE` or `NEEDS_REVIEW` (the receiver picks), never straight to available (A10). The loan closes only when every line is returned. Each return gets its own `RET-` number and Return Acknowledgment PDF.

**4. Documents and PDFs (§13)**
- Four templates in code (`pdf-lib` + embedded Inter font, so names like "Peña" print correctly): A4, company header, form title + template version, reference + date, info block, item table that flows onto more pages with the table heading repeated, "continued on next page", "Page X of Y", and signature blocks (prepared / released / received / approved as each form needs). Previews say **DRAFT** across the page and have no number.
- Issue (ISS) → Stock Issuance form; Transfer (TRN) → Transmittal form; Release (BOR) → Equipment Borrowing form; Return (RET) → Return Acknowledgment.
- The PDF is drawn **after** the transaction commits, only from the saved snapshot. If drawing fails, the transaction and number stay, the document is `PDF_FAILED`, and **Retry PDF** redraws from the same snapshot with no second stock movement (A25).
- Files go to a private folder (`DOCUMENTS_DIR`, default `ims/storage/documents`, git-ignored; a Docker volume in dev) and are served only through `/api/v1/documents/[id]/pdf` after a permission check. Never `public/`.
- Company name/address come from settings (`COMPANY_NAME`, `COMPANY_ADDRESS`) until the real header and logo arrive.

**5. Screens**
- **Borrow wizard** (`/borrowing/new`): Where → What (scan or type asset tags, each with its status chip; unavailable ones blocked with the reason) → Who (borrower, department, purpose, due date, received by) → Review (condition + accessories per asset, DRAFT preview) → **Confirm release** → success screen with the number and **Download PDF / Print / Done**.
- **Loans** (`/borrowing`): tabs Requests (drafts) / Active / Overdue / Closed; overdue highlighted.
- **Loan page** (`/borrowing/[id]`): lines with status, "2 of 3 returned", history, documents; **Return** flow: tick lines, condition per line, missing accessories, confirm.
- **Document center** (`/documents`): search by number, type filter, status chip, Preview, Download, Print, Retry PDF.
- Stock Issue/Transfer success screens get **Download PDF / Print**.
- **Field app:** "Borrow request" on the phone: scan or type tags + borrower details, saved as **"Draft on this device – not official"**; when online, "Send to supervisor" turns it into a `DRAFT` loan that the supervisor opens in the borrow wizard to release.

**6. Tests to write first**
A07 (borrow → borrowed + borrower + PDF), A08 (two releases race → one success), A09 (return 2 of 3 → loan stays open), A10 (damaged return → maintenance/review, not available), A24 (all four PDFs + a 30-row multi-page one: page count, repeated heading, page X of Y, text present), A25 (PDF fails after confirm → transaction stays, retry, no second movement), document access (other site / field user → refused), snapshot can't be changed.

**Not possible here:** printing on paper at 100% (the user must print and check the signature spaces); the company's real templates/logo (Phase 0).

### Phase 6: Hardening, deployment & pilot (Weeks 12–14) — 🔵 IN PROGRESS (started 29 Oct 2026)

**Goal (plan):** a pilot that is safe, recoverable, and that people can use after short training.
**Done when (plan):** the §21 "Ready for internal pilot" checklist is complete and A01–A30 pass or have approved exceptions.

- [x] 5 fixed reports + CSV (formula-injection escaping)
- [x] Audit log viewer
- [x] Dashboard v2 "Needs your action"
- [x] Accessibility pass, Lighthouse ≥ 90 — **100** accessibility + 100 best practices on all 37 pages, phone + desktop (30 Oct 2026)
- [x] Responsive pass 360 / 390 / 768 / 1024 / 1440 — no page scrolls sideways; wide lists become cards below 1280 (30 Oct 2026)
- [x] Security review (§16 + OWASP ASVS) — `ims/docs/security-review.md`; 8 problems found and fixed; `npm audit --omit=dev` 0, image scan 0 critical/high
- [x] k6 load test — `ims/load/pilot.js`; pilot targets met, ledger balanced afterwards (numbers in the log)
- [x] Dockerfile, production compose, NGINX + Certbot, `limit_req` — rehearsed locally over HTTPS (Certbot itself needs the real domain)
- [ ] VPS hardening (§15.6) — checklist in `docs/runbook.md` §1; **needs the VPS**
- [x] Migrations as separate step after backup — `migrate` service + runbook §6
- [ ] Nightly encrypted `pg_dump` + PDF volume off-VPS — built and run (age-encrypted, 14 daily/8 weekly, rclone); **off-VPS copy needs the company's bucket**
- [ ] Witnessed restore (A26); container replacement (A27) — both rehearsed locally and passed; **witnessed restore must be repeated on the real server**
- [x] Monitoring — `infrastructure/monitor/monitor.sh` + systemd timer, tested with a stopped container (alert destination needs the company)
- [ ] Quick guides, training, pilot, §19 turnover items

#### Phase 6 design (written before coding, 29 Oct 2026)

**Build order:** reports → audit viewer → dashboard v2 → security review → production Docker/NGINX → backups + restore rehearsal → monitoring → load test → accessibility/responsive pass → guides and runbook.

**1. Reports (`/reports`, §9.5)** — five fixed reports, each a filtered table + **Download CSV**, limited to the user's locations:
- *Stock balances*: item, SKU, location, on hand, low level, status. Filters: location, item search, low/out only.
- *Movement ledger*: date, reference, type, item, location, quantity (+/−), balance after, user, recipient/reason. Filters: date range, location, item, user, type, reference.
- *Asset status & custody*: tag, item, serial, status, condition, location, custodian, loan number, due date. Filters: status, location, search.
- *Overdue loans*: loan number, borrower, assets, due date, days overdue, location.
- *Count discrepancies*: count number, item/asset, location, expected, counted, difference, decision, adjustment number, reviewer. Filters: count, date range, location.
- CSV: UTF-8 with BOM (Excel shows "Peña" correctly), CRLF, every cell quoted; **cells starting with `= + - @`, tab or CR get a leading `'`** so Excel never runs them as formulas (unit-tested). Max 50,000 rows per file; a filter narrows larger ones. Downloads are audited.

**2. Audit log viewer (`/settings/audit`)** — admins only (audit events aren't tied to a location, so a supervisor filter would leak other sites). Filter by user, event type, record, date range; shows the before/after details.

**3. Dashboard v2 "Needs your action"** — real items with one button each: counts waiting for review, borrow requests to release, overdue loans, failed PDFs, assets needing review, count lines waiting for a recount. Plus "Recent activity" (last 10 confirmed transactions/loans in my locations).

**4. Security review (§16 + OWASP ASVS)** — tests for: cross-location reads/writes, replayed/duplicate requests, CSRF (Origin check), session expiry and deactivated users, PDF URL guessing, path traversal in document paths/filenames, injection in search and CSV import, security headers. `npm audit` and a container image scan. Findings and fixes written up in `docs/security-review.md`.

**5. Production deployment files (§15)** — `Dockerfile` (multi-stage, Next standalone output, non-root user), `compose.yaml` (nginx, web, db, certbot, backup; DB not published; log size limits; health checks), a one-off `migrate` service run **after a backup**, NGINX with HTTPS, HSTS, security headers, no caching of `/api`, and `limit_req` on login and transaction routes. Certbot webroot issue + auto-renew with NGINX reload. VPS hardening checklist in the runbook.

**6. Backups (§15.7)** — nightly `pg_dump` (custom format) + the PDF volume, encrypted (`age`), kept 14 daily / 8 weekly, copied off the VPS with `rclone` (remote chosen by the company). Restore script. **Rehearsed here** on Docker: production-like stack → data → backup → restore into a brand-new empty stack → compare counts and ledger (A26), and replace the web/db containers keeping data (A27). The **witnessed** restore on a clean server must be repeated on the real VPS.

**7. Monitoring** — a small script on a timer: disk, memory, DB health, HTTP 5xx rate from NGINX logs, TLS days left, backup age, failed/conflicting sync operations → alert (email/webhook).

**8. Load test** — k6 (Docker image `grafana/k6`) against the production-like stack: concurrent issues on the same items + sync bursts at pilot size; stock must stay balanced.

**9. Quality passes** — keyboard-only run of office flows, labels, contrast, 200% zoom, Lighthouse ≥ 90 (accessibility, PWA); every screen at 360 / 390 / 768 / 1024 / 1440 with no sideways scroll.

**10. Guides and turnover (§19)** — `docs/`: four 1-page quick guides with screenshots, deployment/rollback/recovery runbook, TLS renewal, credential rotation and server-access transfer, API reference, permission matrix (generated from the code), offline/sync notes, known issues.

**Needs the user / company (can't be done from here):** the VPS (plan, OS, domain, SSH), off-VPS backup destination, alert email, real phones, the witnessed restore on the real server, training sessions, the pilot site and its 1–2 weeks, and the Phase 0 items (real forms, inventory list, locations).

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
- **2026-10-28** – **Phase 5 started (session 7).** Read build plan Phase 5 and spec §7.5, §7.6, §7.8, §13 and A07–A10, A24, A25. Wrote the Phase 5 design into this note and logged 5 decisions; 2 need the user (meaning of "remittal"; real form templates). Installed `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1; copied Inter Regular/Bold TTF + OFL license into `ims/assets/fonts`. Note: Phase 4 commit `3308ad6` is not pushed yet.
- **2026-10-28** – Phase 5 progress (session 7, part 1). Migration `0006_borrowing_documents` applied (borrowings, borrowing_lines, asset_returns, pdf_documents; DB rules: one open loan line per asset, numbers only on released loans, complete return lines, returns append-only, document snapshot frozen + no delete, READY needs file + checksum). **PDF renderer** `lib/documents/pdf.ts` (6 unit tests, read back with pdfjs: all values, "José Peña", A4, 30 rows over 2 pages with repeated heading and "Page X of Y", signatures kept together at the end, nothing in the footer zone, DRAFT preview without number; 5 layout guards mutation-proven, 2 of them only after adding the "nothing in the footer zone" test). **Documents service** (snapshot builders for the four forms, private storage with SHA-256, retry, access-checked download) and **borrowing service** (draft, release, partial return, cancel, lists) + Stock Issuance / Transmittal forms created inside issue/transfer. `tests/integration/borrowing.test.ts` 17 tests: A07, A08 (race: one success), same-key replay, unavailable/other-location blocked with the reason, permissions, field draft → supervisor release, A09, A10, return to another location, tabs incl. overdue, A24 (four forms + 30-asset multi-page), A25 (renderer failure → issue stays, PDF_FAILED, retry → READY, still one issue), frozen snapshot + damaged file detected, download access. 12 guards mutation-proven (2 needed new/tighter tests). Full suite 234 tests green. Next: API routes, screens, field drafts, browser checks.
- **2026-10-28** – Phase 5 progress (session 7, part 2), **paused by user ("continue tom")**. Built: API routes (`/api/v1/borrowings` list + field draft with Idempotency-Key, `release`, `preview` (DRAFT PDF), `[id]`, `[id]/return`, `[id]/cancel`; `/api/v1/documents` list, `[id]`, `[id]/pdf`, `[id]/retry`) + HTTP test; screens: Borrow wizard `/borrowing/new` (also `?draft=` and `?asset=`), Loans list `/borrowing` (Requests / Out now / Overdue / Closed + search), Loan page `/borrowing/[id]` with Return flow (`?return=1`), Document center `/documents`, Download/Print/View on the Issue/Transfer success screens, Borrow/Return buttons on the asset page; field app "Borrow request" (`/field?v=borrow`, Dexie v3 `borrowDrafts`, QR or typed tags, draft id = Idempotency-Key; 6 unit tests, 6 guards mutation-proven). Dev compose: `documents_dev` volume at `/app/storage`, `DOCUMENTS_DIR`, `COMPANY_NAME`/`COMPANY_ADDRESS`; web image rebuilt (pdf-lib inside), watcher still syncing. tsc + eslint clean, **241 tests green**. 8/10 Phase 5 items ticked. **Not committed yet.**
- **2026-10-29** – Phase 5 browser checks (session 8). Restarted the Docker stack (stopped overnight) and re-made the curl logins. Found that a second IMS `next dev` (on Windows) was answering `[::1]:3000` next to Docker's `127.0.0.1:3000`; the user closed it. **Bugs found and fixed:** (1) **PDF letters missing on the page**: pdf-lib's font subsetting dropped most of Inter's glyphs; the text layer was complete, so all text tests passed. Fonts are now embedded whole (`subset: false`, ~360 KB per PDF), and a new unit test checks that every printed character has a real glyph (fails with subsetting, passes now). BOR-2026-000001's PDF was redrawn from its frozen snapshot with **Redraw PDF** (loan untouched). (2) Field borrow-request tag row overflowed at 360px (full-width `lg` buttons in one row) → input + small Add button, Scan on its own row. (3) A refused field request offered "Send" again (would be refused again) → only "Fix and send again". (4) Loans table cramped at 768px → number/location don't wrap, due shows the date only. **Verified in the browser:** supervisor borrow wizard (typed tags, unavailable assets blocked with reason, validation) → **BOR-2026-000001** (TOOL-0001, TOOL-0002, IT-0002 to José Peña) → PDF correct; partial return **RET-2026-000001** (TOOL-0001 Good → Available; IT-0002 Damaged → Under maintenance, missing charger) → loan stays open, 2 of 3 (DB checked), Return Acknowledgment PDF correct; field request at 360px (unknown tags refused with the reason, fixed, sent) → admin released it from Requests with only TOOL-0004 → **BOR-2026-000002**, past due → Overdue tab; Issue wizard success screen → **ISS-2026-000003** Stock Issuance PDF; transfer **TRN-2026-000002** Transmittal PDF; Document center search/filters/Redraw; Borrow button on the asset page; field user refused (404) for others' documents/loans, 403 on release, no access to /borrowing. Layout/dev-error sweep: 72 checks (admin + supervisor × 360/768/1280 × new pages), no problems.
- **2026-10-29** – Production build check: found the build tracing the whole project (including `storage/documents`) into the server output because of the PDF folder file calls → marked them runtime-only; trace now 185 files, no `storage/documents`, no `.env`; build has no warnings. Stored PDF paths now always use `/`. `npm run check` 242 tests green. Phase 5 marked **BUILT** (9/10; paper print check left for the user). Committed.
- **2026-10-29** – Phase 6 progress (session 8, part 2). Design written under Phase 6. **Reports** `/reports`: stock balances, movement ledger, asset status & custody, overdue loans, count discrepancies; filters per report (GET form, bookmarkable), **Download CSV** with the same filters (`/api/v1/reports/[name]/csv`, audited `report.exported`). CSV writer: 10 unit tests, 3 guards mutation-proven; reports: 7 integration tests, 7 guards mutation-proven (1 needed a new not-yet-due loan). **Audit log** `/settings/audit` (admins; filter by user, event family, record, dates; records link to their page): 1 test, 4 guards proven. **Dashboard v2**: "Needs your action" (count lines waiting for review, borrow requests, overdue loans, failed PDFs, assets to review — each with a button) moved to the top, "Recent activity" (stock, loans, returns), low/out alerts only for items with a low-stock level: 2 tests, 4 guards proven (2 needed stronger tests). Browser-checked as admin and supervisor.
- **2026-10-29** – Phase 6 progress (session 8, part 3). **Security review** (`ims/docs/security-review.md`). New `tests/integration/security.test.ts` (7 tests) + 4 new sync tests; every new guard mutation-proven.
  - **Fixed:** no limit on password guessing → per-email lock + NGINX limit (5 guards proven; one needed a same-length-email test); search `%`/`_` acted as wildcards → `lib/db/search.ts` in all 18 searches; cross-site request without Origin passed → `Sec-Fetch-Site` check; no CSP → added (+ COOP); stored PDF path now must stay inside the documents folder.
  - **Dependencies:** `npm audit --omit=dev` 0 (zod override for Serwist, `shadcn` moved to dev). The image scan found 6 high issues in the npm CLI inside the Node image → npm/npx/yarn removed from the runtime image → 0 critical/high.
  - **Production files:** `Dockerfile` (standalone, non-root), `compose.yaml` (nginx/web/db/certbot/backup + one-off migrate), NGINX template (HTTPS, HSTS, `limit_req`, no API caching), `scripts/create-admin.ts`, backup/restore scripts, monitor script + systemd timer, `.env.production.example`, `docs/runbook.md`. The Prisma client is now created on first use (the image build failed because `next build` imported it without a database).
  - **Rehearsed locally** over HTTPS on :8448:
    - redirect, headers, `__Host-` Secure cookie, 403 for a foreign Origin, 429 after fast sign-ins;
    - PDF drawn in the production image (368 KB, non-root);
    - backup → **restore into a brand-new DB: all row counts OK, ledger OK, admin signs in, PDF byte-identical; a second restore over data refused (A26 rehearsal)**;
    - `--force-recreate web db` kept all 1,818 moves / 18,000 count entries / 1,337 PDFs / 121 users and the session (A27);
    - monitor caught a stopped web container (one alert, no repeat).
  - **Bugs found by running things:**
    - NGINX dropped the port from Host, so every save was refused (fixed with `$http_host`).
    - The backup script stopped on weekdays (`set -e` + `[ ] && cp`) and when the weekly folder was empty.
    - The restore check could never fail.
    - The monitor missed stopped containers (`ps` without `-a`).
    - Two people pressing Close on a count at once both succeeded, and the close time was taken before waiting for in-flight counts (both test-first fixes).
  - **k6 load test** (`load/pilot.js`, 10 office users issuing mostly the same 5 items + 30 phones each sending 50 count lines in the same second, 3×): first run showed sync batches taking 22 s (all phones queued on one lock) → shared lock fix → **0 failed requests; issue median 0.21 s / p95 0.75 s; pages p95 0.27 s; sync median 0.58 s / p95 6.3 s; 314 issues + 4,500 count lines; ledger = balances, no negatives, all PDFs ready**. Stress (no pauses): every 50-line batch 5.0–5.9 s; limit is one CPU core for the web process.
  - `npm run check` green, **265 tests**.
- **2026-10-29** – Tracker housekeeping (Claude Code): fixed the stale "Last pushed" line and the Next step list, and added Obsidian frontmatter. Copied this tracker over the stale vault note (`memory1/memory 1/Projects/Code/`), which still said "Planning only".
- **2026-10-29** – Phase 6 accessibility/responsive pass + login redesign (Claude Code), **paused mid-check, nothing committed**. Audit (puppeteer + Lighthouse 12 from a scratch folder, not project deps) over 37 pages: Lighthouse accessibility **100** and best practices 100 on every page, phone + desktop; no page scrolls sideways at 360/390/768/1024/1440. Fixed: breadcrumb links too small (`inline-block py-1`), reports table → cards below 1280 (`tableFrom="xl"`), `FocusHeading` (now with `as`) on the "Added N assets" and "Imported N items" result screens. **Login redesign:** `app/(auth)/layout.tsx` + `label-scene.tsx` + `auth.css`: an A4 label sheet with one real bwip-js label (TOOL-0002) that lifts, gets a red scanner-laser sweep, then a "✓ Found" chip; form fields rise in turn; reduced motion shows the final state; Show/Hide password on login; IBM Plex Mono for label codes only. tsc + lint + Prettier clean. **Left:** dev server stopped before the last re-check: restart it, re-run the responsive check on the changed pages and Lighthouse on /login and /forgot-password, run `npm run check`, then commit and tick the two Phase 6 items.
- **2026-10-30** – Finished the 29 Oct pass (Claude Code). Dev stack restarted; re-checked the changed pages (no sideways scroll, no targets under 24 px) and Lighthouse on /login and /forgot-password (100/100, phone + desktop); reduced-motion login shows the final state. `npm run check` green, **265 tests**. Ticked the accessibility and responsive items. Audit scripts are throwaway (scratch folder), not project dependencies.
- **2026-10-30** – Dashboard redesign (Claude Code). "Needs your action" now leads, as tickets (red edge = problem, blue = routine work, icon per kind, one button). Six number boxes replaced by two health meters (Stock: OK/Low/Out; Assets: Available/Borrowed/Maintenance/To review), each segment labeled and linked. Low-stock rows show a bar of on hand vs low level. Recent activity is a timeline with a type icon (from the reference prefix) and references in IBM Plex Mono (now shared in `lib/fonts.ts`). Phone: Receive/Issue/Transfer in one row. Little motion (`app/(app)/dashboard.css`): sections rise in turn, meters fill, tickets slide in, slight hover lift; none with reduced motion. **Gotcha:** an animation (scaleX or clip-path) on a bar inside a rounded `overflow-hidden` track left it unpainted on a fresh load in Chrome, so the low-stock bars don't animate. `dashboardData` also returns `assetsByStatus`; new `formatLongDate`. Checked: no sideways scroll at 5 widths, Lighthouse 100/100 (admin + supervisor, phone + desktop), `npm run check` green, 265 tests.
- **2026-10-30** – Theme + dark mode (Claude Code). **Theme:** tweakcn "Professional Theme" (slate + blue 600, white page, 6 px corners, -0.015em tracking) applied by hand in `app/globals.css`, not with `npx shadcn add`: its input border (1.2:1), error red (3.8:1) and muted text on grey (4.3:1) fail WCAG AA, its font names would bypass the self-hosted Inter, and its shadow values are invalid CSS. Nearest passing slate/red used where needed (commented). Brand color updated in icons, manifest, offline page. **Dark mode:** `.dark` token set (theme dark palette; error red, focus ring, input border and primary lightened to pass AA; our own dark status tones). `lib/theme.ts` + inline `THEME_BOOT` script in `<head>` (no white flash; CSP already allows inline scripts); choice in localStorage `ims-theme`, default = same as device. Sun/moon toggle in the office top bar; "Appearance" (Same as device / Light / Dark) on office Me (replaced the out-of-date "This device" card) and field Me. White text on solid colors switched to `text-background` (destructive button, field sync badge, login "Found" chip). Login scene has a dark backing; the label stays white. **Checked:** axe WCAG 2.2 AA on all 37 pages × phone + desktop in light (74/74 clean) and dark (74/74 clean after fixes), plus an open confirm sheet in dark; Lighthouse 100 in light on all pages; toggle → saved → dark before first paint after reload → "Same as device" follows the device live. `npm run check` green, 265 tests. **Gotcha:** the Docker dev server once kept serving a stale `globals.css` after an edit; `docker compose -f compose.dev.yaml restart web` fixed it.
- **2026-10-30** – Staff guide `ims/docs/guides/HOW-TO-USE.md` (Claude Code): one plain file instead of four (user asked for "simple, direct to the point"): sign in, roles, office tasks (receive/issue/transfer, items, assets + labels, borrow/return/requests, counts + review, documents, reports), field (install, download, count, send, borrow request), colors, dark mode, problems, don'ts, admin. Button names checked against the code. Linked from `ims/README.md`. Still to do: screenshots (the ones in `docs/guides/img/` show the old look) and training.
- **2026-10-30** – Guide with pictures (Claude Code): 21 fresh screenshots (light theme, sample data; office at 1280 px, field on a 390 px phone; one dark-mode dashboard) in `ims/docs/guides/img/`, placed next to each step in `HOW-TO-USE.md`, plus `HOW-TO-USE.pdf` (A4, 16 pages) to send or print. Taken with a script that never presses Confirm/Send; checked afterwards: no new counts, stock movements or loan changes. Fixed the return step order (tick items first, then **Return equipment**). Old `sup-*.jpg` screenshots from an earlier session (previous design) are still in the folder, not committed and not used.
