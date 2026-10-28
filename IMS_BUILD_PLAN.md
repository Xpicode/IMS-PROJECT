# IMS Build Plan: Phase by Phase

**Source spec:** `KIan/IMS PROJECT/IMS_MVP.md` (v1.0, 19 Oct 2026)
**Plan date:** 28 Oct 2026
**Team assumption:** 1 full-stack developer who also handles UI/UX, about 14 weeks
**Goal:** a simple inventory app that works on any phone, tablet, or computer and is easy for office staff and field staff to learn in minutes.

This plan covers **how and in what order** to build the system. The **rules** (stock, custody, sync, PDFs, security) stay in the spec. When this plan says "see §9.3", it means section 9.3 of `IMS_MVP.md`.

---

## 1. Product principles (what "simple" means here)

Every screen and feature is checked against these seven rules. If a design breaks one, change the design.

| # | Principle | In practice |
|---|---|---|
| 1 | **Scan first** | Every search box also takes a scan. In the field, the Scan button is the biggest thing on screen. |
| 2 | **One job per screen** | Each screen has one main action, one primary button, and nothing extra. |
| 3 | **Same pattern everywhere** | Receive, Issue, Transfer, Borrow, and Return all follow the same 4 steps: **Where → What → Who → Review & Confirm**. Learn one and you know them all. |
| 4 | **Always show what's official** | A visible chip on every record: `Draft on this device`, `Pending sync`, `Received by server`, `Confirmed`. The app never says "Synced" until the server confirms it. |
| 5 | **Plain words** | Labels like "Give out stock (Issue)" or "Count this item". No error codes on screen. Every error tells the user what to do next. |
| 6 | **No dead ends** | Empty screens explain what goes there and offer the next action, for example "No counts yet. Scan an item to start." |
| 7 | **Status = color + icon + word** | Never color alone, so it works for color-blind users and on low-quality screens in sunlight. |

---

## 2. Device support and responsive layout

### 2.1 Target devices

| Device | Min width | Browser | Main users |
|---|---|---|---|
| Phone | 360 px | Chrome (Android), Safari / Home Screen (iPhone) | Field staff, supervisors on the move |
| Tablet | 768 px | Chrome, Safari | Supervisors, warehouse desks |
| Laptop / desktop | 1024 px+ | Chrome, Edge, Firefox, Safari | Admin, supervisors |

The app is one URL and one codebase. Phones can install it as a PWA. There is no separate app store build (see §2, no Capacitor).

### 2.2 Layout per screen size

```text
PHONE (<768px)              TABLET (768–1023px)         DESKTOP (≥1024px)
┌──────────────────┐       ┌──┬─────────────────┐      ┌────────┬──────────────────────┐
│ Top bar + sync ● │       │  │ Top bar + sync ●│      │        │ Top bar + sync ●     │
├──────────────────┤       │R │                 │      │ Side-  ├──────────────────────┤
│                  │       │a │    Content      │      │ bar    │                      │
│    Content       │       │i │  (2 columns     │      │ with   │  Content (tables,    │
│  (cards, 1 col)  │       │l │   where useful) │      │ labels │  filters, details    │
│                  │       │  │                 │      │        │  side by side)       │
├──────────────────┤       │  │                 │      │        │                      │
│ Bottom nav (4–5) │       └──┴─────────────────┘      └────────┴──────────────────────┘
└──────────────────┘        Icon rail, labels on hover
```

- **Tables become cards on phones.** Every list component has a card view under 768 px. Do not make users scroll a table sideways.
- **Forms are one column on phones** and up to two columns on desktop. The primary button sits at the bottom, inside the thumb zone, and stays visible (sticky).
- **Dialogs become bottom sheets on phones** (shadcn `Drawer` on mobile, `Dialog` on desktop).
- No horizontal page scroll at 360 px, ever. This is a release check.

---

## 3. Design system

Build this once in Phase 1 and use it everywhere. All values are Tailwind theme tokens, never hard-coded colors.

### 3.1 Color tokens

High contrast, so it can be read outdoors. Light theme is the default.

