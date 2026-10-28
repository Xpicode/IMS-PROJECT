# Inventory Management System (IMS)

Project tracker. **Read this before starting any IMS work.** After any work: tick the finished phase items below and add a dated line to the [Log](#log).

- **Spec (the rules):** `../../IMS_MVP.md` (v1.0, 19 Oct 2026). "§" references point here.
- **Build plan (the order):** `../../IMS_BUILD_PLAN.md` (28 Oct 2026)
- **Code:** `../../ims/` (Next.js app, single repo per spec §14)
- **Scope rule:** work stays inside `Documents\Inventory`.

---

## Handoff

**Current phase:** Phase 2 – Stock & assets (not started). Phase 1 done 28 Oct 2026.
**Last updated:** 28 Oct 2026

**State:**
- Repo: https://github.com/Xpicode/IMS-PROJECT (public), branch `main`. Repo root is `Documents\Inventory`.
- Run: `cd ims && docker compose -f compose.dev.yaml up --build --watch` (project `inventory-ims-dev`, app on :3000, Postgres on `127.0.0.1:5433`, test DB `ims_test`). Or `npm run db:up && npm run dev` on the host. Only one `next dev` per folder.
- Demo users `admin@` / `supervisor@` / `field@ims.local`, password = `SEED_PASSWORD` in `ims/.env`. A test user `test.counter@ims.local` (inactive) and location `MAIN-WH-R1` were added during testing.
- `npm run check` = typecheck + lint + Prettier + 92 tests (62 unit, 30 integration), all green.

**Next step (Phase 2):**
1. **Ask the user for Phase 0 inputs that Phase 2 needs:** a sanitized inventory export (SKUs, categories, units), whole vs decimal quantities, location hierarchy. Build with labeled sample data until they arrive.
2. Migration `0002`: `items`, `item_identifiers`, `assets`, `asset_events`, `stock_balances`, `stock_transactions`, `stock_movements` (§9.1–9.3). Integer quantities, no negative balances (CHECK).
3. Services test-first: `receiveStock` / `issueStock` / `transferStock` (row locks, stable lock order, one DB transaction, `withIdempotency`), `changeAssetStatus()` with the §9.4 transition map. Concurrency test A04 on real Postgres.
4. Screens: Item list/detail, the Receive/Issue/Transfer wizards (shared `Wizard`), Asset list/detail timeline, Add assets ×N, label print page, CSV import with row errors, Dashboard v1.
5. Replace the top-bar search (locations only, `shortcut:` comment in `app/(app)/layout.tsx`) with `ScanInput`.

**Testing tricks (needed every session):**
- Never type passwords through the browser tool. `bash AppData/Local/hermes/cache/scratch/ims-login.sh <role> > tok-<role>` logs in through the real Auth.js endpoint, then `ims_as(role)` in the browser workspace helpers sets the cookie.
- The browser tab must be in front (`ims_front()` = `Page.bringToFront` + focus emulation). A hidden tab never paints, so React never swaps streamed content in (pages stuck on "Loading…"), dialogs don't open, and screenshots hang.
- Native `curl` on Windows can't write to `/dev/null` (exit 23). Use `-o NUL`.

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

### Phase 2: Stock & assets (Weeks 4–5)

- [ ] Migration: `items`, `item_identifiers`, `assets`, `asset_events`, `stock_balances`, `stock_transactions`, `stock_movements`
- [ ] Services `receiveStock`, `issueStock`, `transferStock` (one DB transaction, row locks §9.3, no negatives, integer qty)
- [ ] Asset status transition map + `changeAssetStatus()` writing `asset_event`
- [ ] Idempotency key required on receive/issue/transfer
- [ ] CSV import: upload → preview with row errors → commit
- [ ] Label payloads `ims:item|asset|location:<uuid>`
- [ ] Item list → Item detail (balances per location, movements)
- [ ] Receive / Issue / Transfer wizards (review shows before → after)
- [ ] Asset list → Asset detail with history timeline
- [ ] "Add assets" with quantity
- [ ] Label print page (A4, QR / Code 128)
- [ ] CSV import screen
- [ ] Dashboard v1: KPI cards + low-stock list
- [ ] Tests A01–A06 incl. concurrency test on real Postgres

### Phase 3: Field PWA (Weeks 6–7)

- [ ] Migration: `count_sessions`, `count_session_items`, `count_entries`
- [ ] Minimal count-session creation
- [ ] `GET /api/v1/sync/bootstrap?sessionId=`
- [ ] Manifest, icons, `offline.html`; Serwist SW (no private API caching)
- [ ] Field routes client-rendered from Dexie
- [ ] Dexie DB per user (`ims-field-<userId>`)
- [ ] `navigator.storage.persist()` + quota check on Me screen
- [ ] Update banner (never reload during a count)
- [ ] Field Home, Download for offline use, Scan screen, Count screen, Asset check, My results, Install help, Storage-full error
- [ ] Tests A11–A14, A29, A30 + device test report

### Phase 4: Sync & counts (Weeks 8–9)

- [ ] Migration: `sync_operations`, `count_reviews`
- [ ] `POST /api/v1/sync/push` (≤50 ops, §11.4 order, idempotent by user+operation_id+hash)
- [ ] Results `ACKED` / `CONFLICT` / `REJECTED` / `RETRYABLE_ERROR`
- [ ] Re-download assignments after push
- [ ] Reconciliation service (one adjustment per line)
- [ ] Count freeze + supervisor exception
- [ ] Client outbox lifecycle, auto-retry, Sync now, no cross-account sends
- [ ] Sync screen, live `SyncPill`, Count sessions office UI, Reconciliation review
- [ ] Tests A15–A21, A28, §11.5 scenarios, two-device test

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
