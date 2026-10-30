# Offline and sync notes (field app)

For the developer or administrator who takes over IMS. It describes the field app at `/field` **as built**. The design is in `IMS_MVP.md` §10–§11; where the code differs, the code wins and the difference is listed in [Differences from the spec](#differences-from-the-spec).

All paths are relative to `ims/`.

**Main files**

| Part                            | Files                                                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phone storage                   | `lib/field/db.ts` (Dexie schema), `lib/field/store.ts` (download, scan lookup, save count)                                                                                                                                                       |
| Sending                         | `lib/field/outbox.ts` (Send counts, Sync now), `lib/field/refresh.ts` (pull after send)                                                                                                                                                          |
| Phone identity, network, device | `lib/field/identity.ts`, `lib/field/net.ts`, `lib/field/device.ts`                                                                                                                                                                               |
| Screens                         | `components/field/field-app.tsx` (boot + router), `components/field/field-context.tsx` (sync state, auto-retry), `components/field/send-result.tsx`, `components/field/field-shell.tsx` (header pill, update banner), `components/field/views/*` |
| Service worker                  | `sw/sw.ts`, served by `app/serwist/[path]/route.ts`, registered by `components/field/sw-provider.tsx` (only in `app/(field)/layout.tsx`); `components/field/update-banner.tsx`; `app/manifest.ts`; `public/offline.html`                         |
| Server                          | `app/api/v1/sync/bootstrap/route.ts`, `app/api/v1/sync/push/route.ts`, `app/api/v1/counts/mine/route.ts`, `lib/counts/sync.ts`, `lib/counts/service.ts`, `lib/counts/review.ts`, `checkCountFreeze` in `lib/inventory/stock.ts`                  |

---

## 1. What works offline, what needs internet

**Works offline** (once the person has signed in and downloaded the assignment on this phone):

- Open `/field` (the static shell is precached; `app/(field)/field/page.tsx` is `force-static`).
- See downloaded assignments with progress (Home, assignment screen).
- Scan (camera) or type a code and find the line in downloaded assignments. The scanner's WASM (`public/zxing/zxing_reader.wasm`) is precached. Formats: `qr_code`, `code_128`, `ean_13`, `upc_a`, `ean_8`, `upc_e` (`lib/field/scan-formats.ts`).
- Save or change a stock count (whole number 0–1,000,000) or an asset check (found + condition `GOOD`/`FAIR`/`DAMAGED`, or not found), with notes up to 1,000 characters (`saveCountDraft` in `lib/field/store.ts`). Counting again replaces the value; it never adds.
- My results, the Sync screen, and the "not sent" counts in the header.
- Tap **Send counts**: the counts are queued on the phone and sent later.
- Prepare a borrowing request ("Draft on this device") (`lib/field/borrow.ts`, `views/borrow-view.tsx`). The location list comes from the last online `/api/v1/me`, kept in `localStorage` under `ims-field-locations-<userId>`, plus the locations of downloaded counts.
- Me screen: storage use and the "protected from clean-up" status.

**Needs internet:**

- First sign-in on this phone (or in the installed app on iPhone, see §7), and every new sign-in.
- Seeing new assignments (`GET /api/v1/counts/mine`) and downloading one (`GET /api/v1/sync/bootstrap`).
- Sending counts (`POST /api/v1/sync/push`), so the server checks permissions and session status at that moment.
- Getting recount requests and closed counts (refresh after a send, §5).
- Sending a borrowing request (`POST /api/v1/borrowings`). The button is turned off while offline.
- Signing out (the button is turned off while offline; `views/me-view.tsx`).
- The whole office app. Office pages are never cached; when the server can't be reached the service worker shows `public/offline.html` ("You're offline", with a link to `/field`).

"Online" in the field app means **the phone has a connection AND the server answered the last request** (`navigator.onLine && serverReachable()`, `field-context.tsx`). `fieldFetch` (`lib/field/net.ts`) marks the server unreachable on a network error or a 5xx answer, with a 6 s default timeout. So the header can say "Offline" on weak Wi-Fi even when the phone shows signal.

---

## 2. Phone storage

### One database per user

- IndexedDB database name: **`ims-field-<userId>`** (`fieldDbName` in `lib/field/db.ts`).
- The database is opened in `openDb` (`field-app.tsx`) for the user that `localStorage` key **`ims-field-user`** names (`lib/field/identity.ts`; only `id`, `name`, `role`). That key lets the app open the right database offline without waiting for the server.
- If the server says someone else is signed in, the app stores the new user and reloads, so it opens **their** database (`field-app.tsx`). The earlier user's database stays on the phone, untouched.

### Tables (current Dexie version: **3**)

| Table            | Key (and indexes)                                                                      | Holds                                                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assignments`    | `id` (index `downloadedAt`)                                                            | One downloaded count session: reference, name, status, due date, notes, location `{id, code, name}`, `serverVersion` (the session `version` at download), `targetCount`, `downloadedAt`, `serverTime`.                                                                      |
| `targets`        | `id` (indexes `sessionId`, `[sessionId+kind]`)                                         | One line to count: `kind` `STOCK` or `ASSET`, line `version`, item id/SKU/name/unit, asset id/tag/serial, and the asset's last-synced `lastStatus`/`lastCondition` (display only). **No expected quantity** (blind count).                                                  |
| `identifiers`    | `[sessionId+code]` (indexes `code`, `targetId`)                                        | Scan lookup: every code that finds a target (SKU or asset tag, IMS label payload `ims:item:<id>` / `ims:asset:<id>`, active barcodes).                                                                                                                                      |
| `countDrafts`    | `id` = `` `${sessionId}:${targetId}` `` (indexes `sessionId`, `targetId`, `updatedAt`) | The one current count per session and line: `quantity` or `found` + `condition`, `notes`, `baseVersion` (the line version when saved), `createdAt`, `updatedAt`, `saveCount` (goes up on every save).                                                                       |
| `outbox`         | `operationId` (indexes `userId`, `sessionId`, `status`, `createdAt`, `draftId`, `seq`) | Frozen uploads (§3): `payload`, `status`, `attempts`, `seq` (send order), `draftId` + `draftSaveCount` (which save of which draft), `sentAt`, `ackedAt`, `lastError`, `result` (server `code`, `message`, `nextAction`, `serverVersion`).                                   |
| `syncMeta`       | `id` (always `"meta"`)                                                                 | `userId`, `deviceId` (random UUID made on first open, sent with every push), `schemaVersion`, `lastSyncAt`. `lastDownloadAt` is in the type but never written. `schemaVersion` is written as `1` once and never updated: **it is not the Dexie version**; don't rely on it. |
| `inboxConflicts` | `operationId` (index `sessionId`)                                                      | Declared in version 1 but **not used**. Conflicts live on the outbox row (`status` + `result`).                                                                                                                                                                             |
| `borrowDrafts`   | `id` (indexes `status`, `updatedAt`)                                                   | Borrowing requests prepared on the phone. `id` is also the `Idempotency-Key`. Status `DRAFT` / `SENDING` / `SENT` / `REJECTED` / `FAILED`.                                                                                                                                  |

Version history (`lib/field/db.ts`): v1 = first 7 tables; v2 = `outbox` gains `draftId`, `seq` indexes (Phase 4); v3 = `borrowDrafts` (Phase 5).

### Changing the schema safely

Phones in the field may hold unsent counts in an older version. The browser upgrades the database the first time the new app code opens it.

1. **Never edit or remove an existing `this.version(n)` block.** Add `this.version(4).stores({ ... })` below the last one, listing **only** the tables whose keys or indexes change, or new tables.
2. Change the primary key of a table only by making a new table and copying rows in `.upgrade(tx => ...)`. Dexie can't change a primary key in place.
3. If existing rows need new fields, fill them in `.upgrade(...)`. Code that reads old rows must cope with the field missing.
4. **Never drop or clear `outbox` or `countDrafts`** (or set them to `null` in a version). That deletes unsent counts with no way back.
5. Test it: in a unit test (`fake-indexeddb`, like `tests/unit/field-store.test.ts`), create a database with the old versions, write rows, then open it with the new class and check the rows. Then test on a real phone with a production build.
6. Remember the service worker update flow (§6): the new code only runs after the person taps **Update now** or all tabs close, so old and new app versions run side by side for a while. The server must keep accepting the old push payload shape.

### What is never stored on the phone

- No passwords, session tokens or CSRF tokens in IndexedDB or `localStorage` (`lib/field/db.ts` header, `identity.ts`). The login session is an `httpOnly` cookie handled by the browser (`lib/auth/auth.ts`).
- No expected quantities, no other users, no costs: the bootstrap sends only safe fields (`bootstrapSession`, `lib/counts/service.ts`).
- No API responses in the service-worker cache (§6).

---

## 3. The life of a count

### States (exact names in code)

Phone, per count (`DraftSyncState` in `lib/field/outbox.ts`; labels in `components/common/status-chip.tsx`):

| State      | Meaning                                                                                                                                                        | Label on screen      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `DRAFT`    | Saved on the phone, changed since it was last queued (or never queued). Not a stored status: computed when there is no outbox row for the current `saveCount`. | Draft on this device |
| `PENDING`  | Frozen into the outbox, not sent yet.                                                                                                                          | Pending sync         |
| `SENDING`  | In a request that hasn't been answered yet.                                                                                                                    | Sending…             |
| `ACKED`    | The server saved it. **Only this state means received.**                                                                                                       | Received by server   |
| `CONFLICT` | The server stored the outcome but did not take the count: session closed or recount requested.                                                                 | Conflict             |
| `REJECTED` | The server refused it: no permission, invalid, or ID reused.                                                                                                   | Not accepted         |
| `FAILED`   | No answer, an HTTP error, or `RETRYABLE_ERROR`. Will be retried.                                                                                               | Failed – retry       |

Server results per operation (`PushResult` in `lib/counts/sync.ts`): `ACKED`, `CONFLICT`, `REJECTED`, `RETRYABLE_ERROR`. On the phone, `RETRYABLE_ERROR` or any unknown status becomes `FAILED`.

```text
save on phone            Send counts               Sync now / auto-retry
countDrafts  ──DRAFT──►  outbox PENDING  ──►  SENDING ──► ACKED
(saveCount+1)            (UUID, frozen)          │    ├─► CONFLICT  (SESSION_CLOSED, RECOUNT_REQUESTED)
                                                 │    └─► REJECTED  (FORBIDDEN, VALIDATION_FAILED, OPERATION_REUSED)
                                                 └──────► FAILED    (no answer / HTTP error / RETRYABLE_ERROR) ─► sent again
```

### Freezing (`submitDrafts` / `freeze`)

- **Send counts** puts every draft in that assignment whose `saveCount` differs from the latest outbox row for it into the outbox (one Dexie transaction). Each one gets a new `operationId` from `crypto.randomUUID()` and a `seq` that keeps increasing.
- The payload is fixed at that moment: `{ operationId, type: "SUBMIT_COUNT", sessionId, targetId, baseVersion, clientRecordedAt: draft.updatedAt, payload: { quantity, notes } | { found, condition, notes } }`. It is **never changed** afterwards.
- Tapping Send twice queues nothing more (same `saveCount`).
- Editing a count after sending it bumps `saveCount`. It shows as `DRAFT` again, and the next Send makes a **new** operation. On the server the newer count replaces the person's older one (older entry `SUPERSEDED`).
- **Send again** (Sync screen, for `CONFLICT`/`REJECTED`, `sendAgain`) freezes the current draft into a new operation. It is hidden for `RECOUNT_REQUESTED`: for that one, count the line again and Send.

### When an outbox row is deleted

**Never.** No code deletes outbox rows (or count drafts). `ACKED` rows stay as the record of what the server has. The newest row per draft decides the state shown (`latestByDraft`). The only way they disappear is the browser deleting the site's data (§7).

### Send counts vs Sync now

| Button            | Where                                                      | What it does                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Send N counts** | Assignment screen, My results (only when there are drafts) | `sendCounts(sessionId)`: freeze the drafts of **this assignment**, then run Sync now. Offline, they stay queued (`PENDING`).                                                                                                                                      |
| **Sync now**      | Sync screen                                                | `runSync()`: send every `PENDING`/`SENDING`/`FAILED` row of this user, then refresh assignments (§5). With nothing to send, it still refreshes when `navigator.onLine`. It does **not** freeze drafts; the Sync screen tells people to use Send counts for those. |

`syncNow` (`lib/field/outbox.ts`) step by step:

1. Load the rows with status `PENDING`, `SENDING` or `FAILED` and `userId` = this user, in `seq` order. If there are none, stop (`nothing`). `SENDING` rows left by a closed app are sent again with the same ID.
2. `whoAmI()` (`GET /api/v1/me`, 4 s timeout). If offline, stop (`offline`). If 401, stop (`signed-out`: "Sign in again to send your counts. They stay on this phone."). If the server says a different user, stop (`wrong-user`). Nothing is sent under another account.
3. In batches of **50** (`BATCH`): mark the rows `SENDING` (`attempts + 1`, `sentAt`), then `POST /api/v1/sync/push` with `{ deviceId, operations: [payloads] }`, 30 s timeout.
4. No answer or not OK: the whole batch becomes `FAILED` with `lastError`, and the remaining batches wait for the next run. A 401 says "You're signed out…"; any other status says "The server answered with an error (status)…".
5. Answer received: each row is matched to its result by `operationId` (or by position). `ACKED` sets `ackedAt`. `CONFLICT`/`REJECTED` store `result`. Anything else becomes `FAILED`.
6. Write `syncMeta.lastSyncAt`.

Only one sync runs at a time (`running` ref in `field-context.tsx`). If Send counts is tapped while a sync is running, it joins that run. Counts queued just then go in the next run (auto-retry).

### Automatic retry

`field-context.tsx`, `RETRY_MS = 30_000`:

- Runs only **while the app is open**, **online** (as defined in §1), and **at least one count is queued** (`summary.queued` > 0, i.e. `PENDING`/`SENDING`/`FAILED`).
- First try 1.5 s after those conditions become true (for example when the connection comes back), then every 30 s.
- It never freezes drafts: a count nobody tapped Send for is never sent by itself.
- There is no service-worker background sync (spec §10.6). Nothing is sent while the app is closed.

---

## 4. Server: `POST /api/v1/sync/push`

Route `app/api/v1/sync/push/route.ts`, logic `pushOperations` in `lib/counts/sync.ts`.

**Request:** `{ deviceId: string (1–64), operations: [1..50] }` (`MAX_OPS = 50`; 51 or more gives `VALIDATION_FAILED` for the whole request). **Answer:** `{ results: [...], serverTime }`, one result per operation, in the order sent.

### Order of checks

Whole request (`route()` in `lib/api/route.ts`, then `pushOperations`):

1. Same-origin check on writes (`BAD_ORIGIN` 403).
2. Signed in (`UNAUTHENTICATED` 401).
3. Account `ACTIVE`, otherwise the whole request is refused (`ACCOUNT_INACTIVE` 401) and nothing is stored.
4. Request shape (`deviceId`, 1–50 operations).

Then each operation separately, in order. One bad operation doesn't block the others (`processOne` / `handle`):

1. **Shape** (Zod `opSchema`: UUIDs, `type: "SUBMIT_COUNT"`, `baseVersion` ≥ 1, quantity 0–1,000,000 whole, condition enum, notes ≤ 1000, no extra payload keys). If it fails: `REJECTED VALIDATION_FAILED`, **not stored** (`operationId` is `null` when it couldn't be read).
2. Start a database transaction (15 s timeout). Take the **advisory lock** `pg_advisory_xact_lock(hashtextextended('sync:<userId>:<operationId>', 0))`, so two copies of the same operation arriving together run one after the other.
3. **Idempotency**: look up `sync_operations` by (`user_id`, `operation_id`).
   - Found with the same `payload_hash`: return the **stored response** as is (no new count).
   - Found with a different hash: `REJECTED OPERATION_REUSED`, audit `sync.operation_reused`, **not stored** (the original outcome stays).
4. **Session**: `SELECT … FROM count_sessions … FOR SHARE`. Many phones can submit at once, but close, review and recount (which take `FOR UPDATE`) wait for them.
5. **Assignment and permission**: the session exists, the user is an assignee (`count_session_assignees`), and `can(actor, "counts.submit", location)`. If not: `REJECTED FORBIDDEN`, audit `count.submit_denied` (with the payload), stored.
6. **Line**: `SELECT … FROM count_session_items … FOR UPDATE` (lock order: session, then line). The line must belong to the session, or it's `REJECTED VALIDATION_FAILED` "That item is not part of this count any more.", stored.
7. **Payload fits the line**: STOCK needs `quantity` and no `found`/`condition`; ASSET needs `found`, and `condition` only when found. Otherwise `REJECTED VALIDATION_FAILED`, stored.
8. **Session open**: if status isn't `OPEN`, `CONFLICT SESSION_CLOSED`, stored, audit `count.conflict` with the payload.
9. **Version**: line `version` ≠ `baseVersion` gives `CONFLICT RECOUNT_REQUESTED`, stored, audit `count.conflict`.
10. **Accept**: this person's `SUBMITTED` entries for the line become `SUPERSEDED`. Create the new `count_entries` row (with `operationId`, `deviceId`, `clientRecordedAt`), audit `count.submitted`, store `ACKED` with `serverRecordId` and `serverVersion`. All of this is in the same transaction.

If something unexpected goes wrong, the transaction rolls back. The answer is `RETRYABLE_ERROR` code `INTERNAL`, **not stored**, logged with the request ID, and the phone retries with the same ID.

### Idempotency details

- Key: (`user_id`, `operation_id`), the primary key of `sync_operations` (`prisma/schema.prisma`, model `SyncOperation`). `count_entries` also has a unique (`counter_id`, `operation_id`).
- `payload_hash` = SHA-256 of a stable JSON of `type, sessionId, targetId, baseVersion, clientRecordedAt, payload{quantity, found, condition, notes}`. **`deviceId` is not in the hash**, so a retry from a reinstalled app still matches.
- Stored: `ACKED`, `CONFLICT`, and `REJECTED` (for `FORBIDDEN` and the `VALIDATION_FAILED` cases at steps 6 and 7). Not stored: the shape failure at step 1, `OPERATION_REUSED`, `RETRYABLE_ERROR`.
- Outcomes are kept forever (no cleanup), with the count history.

### Result codes

| Status            | Code                | When                                                                          | What the phone tells the person                                 |
| ----------------- | ------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `ACKED`           | —                   | Saved                                                                         | Received by server                                              |
| `CONFLICT`        | `SESSION_CLOSED`    | Session not `OPEN` when the count arrived                                     | "Ask your supervisor to reopen the count or to recount."        |
| `CONFLICT`        | `RECOUNT_REQUESTED` | Line version changed (recount asked after counting)                           | "Count it again, then send."                                    |
| `REJECTED`        | `FORBIDDEN`         | Not an assignee any more, session gone, or no `counts.submit` at the location | "Ask your supervisor or an administrator to check your access." |
| `REJECTED`        | `VALIDATION_FAILED` | Unreadable operation, line not in the session, or wrong payload for the line  | Depends on the case; see `lib/counts/sync.ts`                   |
| `REJECTED`        | `OPERATION_REUSED`  | Same ID, different content                                                    | "Tap 'Send again' to send it as a new count."                   |
| `RETRYABLE_ERROR` | `INTERNAL`          | Unexpected server error                                                       | Retried automatically                                           |

Most `nextAction` texts start with "Your count is kept on this phone." (`KEEP`).

### Closed session, unassigned, lost permission

- **Closed session**: `CONFLICT SESSION_CLOSED`. The count is not saved as an entry, but the outcome and the audit event `count.conflict` (with the counted values) are kept. `closeCountSession` takes `FOR UPDATE` on the session, so it waits for counts being saved right now. Every saved count is therefore before `closedAt`. A supervisor can reopen (`reopenCountSession`, `lib/counts/review.ts`); the person then taps Send again.
- **Removed from the count / lost location access / session deleted**: `REJECTED FORBIDDEN`, audit `count.submit_denied` with the payload, so an administrator can recover the values from the audit log.
- **Deactivated account**: the whole request gets 401 `ACCOUNT_INACTIVE`. The phone marks the batch `FAILED` ("You're signed out…") and keeps it.
- The monitor (`infrastructure/monitor/monitor.sh`) alerts on `sync_operations` rows that aren't `ACKED` in the last 24 h (`docs/runbook.md`).

### Related: count freeze

While a count session is `OPEN`, `checkCountFreeze` (`lib/inventory/stock.ts`) blocks receiving, issuing, or either end of a transfer of a **STOCK** item at that location (`COUNT_IN_PROGRESS` 409). A supervisor with `counts.approve` can go ahead by recording an exception with a reason. The review then shows the line as moved and needs a recount before approval (`lib/counts/review.ts`).

---

## 5. Download (bootstrap) and refresh

### What is downloaded

`GET /api/v1/sync/bootstrap?sessionId=<uuid>` → `bootstrapSession` (`lib/counts/service.ts`):

- Allowed only if the user has `records.view`, is an **assignee**, and has `counts.perform` at the location. Otherwise 404. A session that isn't `OPEN` gives 409 "… is closed."
- Returns `session` (id, reference, name, status, dueAt, `version`, notes, location), `targets` (id, kind, `version`, item id/sku/name/unit code, asset id/tag/serial/status/condition), `identifiers` (`{code, targetId}`: SKU or tag, label payload, active barcodes), and `serverTime`.
- `cache-control: no-store` on every API response (`lib/api/route.ts`); NGINX also never caches `/api/` (`infrastructure/nginx/templates/ims.conf.template`).

On the phone, `saveBootstrap` (`lib/field/store.ts`) **replaces** that session's targets and identifiers, and stores the assignment. It **never touches `countDrafts` or `outbox`**. After a download the Home screen calls `askPersist()` and waits up to 3 s for the service worker to be ready.

### When it is refreshed

- **By hand**: Home shows **Download for offline use** for assignments not on the phone, and **Download again** when the server's session `version` differs from the stored `serverVersion` ("The supervisor changed this count…").
- **Automatically** after a sync (`refreshAssignments`, `lib/field/refresh.ts`, called in `runSync`): when the run ended `done`, or ended `nothing` while `navigator.onLine`. It fetches `/api/v1/counts/mine` (open sessions where the user is an assignee and can count, `listMyAssignments`). Each downloaded assignment that is still listed is downloaded again. 15 s timeout per call; if the server can't be reached, nothing changes.
- The session `version` goes up on close, reopen and recount request (`lib/counts/service.ts`, `lib/counts/review.ts`). A recount also raises the **line** `version`. After the refresh, the count screen shows "Recount requested" when the line version is above the draft's `baseVersion` (`views/count-view.tsx`).

### Stale assignments

- A downloaded assignment that `/counts/mine` no longer lists (closed, the user taken off it, or location access lost) is marked `status: "CLOSED"` **on the phone only**. Its targets and counts stay. The assignment screen says "Your supervisor closed this count…"; the Sync screen says "closed by supervisor" (even when the real reason is an access change).
- Home shows "No longer open on the server. Your counts stay on this phone." for those.
- Counting is still possible on a closed assignment. Sending it gives `SESSION_CLOSED` or `FORBIDDEN`.
- Assignments are never deleted from the phone. If the session is reopened, the next refresh downloads it again with status `OPEN`.

---

## 6. Service worker

`sw/sw.ts` (Serwist 9), built and served at `/serwist/sw.js` by `app/serwist/[path]/route.ts`, registered with scope `/` by `components/field/sw-provider.tsx`. It is registered only from the field layout `app/(field)/layout.tsx`, so a phone gets it the first time it opens `/field`.

**Runs only in a production build.** `disable={process.env.NODE_ENV !== "production"}`. In `npm run dev` the Home screen says "(Development mode: the offline app is turned off.)". To test offline: `npm run build`, then `npx next start -p 3100`. The `prebuild` script copies the scanner WASM to `public/zxing/` (`scripts/copy-zxing.mjs`). For a real offline test, **stop the server**: Chrome DevTools "offline" doesn't stop the service worker's own requests.

**Precached** (`app/serwist/[path]/route.ts`):

- `/field`, with a new random `revision` for each build (so every deploy installs a new shell).
- `.next/static/**/*.{js,css,woff,woff2,png,svg,ico,json}` and `public/**/*` (`offline.html`, `zxing/zxing_reader.wasm`). Files over **4 MB** are skipped (`maximumFileSizeToCacheInBytes`).
- Navigations to `/field` or `/field?…` get the precached shell (`navigateFallback: "/field"`, allowlist `^/field(?:\?.*)?$`). Screens change through `?v=…&a=…&t=…` with `history.pushState`, without a server round trip.

**Runtime:**

- `/api/*` → `NetworkOnly`. **Never cached.** Private data lives only in IndexedDB.
- Other same-origin navigations (office pages) → `NetworkOnly`, falling back to `/offline.html` when the network fails.
- Same-origin fonts and images (not `/api/`) → `StaleWhileRevalidate` in cache `ims-static`.
- `cleanupOutdatedCaches: true` removes old precaches. It only touches Cache Storage, **never IndexedDB**, so an update can't delete unsent counts.

**Update flow** (never reloads during a count):

1. A deploy changes the precache, so the browser installs the new worker, which **waits** (`skipWaiting: false`).
2. The `waiting` event shows the banner at the top of every field screen: **"New version ready. Update when you finish counting."** with **Update now** (`components/field/update-banner.tsx`).
3. Tapping **Update now** sends `SKIP_WAITING`. When the new worker takes control, the page reloads. It reloads **only** if the person tapped the button.
4. Nothing else reloads by itself: `reloadOnOnline={false}`, `cacheOnNavigation={false}`, `navigationPreload: false`. Unsent counts are in IndexedDB and survive the update.
5. If nobody taps Update, the new version starts after every IMS tab or app window is closed.

`app/manifest.ts`: name "IMS – Field counts", `start_url: "/field"`, `scope: "/"`, `display: "standalone"`, portrait. Production must use HTTPS (camera and service worker need a secure context; without it the scanner says so, `components/field/scanner.tsx`).

---

## 7. Device limits and what to tell staff

| Topic                                       | How it works                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Tell staff                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage persistence                         | `navigator.storage.persist()` is requested after each download and by the **Keep my data safe** button on Me (`lib/field/device.ts`). The browser may refuse. Me shows "Protected from automatic clean-up: Yes / No / Unknown".                                                                                                                                                                                                                                         | Install the app and tap **Keep my data safe**. If it still says No, sync often.                                                                            |
| Quota and eviction                          | Me shows use vs quota from `navigator.storage.estimate()`, warning at ≥ 90%. A full disk gives a loud "Your count was NOT saved…" (`FieldStorageError` kind `FULL`). Blocked storage (private mode, storage turned off) is `UNAVAILABLE`, and the boot screen turns counting off ("This phone can't save counts here"). Every save is read back before "Saved" is shown (`saveCountDraft`). Without persistence the browser may clear site data under storage pressure. | Keep free space on the phone. Don't use private/incognito tabs. If a save says NOT saved, it really wasn't.                                                |
| iPhone Home Screen app                      | On iPhone the installed app has **its own storage and sign-in**, separate from Safari (`components/field/install-help.tsx`).                                                                                                                                                                                                                                                                                                                                            | After adding to the Home Screen: open it, **sign in again** and **download the assignment again** there. Count in one place only. Test with airplane mode. |
| Sign out with unsent counts                 | Sign out needs internet. The confirm sheet warns "You have N counts on this phone that are not sent yet. They stay on this phone and come back when <name> signs in again here. Don't clear browser data." Sign-out only removes `ims-field-user`; the database stays.                                                                                                                                                                                                  | Send first. If you must sign out, the counts come back only when **you** sign in again **on this phone**.                                                  |
| Session expired while offline               | Banner "Your sign-in has expired. Keep counting; sign in again before sending." Sending stops with a sign-in message.                                                                                                                                                                                                                                                                                                                                                   | Keep counting, then sign in when you have internet and tap Sync now.                                                                                       |
| Lost or broken phone, cleared data          | Unsent counts exist only on that phone. They can't be recovered from the server.                                                                                                                                                                                                                                                                                                                                                                                        | Send counts often (at least at every break, when there is signal). A count is safe only when it says **Received by server**.                               |
| One user per phone database                 | Each user has their own database. Counts are only ever sent by the person who made them (`wrong-user` stop). The old user's data stays on the phone.                                                                                                                                                                                                                                                                                                                    | Shared phone: each person signs in with their own account. Another person can't send your counts.                                                          |
| Clearing browser or site data, uninstalling | Deletes the IndexedDB database, including unsent counts.                                                                                                                                                                                                                                                                                                                                                                                                                | Never clear browser data or uninstall IMS while counts are not sent.                                                                                       |

---

## 8. Troubleshooting

| Symptom                                                                                  | Likely cause                                                                                                 | Fix                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Sign in once with internet" screen                                                      | This browser or installed app has never signed in (`ims-field-user` missing) and the server can't be reached | Connect, sign in, download the assignment. On iPhone do it inside the installed app.                                                                                                |
| Home: "The app itself is still getting ready for offline use"                            | Service worker not yet controlling the page, or `/field` not cached yet (`appCachedForOffline`)              | Keep the app open with internet for a minute, then reopen. On a dev build this is expected (SW off).                                                                                |
| "Development mode: the offline app is turned off"                                        | Running `npm run dev`                                                                                        | Use `npm run build` + `next start` (§6).                                                                                                                                            |
| Offline app shows the browser's error page or `offline.html` instead of `/field`         | Service worker never installed on this device, or cache cleared                                              | Open `/field` online once and wait for "Ready for offline use".                                                                                                                     |
| Header says Offline although the phone has signal                                        | The server didn't answer in time or returned 5xx (`fieldFetch`)                                              | Move to better Wi-Fi or data; check `/api/health` and the server logs.                                                                                                              |
| "Your count was NOT saved: this phone is out of storage space"                           | `QuotaExceededError`                                                                                         | Free space on the phone, then Save again.                                                                                                                                           |
| "This phone can't save counts here" at start                                             | IndexedDB blocked: private mode, storage turned off, or an unsupported browser                               | Use a normal Chrome (Android) or Safari (iPhone) window, or the installed app.                                                                                                      |
| Counts stay at "Draft on this device"                                                    | Nobody tapped **Send counts**; auto-retry never sends drafts                                                 | Open the assignment and tap Send N counts.                                                                                                                                          |
| Counts stay "Pending sync" / "Failed – retry"                                            | Offline, server down, rate limited (NGINX 429), or a server error                                            | They retry every 30 s while the app is open and online. Tap Sync now. Look at `lastError` on the Sync screen and the server logs.                                                   |
| "Sign in again to send your counts" / "You're signed out"                                | Session expired, or account deactivated (401)                                                                | Sign in again, then Sync now. If deactivated, an admin must reactivate the account, or recover the counts (below).                                                                  |
| "Someone else is signed in on this phone…"                                               | The server session belongs to another user than the owner of these counts                                    | Sign out, then sign in as the person who counted.                                                                                                                                   |
| Conflict: "… was closed by your supervisor before this count arrived" (`SESSION_CLOSED`) | Session closed before the upload                                                                             | Supervisor reopens the count, then the counter taps Send again. Or the supervisor recounts. The values are in the audit log (`count.conflict`).                                     |
| Conflict: "Your supervisor asked for a recount…" (`RECOUNT_REQUESTED`)                   | Line version went up after the count was made                                                                | Tap Sync now (to download the new line version), count the line again, Save, Send counts. If it conflicts again, the phone still had the old version: Sync now, then save it again. |
| Not accepted: "You are no longer allowed to send counts…" (`FORBIDDEN`)                  | Removed from the count, or location access removed                                                           | Restore access and tap Send again, or read the values from the audit log (`count.submit_denied`).                                                                                   |
| Not accepted: "This upload ID was already used…" (`OPERATION_REUSED`)                    | Same operation ID with different content (should not happen with the app; points to a bug or tampering)      | Tap Send again (new ID). Check the audit log (`sync.operation_reused`).                                                                                                             |
| "This count could not be read by the server…" (`VALIDATION_FAILED`)                      | Old app version sending a shape the server doesn't accept, or bad data                                       | Tap **Update now** if the banner shows; otherwise check `lib/counts/sync.ts` `opSchema` against the phone's payload.                                                                |
| Assignment missing on the phone, or "That item is not part of this count on this phone"  | Not downloaded, or the code isn't in the downloaded list for that assignment                                 | Download again (needs internet). If it's still missing, the item or asset isn't part of the count; see the count on the office app.                                                 |
| Assignment says "closed by supervisor" but it isn't                                      | Phone marks any session missing from `/counts/mine` as closed, including after access was removed            | Check the assignees and location access; after a fix, Sync now downloads it again.                                                                                                  |
| Stock movement refused: "… is being counted at …" (`COUNT_IN_PROGRESS`)                  | Count freeze on an open session                                                                              | Close the count, or a supervisor records an exception with a reason.                                                                                                                |
| "New version ready" banner                                                               | A new deploy is waiting                                                                                      | Finish counting, then tap Update now. Counts are kept.                                                                                                                              |

**Recovering a field user's unsent counts from a phone:** the counts are in the IndexedDB database `ims-field-<userId>` (tables `countDrafts`, `outbox`). On Android, Chrome remote debugging (`chrome://inspect`) shows them under Application → IndexedDB. Never clear site data before reading them.

---

## 9. How this is tested

Commands (`package.json`): `npm run test:unit` and `npm run test:integration` (needs `TEST_DATABASE_URL`, see `tests/integration/global-setup.ts`). Unit tests run Dexie on `fake-indexeddb`.

| File                                     | Covers                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/field-store.test.ts`         | Bootstrap saved into Dexie; re-download keeps counts; offline scan lookup (SKU, label QR, tag, barcode); recount replaces (A12); asset found/condition rules; input validation; 120 counts survive close and reopen (A13, A14); storage-full save fails loudly (A30); storage error classification                                        |
| `tests/unit/field-outbox.test.ts`        | Send counts freezes once (double tap safe); an edit makes a new operation; only ACKED counts as received (A15); lost response retried with the same IDs (A16); leftover `SENDING` re-sent; queue kept when the site is down; `RETRYABLE_ERROR` stays queued; no send under another account or when signed out; 50 per request; Send again |
| `tests/unit/field-refresh.test.ts`       | Refresh re-downloads open assignments and marks missing ones closed, keeping counts; nothing changes when unreachable                                                                                                                                                                                                                     |
| `tests/unit/field-borrow.test.ts`        | Borrow drafts: Idempotency-Key reuse, refusal kept, no double send                                                                                                                                                                                                                                                                        |
| `tests/unit/scan-formats.test.ts`        | Scanner decodes IMS QR, Code 128, EAN-13, UPC-A (A11)                                                                                                                                                                                                                                                                                     |
| `tests/integration/sync.test.ts`         | `/sync/push`: ACK + audit; same op twice (A16, also at the same moment); same ID with changed content (A17); supersede; close during uploads; two people, two observations (A18); closed session conflict (A19); recount conflict; permission loss and removal (A28); deactivated account; each operation stands alone; 50 limit          |
| `tests/integration/counts.test.ts`       | My assignments and bootstrap: only my open sessions, safe fields only, closed/unassigned refused, access loss                                                                                                                                                                                                                             |
| `tests/integration/api-counts.test.ts`   | HTTP level: download not cacheable, push from the assigned user, cross-site requests refused                                                                                                                                                                                                                                              |
| `tests/integration/count-freeze.test.ts` | Count freeze on issue, receive and transfer; exceptions with a reason                                                                                                                                                                                                                                                                     |

**Not automated:** the service worker (precache, offline navigation, update banner) and real phones. These were checked by hand in a production build. The real-phone tests (Phase 3 airplane mode on iPhone and Android; Phase 4 two-phone conflict) are still open in the project tracker.

---

## Differences from the spec

Spec `IMS_MVP.md` §10–§11 compared with the code:

- **Dexie tables** (§10.3): no `items` or `assets` tables. A `targets` table (one row per line, stock or asset) and `identifiers` keyed `[sessionId+code]` replace them. `borrowDrafts` was added. `inboxConflicts` exists but is unused: conflicts are kept on the outbox row. `syncMeta` has no cursor and no storage warning; `schemaVersion` is always `1`.
- **Outbox states** (§11.2): `REJECTED` was added next to the spec's five, so "no permission / invalid" shows differently from "closed / recount". The `DRAFT` state is computed, not stored.
- **Outbox rows are never removed** (§11.1 rule 10 allows removal after ACK). ACKED rows and drafts stay on the phone for good, and other users' databases are kept, not cleared (§10.5 "separate or securely clear").
- **Push payload**: no `targetType`; the server takes the kind from the line.
- **Order of checks** (§11.4): the stored outcome is looked up **before** the assignment and permission check (the spec lists validation of the assignment first). An unassigned target or lost permission is `REJECTED FORBIDDEN`, not a conflict (§11.4 step 6 groups "no longer assigned" with conflicts).
- **Locking**: a per-operation advisory lock, plus `FOR SHARE` on the session and `FOR UPDATE` on the line.
- **Pull** (§11.3): there is no `GET /api/v1/sync/changes`. The MVP option is used: after a send, re-fetch `/counts/mine` and bootstrap each open assignment again.
- **Permissions**: download and list need `counts.perform`; push needs `counts.submit` (the same roles today, `lib/permissions/index.ts`).
- **Scanner**: the `barcode-detector` ponyfill (ZXing WASM) is used instead of `@zxing/browser` (tracker decision, 2026-10-28).