| Token | Use | Light value (suggested) |
|---|---|---|
| `--bg` | Page background | `#F7F8FA` |
| `--surface` | Cards, sheets | `#FFFFFF` |
| `--text` | Main text | `#111827` (contrast > 15:1) |
| `--text-muted` | Hints, meta | `#4B5563` (≥ 7:1) |
| `--border` | Dividers, inputs | `#D1D5DB` |
| `--primary` | Main buttons, links, focus | `#1D4ED8` (blue 700) |
| `--success` | Available, Confirmed, Synced | `#15803D` |
| `--warning` | Borrowed, Pending, Low stock | `#B45309` |
| `--danger` | Conflict, Error, Out of stock, Lost | `#B91C1C` |
| `--neutral` | Retired, Inactive, Draft | `#6B7280` |

- Every text/background pair must pass **WCAG AA (4.5:1)**. Status chips use a tinted background with dark text in the same hue.
- Dark mode: tokens are written so that dark mode only needs a second set of values. **It is not built for the MVP.** Add it after the pilot if users ask.

### 3.2 Status chips (one component, used everywhere)

| Record | Status → chip |
|---|---|
| Asset | `AVAILABLE` ✓ green · `BORROWED` ↗ amber · `UNDER_MAINTENANCE` 🔧 amber · `NEEDS_REVIEW` ! red · `LOST` ✕ red · `RETIRED` – gray |
| Sync | `Draft on this device` gray · `Pending sync` amber · `Sending…` blue · `Received by server` green · `Conflict` red · `Failed – retry` red |
| Document | `DRAFT` gray (watermark) · `CONFIRMED` green · `PDF ready` green · `PDF failed – retry` red · `VOID` gray strike |
| Stock | `OK` green · `Low` amber (≤ min) · `Out` red (0) |

Use Lucide icons (bundled with shadcn), not emoji. The emoji above only show the idea.

### 3.3 Typography

- **Font:** Inter via `next/font`. It is self-hosted, so it keeps working offline after the first load. Use `font-variant-numeric: tabular-nums` for all quantities so digits line up.
- **Scale:** 14 (meta) · **16 (body, minimum for inputs, which also stops iOS zoom)** · 18 (field body) · 20 / 24 / 30 (headings) · **36 (quantity input on the count screen)**.
- Line height 1.5 for body text. No text below 14 px.

### 3.4 Spacing, sizing, touch

- 4 px spacing grid (Tailwind default). Card padding 16 px on phone and 24 px on desktop.
- **Touch targets ≥ 48×48 px**, with at least 8 px between targets. Field-screen primary buttons are 56 px tall and full width.
- Radius 8 px (inputs, buttons) and 12 px (cards). Light shadows only on floating elements.
- Focus ring: 3 px `--primary` outline, always visible on keyboard focus.

### 3.5 Core components (shadcn/ui + a few of our own)

| Component | Notes |
|---|---|
| `Button` | Primary, secondary, danger, ghost. Shows a loading state and is disabled while a request is in flight, which also prevents double taps. |
| `Input`, `NumberInput` | `NumberInput` uses large − / + steppers and `inputmode="numeric"`, and rejects negatives. |
| `ScanInput` | Text field with a camera button. Accepts typed codes, USB/Bluetooth scanner keyboard input, and camera scans. **This is the only search box in the app.** |
| `Combobox` | Pick item, location, or person. Searchable and accepts scans. |
| `StatusChip` | The single source of truth for status colors and icons (§3.2). |
| `DataList` | A table on desktop and cards on phones. Built-in empty, loading, and error states. Pagination. |
| `Wizard` | The 4-step Where → What → Who → Review flow with a progress indicator. Back is always allowed. Confirm happens only on the Review step. |
| `ConfirmSheet` | For official actions. It repeats exactly what will change, e.g. "Warehouse A: Safety Gloves 120 → 115". |
| `SyncPill` | Always shown in the top bar: `● Offline`, `● 3 pending`, `✓ Synced 2 min ago`. Tap it to open the Sync screen. |
| `Toast` | (sonner) Short success messages. Errors that need action stay on the page instead of disappearing. |

### 3.6 Writing style for screens

- Buttons say what they do: **"Confirm issue"**, not "Submit"; **"Save count"**, not "OK".
- Errors follow the pattern *what happened + what to do*: "Only 3 left at Warehouse A. Lower the quantity or pick another location."
- Confirmations repeat the important numbers back to the user.
- Dates use the company timezone with a readable format: `28 Oct 2026, 2:30 PM`.

---

## 4. Screen map and navigation

### 4.1 Office (Admin / Supervisor)

**Desktop sidebar:** Dashboard · Stock · Assets · Counts · Borrowing · Documents · Reports · Settings (admin only: Users, Locations, Categories/Units)
**Phone bottom nav:** Dashboard · Stock · **Scan** · Assets · More

```text
Dashboard
├── Stock ─────────── Items list → Item detail (balances per location, movements)
│                     Actions: Receive · Issue · Transfer · Import CSV · Print labels
├── Assets ────────── Asset list → Asset detail (status, custodian, history timeline)
│                     Actions: Add assets · Change status · Print labels
├── Counts ────────── Sessions → Session detail (progress) → Reconciliation review
├── Borrowing ─────── Loans (Active / Overdue / Closed) → Loan detail
│                     Actions: New borrowing · Release · Return (full / partial)
│                     Transmittals → New handover · Confirm
├── Documents ─────── All official PDFs (search by number) → Preview / Download / Reprint
├── Reports ───────── 5 fixed reports + CSV export
└── Settings ──────── Users · Locations · Categories · Units · Audit log
```

### 4.2 Field PWA

**Bottom nav:** Home · **Scan** (large, center) · Sync (with badge) · Me

```text
Home (My assignments)
└── Assignment detail ─ [Download for offline use] → "Ready for offline use ✓"
    ├── Scan / type code → Count stock (quantity) or Check asset (found / not found + condition)
    ├── My results (edit before submitting)
    └── Submit count → "Submitted on device" → Sync → "Received by server"
Scan (works anywhere: opens the matching item/asset in the current assignment)
Sync (pending list, per-item result, conflicts, [Sync now])
Me (profile, storage status, install help, sign out with pending-data warning)
Drafts (borrowing/handover drafts, marked "Draft on this device")
```

### 4.3 Key wireframes

**Field: count screen (phone).** This is the most important screen in the app.

```text
┌──────────────────────────────┐
│ ← Main Warehouse     ● 3 pend│  ← SyncPill always visible
├──────────────────────────────┤
│ Safety Gloves                │
│ PPE-0001 · pair              │
│ Last count on this device: — │
│                              │
│   ┌────┐ ┌──────────┐ ┌────┐ │
│   │ −  │ │   98     │ │ +  │ │  ← 36px number, 56px buttons
│   └────┘ └──────────┘ └────┘ │
│                              │
│ Notes (optional)             │
│ ┌──────────────────────────┐ │
│ │ Two damaged pairs        │ │
│ └──────────────────────────┘ │
│                              │
├──────────────────────────────┤
│ [      Save count      ]     │  ← sticky, full width, thumb zone
│ [ Scan next ]                │
└──────────────────────────────┘
```

When the user scans an item that already has a count, the app reopens this screen with the saved value and the banner "Already counted: 98. Edit or keep." It never adds the new scan on top of the old number (A12).

**Field: home (phone)**

```text
┌──────────────────────────────┐
│ My assignments   ✓ Synced 2m │
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │ Main Warehouse – Q4 count│ │
│ │ Due today · 42 / 120 done│ │
│ │ ✓ Ready for offline use  │ │
│ │ [ Continue counting ]    │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ Site B – Tools check     │ │
│ │ ⚠ Not downloaded         │ │
│ │ [ Download for offline ] │ │
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ Home   ( SCAN )   Sync³   Me │
└──────────────────────────────┘
```

**Office: dashboard (desktop)**

```text
┌────────┬──────────────────────────────────────────────────────────┐
│ IMS    │ Dashboard                       [ Scan or search… ] ✓    │
│        ├──────────────────────────────────────────────────────────┤
│ Dash   │ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐         │
│ Stock  │ │ 312 SKUs ││ 86 assets││ 7 low    ││ 4 overdue│         │
│ Assets │ │          ││ 12 out   ││ stock ⚠  ││ loans ⚠  │         │
│ Counts │ └──────────┘└──────────┘└──────────┘└──────────┘         │
│ Borrow │ Needs your action                                        │
│ Docs   │  • 2 count sessions waiting for review   [Review]        │
│ Reports│  • 1 borrowing draft to release          [Open]          │
│        │  • 1 PDF failed to generate              [Retry]         │
│ ──     │ Recent activity                                          │
│ Users  │  10:42 ISS-2026-000123  Issued 5 Safety Gloves  J. Cruz  │
│ Setup  │  10:15 BOR-2026-000041  Drill TOOL-0002 borrowed  …      │
└────────┴──────────────────────────────────────────────────────────┘
```

The "Needs your action" list is the core of the dashboard. Supervisors should be able to clear their day from it without opening the menu.

**Office: Issue stock wizard.** Receive, Transfer, Borrow, and Return use the same frame.

```text
 ① Where ──── ② What ──── ③ Who ──── ④ Review
 ─────────────────────────────────────────────
 Review & confirm
   From:      Main Warehouse
   To:        Juan Dela Cruz – Site repair
   Items:     Safety Gloves   5 pair   (120 → 115)
              Cable ties      2 pack   (40 → 38)
   Notes:     Work order 103
 ─────────────────────────────────────────────
 [ Back ]                       [ Confirm issue ]
```

---

## 5. Keep-it-simple decisions

These choices keep the build small. Each one can be upgraded later without a rewrite.

| Area | Simple choice for MVP | Upgrade later if… |
|---|---|---|
| App shape | One Next.js app, one URL, PWA install | Store distribution or native hardware is needed (Capacitor, §2) |
| Auth | Auth.js credentials provider + database sessions | Company SSO is required |
| Offline pull | After a successful push, re-download active assignments (allowed in §11.3) | Assignments become large enough that a change feed is needed |
| Background sync | **Sync now** button + auto-retry while the app is open and online (§10.6) | Never rely on it alone |
| Service worker | Serwist (`@serwist/next`): precache app shell + field routes, no API caching | — |
| PDFs | Generated in the request right after confirm, with a **Retry PDF** button on failure (§13.7) | Volume makes requests slow, then move to a job queue |
| Rate limiting | NGINX `limit_req` on login and transaction routes | Per-user limits are needed |
| Reports | 5 fixed reports with filters + CSV | Users need custom reports |
| Infra | One VPS, 3 containers (nginx, web, db), cron `pg_dump` | Load tests show it isn't enough |
| Theme | Light only, token-based | Users ask for dark mode |
| Forms | `react-hook-form` + Zod. The same Zod schema validates on the client and in the API | — |

---

## 6. Phases

Each phase ends with a **live demo on a real phone and a desktop**, using test data, and lists the spec acceptance tests (A01–A30, §17) that must pass. A phase is not done until its tests pass.

### Timeline at a glance

| Phase | Weeks | Theme | Main outcome |
|---|---|---|---|
| 0 | 1 | Verify & design | Real forms and data in hand, wireframes approved, design tokens set |
| 1 | 2–3 | Foundation | Running stack, login, roles, responsive app shell, design system |
| 2 | 4–5 | Stock & assets | Items, balances, receive/issue/transfer, asset registry, labels |
| 3 | 6–7 | Field PWA | Installable app, scanner, offline counting saved on the phone |
| 4 | 8–9 | Sync & counts | Safe upload, conflicts, review, approved adjustments |
| 5 | 10–11 | Borrowing & PDFs | Loans, partial returns, handovers, 4 official PDFs |
| 6 | 12–14 | Hardening & pilot | Reports, security, deployment, backups, training, pilot |

---

### Phase 0: Verify & design (Week 1)

**Goal:** stop guessing. Collect the real business facts and agree on how the app looks before writing any feature code.

**Business inputs** (§20). Assign an owner and a due date to each:
- [ ] One real sample of each form: remittal/transmittal, borrowing, return, stock issuance
- [ ] Sanitized inventory export (Excel/CSV) to define SKUs, categories, and units
- [ ] Location hierarchy (warehouse / site / area)
- [ ] Who approves releases and adjustments, and who signs each form
- [ ] Numbering convention (default: `BOR/RET/ISS/TRN-YYYY-000001`)
- [ ] Whole-number or decimal quantities (default: whole numbers)
- [ ] Count freeze policy (default: short freeze; exceptions need recount)
- [ ] List of real field phones (model + OS), and the longest expected time offline
- [ ] Hostinger plan, domain, logo, company details

**Design work:**
- [ ] Write 3 short user stories: *office admin*, *supervisor*, *field counter*. Each covers who they are, which device they use, and their top 3 tasks.
- [ ] Low-fi wireframes (paper or Figma) for the 10 key screens: Login, Dashboard, Item list, Item detail, Issue wizard, Asset detail, Field home, Count screen, Sync screen, Reconciliation review
- [ ] **Hallway test:** show the count screen and issue wizard to 1 supervisor and 1 field staffer. Can they say what each button does without help? Fix whatever confuses them.
- [ ] Confirm color tokens against the company logo and check contrast

**Tech checks:**
- [ ] Spike: `@zxing/browser` scan of QR, Code 128, EAN-13, and UPC-A on the actual field phones (a 1-page test, thrown away afterwards)
- [ ] Spike: install a blank PWA on an iPhone and an Android phone and confirm IndexedDB survives an app restart

**Done when:** open decisions have owners, the wireframes are approved, and the scanner spike works on the real phones (or a fallback is agreed).

---

### Phase 1: Foundation (Weeks 2–3)

**Goal:** a running, secure skeleton that every later screen plugs into.

**Backend:**
- [ ] Repo per §14 layout. TypeScript strict, ESLint, Prettier
- [ ] `compose.dev.yaml`: Postgres 17 + Next.js hot reload; `.env.example`
- [ ] Prisma schema, migration `0001`: `users`, `user_locations`, `locations`, `categories`, `units`, `audit_events`. Add other tables in the phase that needs them, so migrations stay small and reviewable.
- [ ] Auth.js credentials login, password hashing (argon2/bcrypt), HTTP-only cookies, logout, deactivation enforced server-side
- [ ] **One permission helper**: `requireAccess(user, action, locationId?)`, called by every API route and service (§5). Unit-tested against the role matrix.
- [ ] Shared helpers: Zod validation, the error shape `{code, message, requestId}` (§12.3), `writeAudit()`, `withIdempotency()` (used from Phase 2)
- [ ] `GET /api/health`, `GET /api/v1/me`
- [ ] Seed: 1 admin, 1 supervisor, 1 field user, 3 locations

**UI / UX:**
- [ ] Tailwind tokens (§3.1) + Inter font + shadcn setup
- [ ] Core components: `Button`, `Input`, `NumberInput`, `StatusChip`, `DataList` (table ↔ cards), `ConfirmSheet`, `Wizard` shell, `Toast`
- [ ] **Responsive app shell:** sidebar ≥1024, icon rail 768–1023, bottom nav <768; top bar with search and `SyncPill` placeholder
- [ ] Screens: Login (with clear errors and a password reset link), Users (list / create / deactivate), Locations
- [ ] A `/dev/ui` page that shows every component in every state. It serves as the living style guide.

**Tests:** permission matrix unit tests; first steps of A22/A23 (field user blocked by the API, not just by hidden buttons).

**Done when:** a new developer can run `docker compose up` from the README, log in as each role, see the right menu, and the layout works at 360 / 768 / 1280 px.

---

### Phase 2: Stock & assets (Weeks 4–5)

**Goal:** the official inventory ledger works correctly, including when several users act at once.

**Backend:**
- [ ] Migration: `items`, `item_identifiers`, `assets`, `asset_events`, `stock_balances`, `stock_transactions`, `stock_movements`
- [ ] Services (no business logic in components): `receiveStock`, `issueStock`, `transferStock`, each in one DB transaction with row locks per §9.3; balances never go negative; integer quantities
- [ ] Asset status transition map in code (§9.4). Status changes only through `changeAssetStatus()`, which always writes an `asset_event`.
- [ ] Idempotency key required on receive/issue/transfer (§12.4)
- [ ] CSV import: upload → **preview with row-by-row errors** → commit. Rejects duplicate SKUs and identifiers.
- [ ] Label payloads `ims:item:<uuid>` / `ims:asset:<uuid>` / `ims:location:<uuid>` (§6.3)

**UI / UX:**
- [ ] Item list (search + scan, category filter, Low/Out chips) → Item detail (balance per location, movement history)
- [ ] **Receive / Issue / Transfer wizards** using the shared 4-step `Wizard`. The review step shows before → after balances.
- [ ] Asset list → Asset detail with a **history timeline** (who had it, when, and its condition)
- [ ] "Add assets" with a quantity, e.g. create 5 drills that get 5 tags
- [ ] Label print page: A4 sheet of QR / Code 128 labels, sized for common label paper, printed from the browser (`@media print`)
- [ ] CSV import screen: drag-and-drop or file picker, preview table with red error rows, "Import 118 valid rows" button
- [ ] Dashboard v1: KPI cards + low-stock list

**Tests:** A01–A06, including a concurrency integration test against real Postgres (two parallel issues for the last 3 units).

**Done when:** you can import sample data, receive, issue, and transfer on a phone and on a desktop, ledger sums equal balances, and the concurrency tests pass.

---

### Phase 3: Field PWA (Weeks 6–7)

**Goal:** a field user can download an assignment, go offline, and count all day without losing anything.

**Backend:**
- [ ] Migration: `count_sessions`, `count_session_items`, `count_entries`
- [ ] Minimal count-session creation (full admin UI comes in Phase 4)
- [ ] `GET /api/v1/sync/bootstrap?sessionId=` returns only assigned, safe fields (§11.3)

**Offline / client:**
- [ ] Web manifest, icons, `offline.html`; Serwist service worker precaching the field shell + scanner bundle; **no caching of private API responses**
- [ ] Field routes are client-rendered and read from Dexie (§10.4)
- [ ] Dexie DB per user (`ims-field-<userId>`) with the tables from §10.3 and typed records
- [ ] `navigator.storage.persist()` + quota check, with results shown on the Me screen (§10.5)
- [ ] Update banner: "New version ready. Update when you finish counting." The app never reloads during a count.

**UI / UX:**
- [ ] Field Home (assignment cards with progress and offline-ready state)
- [ ] **Download for offline use** button with progress, then a clear `✓ Ready for offline use`
- [ ] **Scan screen:** full-screen camera with a framing box, torch toggle where supported, haptic/beep on a successful read, and a big **"Type code instead"** button. If camera permission is denied, explain how to allow it, with manual entry still working (A29).
- [ ] **Count screen** (wireframe §4.3), asset check screen (Found / Not found + condition picker)
- [ ] My results list (edit any line before submitting)
- [ ] Install-help sheet with separate steps for Android and iPhone
- [ ] Storage-full / disabled error that is impossible to miss. The app never says "Saved" if the save failed (A30).

**Tests:** A11–A14, A29, A30. Write a **device test report** (phone model, OS, browser, result) for each pilot phone.

**Done when:** on real Android and iPhone devices, in airplane mode, a user can record 100+ lines, force-close the app, reopen it, and find everything still there.

---

### Phase 4: Sync & counts (Weeks 8–9)

**Goal:** offline work reaches the server exactly once, conflicts are visible, and stock changes only after approval.

**Backend:**
- [ ] Migration: `sync_operations`, `count_reviews`
- [ ] `POST /api/v1/sync/push`: max 50 ops; process each operation independently in the exact order of §11.4; unique (`user_id`, `operation_id`); same hash returns the stored result, different hash is rejected; outcome saved in the same transaction as the count
- [ ] Results: `ACKED`, `CONFLICT`, `REJECTED`, `RETRYABLE_ERROR`
- [ ] Re-download active assignments after a push (simple pull, §5)
- [ ] Reconciliation service: expected vs counted, variance, recount request, approve → **one adjustment transaction per line** (§9.3), checking for movements during the count
- [ ] Count freeze: block stock movements in the counted scope while a session is open, unless a supervisor records an exception

**Client:**
- [ ] Outbox lifecycle `PENDING → SENDING → ACKED / CONFLICT / FAILED` (§11.2). Frozen payload with a stable UUID. `SENDING` items found on app start are retried with their original ID.
- [ ] Auto-retry while online and the app is open; **Sync now** button always available
- [ ] Never send pending ops under a different account. Sign-out with pending items shows a warning and a deliberate choice.

**UI / UX:**
- [ ] **Sync screen:** counts per state, a list with per-item `StatusChip`, and for conflicts a plain explanation plus the next action ("Session was closed by supervisor. Your count is kept. Ask your supervisor to reopen or recount.")
- [ ] `SyncPill` wired to live outbox state across the app
- [ ] Office: Count sessions list → Create session wizard (location → items/assets → people → time window) → Session progress (per counter, per line)
- [ ] **Reconciliation review:** one row per line with expected / counted / variance (colored), counter's notes, movements during the count, and actions *Approve*, *Request recount*, *Keep expected*. Bulk-approve is allowed only for zero-variance lines.

**Tests:** A15–A21, A28, plus every scenario in §11.5. Run the two-device conflict test on real phones.

**Done when:** you can pull the network mid-upload, retry, and get no duplicates; approved variances post exactly one adjustment each; and a supervisor can review a 100-line session in a few minutes.

---

### Phase 5: Borrowing, handovers & PDFs (Weeks 10–11)

**Goal:** equipment custody is traceable, and every confirmed transaction can be printed as an official document.

**Backend:**
- [ ] Migration: `borrowings`, `borrowing_lines`, transmittal tables, `document_sequences`, `pdf_documents`
- [ ] Release: lock assets, require `AVAILABLE` with no open loan line, set `BORROWED` + custodian, write events, all in one transaction (§9.3)
- [ ] Return per line: good → `AVAILABLE`, damaged → `UNDER_MAINTENANCE` / `NEEDS_REVIEW`; the loan header closes only when every line is resolved (§7.6)
- [ ] Transmittal confirm links to a real transfer, issue, or custody event (§7.8)
- [ ] Number allocation in the same transaction as the confirm; immutable document snapshot (§13.4)
- [ ] `pdf-lib` renderer for 4 templates built from the Phase 0 samples: embedded font, repeated headers, page X of Y, signature blocks, `DRAFT` watermark on previews
- [ ] PDFs stored in a private volume and served through an access-checked route only (never `public/`)
- [ ] PDF failure → `PDF_FAILED` + retry from the snapshot, with no second movement (§13.7)

**UI / UX:**
- [ ] **Borrow wizard:** Where (location) → What (scan asset tags, each shown with a status chip; unavailable ones are blocked with the reason) → Who (borrower, purpose, due date) → Review (condition, accessories) → Confirm release
- [ ] Loans list with tabs *Active / Overdue / Closed*; overdue highlighted
- [ ] **Return flow:** scan the asset or open the loan, tick which lines are coming back, set condition per line, confirm. Partial returns are obvious ("2 of 3 returned").
- [ ] Field: borrowing/handover **drafts** saved on the device and labeled `Draft on this device – not official`
- [ ] Document center: search by number, preview in the browser, Download, Reprint, Retry PDF
- [ ] After every confirm: a success screen with the document number and **[Download PDF] [Print] [Done]**

**Tests:** A07–A10, A24 (including a 30-row multi-page PDF), A25. Print every template at 100% on the chosen paper size and check the signature spaces on paper.

**Done when:** two supervisors racing to release the same drill results in exactly one success, and all four PDFs match the approved company templates on paper.

---

### Phase 6: Hardening, deployment & pilot (Weeks 12–14)

**Goal:** a pilot that is safe, recoverable, and that people can use after short training.

**Features:**
- [ ] 5 fixed reports with filters (item, location, user, date, status, reference) + CSV export with formula-injection escaping (§9.5): *Stock balances*, *Movement ledger*, *Asset status & custody*, *Overdue loans*, *Count discrepancies*
- [ ] Audit log viewer (filter by user, record, date)
- [ ] Dashboard v2: "Needs your action" list wired to real data (§4.3)

**Quality:**
- [ ] Accessibility pass: keyboard-only run of every office flow, screen-reader labels, contrast check, 200% zoom; Lighthouse ≥ 90 for accessibility and PWA
- [ ] Responsive pass on every screen at 360 / 390 / 768 / 1024 / 1440 px with no horizontal scroll
- [ ] Security review against §16 + OWASP ASVS: cross-location access, replay, CSRF, PDF URL guessing, path traversal, import injection; dependency + image scan
- [ ] k6 load test: concurrent issues + sync bursts at the expected pilot size

**Deployment** (§15):
- [ ] Multi-stage Dockerfile, production `compose.yaml`, NGINX with HTTPS + Certbot auto-renew, `limit_req` on login and transaction routes
- [ ] VPS hardening checklist (§15.6)
- [ ] Migrations run as a separate step after a backup
- [ ] Nightly `pg_dump` + PDF volume, encrypted, copied off the VPS; retention 14 daily / 8 weekly
- [ ] **Witnessed restore** to a clean test server (A26); container replacement keeps data (A27)
- [ ] Monitoring: disk, memory, DB health, HTTP errors, TLS expiry, backup failures, failed sync ops

**Training & handover:**
- [ ] 1-page quick guides with screenshots: *Field: count offline & sync*, *Supervisor: review & approve*, *Supervisor: borrow & return*, *Admin: users, items, import*
- [ ] 30-minute training session per group; watch at least one user finish a task with no help and note where they hesitate
- [ ] Pilot at one site for 1–2 weeks; collect issues in a tracker; fix stock-accuracy and data-safety bugs first
- [ ] Turnover items from §19

**Done when:** the §21 "Ready for internal pilot" checklist is complete and A01–A30 pass or have approved exceptions.

---

## 7. Definition of done (every screen, every phase)

- [ ] Works at 360 px and at desktop width; no horizontal scroll
- [ ] Has loading, empty, error, and success states
- [ ] Primary action is clear, ≥ 48 px, and protected from double submission
- [ ] Official actions go through a review/confirm step that repeats what will change
- [ ] Every input has a visible label; errors appear next to the field and say how to fix it
- [ ] Keyboard usable, visible focus, AA contrast
- [ ] Permissions enforced in the API (tested), not only by hiding buttons
- [ ] Every state change writes an audit event
- [ ] Business rules live in a server service with at least one test

## 8. UX success measures for the pilot

| Measure | Target |
|---|---|
| New field user completes a first offline count after a 10-minute demo | ≥ 90% of testers |
| Time to count one stock item (scan → save) | ≤ 10 seconds |
| Supervisor issues stock (open wizard → confirm) | ≤ 60 seconds |
| Lost or duplicated counts during the pilot | **0** |
| Support questions about sync status ("did it send?") | Trending to zero by week 2 |

## 9. Top risks and how this plan handles them

| Risk | Mitigation |
|---|---|
| Real forms or data arrive late | Phase 0 gate; build with labeled sample data; hold PDF sign-off until originals arrive |
| Camera scanning is unreliable on some phones | Phase 0 spike on real devices; manual entry and USB/Bluetooth scanners always work through `ScanInput` |
| iPhone PWA storage surprises | Early device spike; persist request; visible pending counts; field manual explains the limits |
| Users don't trust sync | One honest `SyncPill` everywhere; "Received by server" only after acknowledgment; per-item results |
| Scope creep | Anything outside §4 needs written approval and an estimate. The default answer is "after the pilot". |
| Schedule pressure on offline tests | Phases 3–4 tests are non-negotiable (§18); cut optional screens before cutting tests |
