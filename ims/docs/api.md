# IMS API reference

Written from the code in `app/api/**/route.ts` and `lib/**`. Where the original spec (`IMS_MVP.md` §12) differs, the code is documented and the difference is noted with **Spec:**.

## 1. Basics

| Topic      | Rule (as implemented)                                                                                                                                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base path  | `/api/v1` (health check is `/api/health`).                                                                                                                                                                                                                                               |
| Format     | JSON in, JSON out (`Response.json`). Exceptions: CSV and Excel exports, PDFs, and images.                                                                                                                                                                                                |
| Body size  | JSON bodies over 1,000,000 bytes (4,000,000 for `POST /items/import`) → `413` with code `VALIDATION_FAILED`. Empty body is read as `{}`. Bad JSON → `400 INVALID_JSON`. NGINX also caps bodies at 8 MB.                                                                                  |
| Timestamps | Stored as `timestamptz`; returned as ISO 8601 UTC strings (`2026-10-30T02:15:00.000Z`). Date inputs (`dueAt`, `clientRecordedAt`) must be ISO 8601 date-times **with an offset** (`Z` or `+08:00`). Report CSVs are the exception: dates are display text in company time (Asia/Manila). |
| IDs        | UUIDs. A path `:id` that is not a UUID → `404 NOT_FOUND` (checked before the database).                                                                                                                                                                                                  |
| Request id | Send `X-Request-Id` (first 64 chars kept) or the server makes a UUID. Every wrapped response echoes it in `x-request-id` and in error bodies as `requestId`. NGINX sets it to `$request_id` in production.                                                                               |
| Caching    | Every wrapped response has `cache-control: no-store`.                                                                                                                                                                                                                                    |
| Pagination | `?page=N` (1–10,000, default 1). Page size is fixed at **50**, except `GET /items` which takes `?pageSize=` (1–1,000, default 50). Paged lists return `{ rows, total, page, pageCount }`. Unpaged lists return `{ data: [...] }`.                                                        |

### Authentication

- Session cookie: `ims_session` (HTTP-only, `SameSite=Lax`, path `/`). When `AUTH_URL` starts with `https://` the name is `__Host-ims_session` and the cookie is `Secure`.
- The cookie holds an opaque random token; its SHA-256 is stored in the `sessions` table. Lifetime 12 hours, sliding (extended at most every 5 minutes while used). Sign-out, deactivation, role change, location change and password reset end sessions at once.
- Every `/api/v1` route except auth requires a session. No session, an expired one, or an inactive account → `401 UNAUTHENTICATED`.
- Sign-in is Auth.js (next-auth 5 beta) with the Credentials provider, mounted at `/api/v1/auth/*` (see §4). The IMS login page signs in through a server action (`app/(auth)/login/actions.ts` → `signIn("credentials", { email, password })`), not through a direct API call.
- Login lock: 5 wrong passwords for one email within 15 minutes locks that email for 15 minutes (`lib/auth/credentials.ts`). NGINX also limits `/login` and `/api/v1/auth/callback/credentials` to 30 requests/minute per IP.

### Same-origin (CSRF) rule

Applied by `route()` (`lib/api/route.ts`) to every method except `GET`, `HEAD`, `OPTIONS`, **before** the session check:

- If an `Origin` header is sent, its host must equal the request host (`X-Forwarded-Host`, else `Host`, else the URL host; first value, lower-cased). Otherwise → `403 BAD_ORIGIN`.
- If `Sec-Fetch-Site: cross-site` is sent → `403 BAD_ORIGIN` (even with no `Origin`).
- A request with neither header (e.g. curl, server-to-server) passes this check; it still needs the session cookie.
- `/api/v1/auth/*` and `/api/health` are not wrapped by `route()`; Auth.js uses its own CSRF token (see §4).

Every `403` from a wrapped route is written to the audit log as `auth.forbidden`.

### Permissions

Each service calls `requireAccess(user, action, locationId?)` (`lib/permissions/index.ts`). Writes need `FULL` access at the location; reads also accept `VIEW_ONLY`. A user's locations include child locations of the ones they are assigned.

| Action               | ADMIN | SUPERVISOR | FIELD                                               |
| -------------------- | ----- | ---------- | --------------------------------------------------- |
| `settings.manage`    | all   | –          | –                                                   |
| `masterData.manage`  | all   | assigned   | –                                                   |
| `locations.manage`   | all   | assigned   | –                                                   |
| `locations.view`     | all   | assigned   | assigned                                            |
| `records.view`       | all   | assigned   | assigned                                            |
| `counts.create`      | all   | assigned   | –                                                   |
| `counts.perform`     | all   | assigned   | assigned                                            |
| `counts.submit`      | all   | assigned   | assigned                                            |
| `counts.approve`     | all   | assigned   | –                                                   |
| `stock.move`         | all   | assigned   | –                                                   |
| `drafts.prepare`     | all   | assigned   | assigned                                            |
| `custody.confirm`    | all   | assigned   | –                                                   |
| `documents.download` | all   | assigned   | own                                                 |
| `reports.view`       | all   | assigned   | own (but every report route refuses FIELD, see §14) |

"assigned" with no location given = the user needs at least one usable location, and lists are filtered to those locations. Records outside the user's locations return `404`, not `403`, so hidden records stay hidden.

## 2. Errors

Every error from a wrapped route has this shape (`lib/api/errors.ts`):

```json
{
  "code": "INSUFFICIENT_STOCK",
  "message": "Only 3 pcs of Nitrile gloves left at WH-A (you asked for 5). Lower the quantity or pick another location.",
  "requestId": "6f0c…",
  "fields": { "lines.0.quantity": ["Enter more than 0."] }
}
```

`fields` is present only for field-level validation (key = field path, `_` for the whole body). Messages are plain text for the user; no stack traces.

| Code                       | HTTP                         | Meaning                                                                                                                                                  |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`          | 401                          | Signed out, session expired, or account inactive.                                                                                                        |
| `ACCOUNT_INACTIVE`         | 401                          | Account deactivated. Thrown by `requireAccess`; in practice an inactive user's session already resolves to nobody, so the API returns `UNAUTHENTICATED`. |
| `FORBIDDEN`                | 403                          | Role or location does not allow this action.                                                                                                             |
| `BAD_ORIGIN`               | 403                          | State-changing request from another site (see CSRF rule).                                                                                                |
| `NOT_FOUND`                | 404                          | Record missing, not visible to this user, or path id not a UUID.                                                                                         |
| `VALIDATION_FAILED`        | 422 (413 for too-large body) | Input failed validation or a business input rule.                                                                                                        |
| `INVALID_JSON`             | 400                          | Body is not valid JSON.                                                                                                                                  |
| `CONFLICT`                 | 409                          | State conflict: stale version, wrong status, already decided, inactive record, etc.                                                                      |
| `INSUFFICIENT_STOCK`       | 409                          | Issue, transfer or loan release would take a balance below zero.                                                                                         |
| `COUNT_IN_PROGRESS`        | 409                          | Stock being counted (open count) at that location. Stock moves can send `countException` to override; loan releases and returns can't.                   |
| `DUPLICATE`                | 409                          | Unique value already used (also any Prisma `P2002`).                                                                                                     |
| `IDEMPOTENCY_KEY_REQUIRED` | 400                          | Missing or non-UUID `Idempotency-Key` header.                                                                                                            |
| `IDEMPOTENCY_KEY_REUSED`   | 422                          | Same key already used for a different request.                                                                                                           |
| `RATE_LIMITED`             | 429                          | Defined but not thrown by app code. 429s come from NGINX (`limit_req_status 429`) with NGINX's own body, not this JSON shape.                            |
| `INTERNAL`                 | 500                          | Unexpected server error (logged with the request id).                                                                                                    |

**Spec:** §12.3 lists `503` for "unavailable"; only `/api/health` returns 503.

## 3. Idempotency

Endpoints that **require** an `Idempotency-Key: <UUID>` header (else `400 IDEMPOTENCY_KEY_REQUIRED`):

| Endpoint                                 | Stored scope                        | Payload hashed                            |
| ---------------------------------------- | ----------------------------------- | ----------------------------------------- |
| `POST /stock/receipts`                   | `POST /api/v1/stock/receipts`       | validated body                            |
| `POST /stock/issues`                     | `POST /api/v1/stock/issues`         | validated body                            |
| `POST /stock/transfers`                  | `POST /api/v1/stock/transfers`      | validated body                            |
| `POST /borrowings` (draft)               | `POST /api/v1/borrowings`           | validated body                            |
| `POST /borrowings/release`               | `POST /api/v1/borrowings/release`   | validated body                            |
| `POST /borrowings/:id/return`            | `POST /api/v1/borrowings/return`    | `{ borrowingId, ...validated body }`      |
| `POST /counts/:id/lines/:lineId/approve` | `POST /api/v1/counts/lines/approve` | `{ sessionId, targetId, entryId, notes }` |

Rules (`lib/idempotency/index.ts`):

- Keys are per user: `(userId, key)`. Concurrent requests with the same key are serialized (advisory lock).
- Same key + same scope + same payload → the stored status and body are returned; nothing runs again. Endpoints that use `idempotentJson` add header `idempotent-replay: true` (all above except `POST /borrowings`, which always answers `201 { id }`).
- Same key + different payload or scope → `422 IDEMPOTENCY_KEY_REUSED`; nothing runs.
- If the work throws, the transaction rolls back and no key is stored, so a retry with the same key runs again.
- Body validation and (except approve-line) the permission check run before the key is looked up, on every call, including replays.
- The hash is over the **parsed** body (after trimming, defaults, upper-casing), so cosmetic differences (e.g. trailing spaces) count as the same request.

`POST /sync/push` does not use the header. It is idempotent per operation (`operationId`); see §11. `POST /borrowings/:id/close` and `/cancel` don't take a key: a second call finds the loan no longer OPEN / DRAFT and answers `409`.

**Spec:** §12.4 asks for keys on "online stock and release/return confirmations as well as offline submissions". Code also requires one for borrowing drafts and count line approvals.

## 4. Auth (`/api/v1/auth/[...nextauth]`)

`GET` and `POST` are the Auth.js handlers (`lib/auth/auth.ts`, `basePath: "/api/v1/auth"`). The sub-paths are Auth.js's own, not IMS code. The ones a client needs:

| Method + path                            | Purpose                                                                                                                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/auth/csrf`                  | Returns `{ csrfToken }` and sets Auth.js's CSRF cookie.                                                                                                                                                               |
| `POST /api/v1/auth/callback/credentials` | Form fields `email`, `password`, `csrfToken`. On success sets the session cookie and redirects. Failure codes (in the redirect to `/login?error=…&code=…`): `invalid_login`, `too_many_attempts`, `account_inactive`. |
| `GET /api/v1/auth/session`               | Current Auth.js session (`user.id`, `expires`) or empty.                                                                                                                                                              |
| `POST /api/v1/auth/signout`              | Form field `csrfToken`. Deletes the session row and clears the cookie.                                                                                                                                                |

Pages: sign-in and error both point to `/login`. For any other Auth.js sub-path see Auth.js docs and `lib/auth/auth.ts`.

**Spec:** §12.1 lists `POST /auth/login` and `POST /auth/logout`. Code uses the Auth.js paths above.

## 5. Me

### `GET /me`

- Who: any signed-in user.
- 200:

```json
{
  "id": "…",
  "name": "Ana Cruz",
  "email": "ana@company.com",
  "role": "SUPERVISOR",
  "locations": [
    {
      "id": "…",
      "code": "WH-A",
      "name": "Main warehouse",
      "type": "WAREHOUSE",
      "parentId": null,
      "isActive": true,
      "access": "FULL"
    }
  ],
  "permissions": { "settings.manage": false, "stock.move": true, "…": true }
}
```

- `locations` is the string `"ALL"` for ADMIN. `permissions` has every action from §1, evaluated without a location.

## 6. Users (ADMIN only: `settings.manage`)

Public user fields: `id, name, email, role, status, lastLoginAt, createdAt, updatedAt, locations[{ access, location{ id, code, name } }]`. Never the password hash.

### `GET /users`

- 200 `{ data: User[] }` sorted by status, then name.

### `POST /users`

| Field       | Type                                             | Rule                                                                |
| ----------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| `name`      | string                                           | required, trimmed, 1–120                                            |
| `email`     | string                                           | required, trimmed, lower-cased, valid email, ≤254                   |
| `password`  | string                                           | required, 10–200                                                    |
| `role`      | `ADMIN` \| `SUPERVISOR` \| `FIELD`               | required                                                            |
| `locations` | `[{ id: uuid, access?: "FULL" \| "VIEW_ONLY" }]` | optional, default `[]`, ≤200, each id once; `access` default `FULL` |

- 201: User. Errors: `422` unknown location; `409 DUPLICATE` email in use.

### `GET /users/:id`

- 200: User. `404` if missing.

### `PATCH /users/:id`

| Field       | Type                   | Rule                                           |
| ----------- | ---------------------- | ---------------------------------------------- |
| `name`      | string                 | optional, 1–120                                |
| `role`      | role enum              | optional                                       |
| `status`    | `ACTIVE` \| `INACTIVE` | optional (deactivate; users are never deleted) |
| `locations` | as in POST             | optional; replaces all assignments             |

- At least one field, else `422` "Nothing to change."
- 200: User. A change to role, status or locations ends that user's sessions.
- Errors: `409 CONFLICT` deactivating yourself or removing your own ADMIN role; `422` unknown location; `404`.

### `POST /users/:id/password-reset`

- No body. Makes a one-time reset link valid 1 hour; older unused links stop working.
- 201 `{ url: "/reset-password?token=…", expiresAt }`. The token is shown once and only its hash is stored.
- Completing the reset (`/reset-password` page) is a server action, not an API route.

## 7. Locations

Location fields: `id, code, name, type, parentId, isActive, createdAt, updatedAt, parent{ id, code, name }, _count{ users, children }`.

### `GET /locations`

- Who: `locations.view` (list filtered to the user's locations; ADMIN sees all).
- Query: `includeInactive=true` to include inactive ones.
- 200 `{ data: Location[] }` sorted by code.

### `POST /locations`

| Field      | Type                            | Rule                                                           |
| ---------- | ------------------------------- | -------------------------------------------------------------- |
| `code`     | string                          | required, trimmed, upper-cased, 1–40, `^[A-Z0-9][A-Z0-9._-]*$` |
| `name`     | string                          | required, 1–120                                                |
| `type`     | `WAREHOUSE` \| `SITE` \| `AREA` | required                                                       |
| `parentId` | uuid \| null                    | optional                                                       |

- Who: with `parentId`: `locations.manage` at the parent. Without: ADMIN only (`403` otherwise).
- 201: Location. Errors: `404` parent missing; `409` parent inactive; `409 DUPLICATE` code.

### `GET /locations/:id`

- Who: `locations.view` at that location; outside scope → `404`.
- 200: Location.

### `PATCH /locations/:id`

| Field      | Type      | Rule            |
| ---------- | --------- | --------------- |
| `name`     | string    | optional, 1–120 |
| `type`     | type enum | optional        |
| `isActive` | boolean   | optional        |

- Who: `locations.manage` at that location. At least one field.
- 200: Location. Errors: `409` deactivating a location that still has active children; `404`.

## 8. Categories and units

### `GET /categories` · `GET /units`

- Who: `records.view`.
- 200 `{ data: [...] }` — each row is the full record plus `_count.items`. Categories sorted by name, units by code.

### `POST /categories`

- Who: `masterData.manage`.
- Body: `name` string, required, 1–80.
- 201: category. `409 DUPLICATE` if the name exists (case-insensitive).

### `POST /units`

- Who: `masterData.manage`.
- Body: `code` string, required, trimmed, lower-cased, 1–20, `^[a-z0-9][a-z0-9._-]*$`; `name` string, required, 1–60.
- 201: unit. `409 DUPLICATE` if the code exists.

### `PATCH /categories/{id}` · `PATCH /units/{id}`

- Who: `masterData.manage`.
- Body: same as the matching `POST` (category: `name`; unit: `code` and `name`). A rename: items keep pointing at the record, and quantities are not converted.
- 200: the updated record. `409 DUPLICATE` if another category has the name or another unit has the code; `404` if the id doesn't exist. Audited as `category.updated` / `unit.updated` with before and after.

## 9. Items, import, export, lookup

Items are company-wide master data; balances are per location and filtered to the user's locations.

### `GET /items`

- Who: `records.view`.
- Query:

| Param              | Rule                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `q`                | up to 100 chars; SKU or name contains (case-insensitive), or exact active identifier (barcode) |
| `categoryId`       | UUID; a malformed value is ignored                                                             |
| `stock`            | `low` \| `out`                                                                                 |
| `page`, `pageSize` | see §1 (`pageSize` 1–1,000, default 50)                                                        |

- 200 `{ rows, total, page, pageCount }`. Row: `id, sku, name, description, minStock, isActive, photoPath, categoryId, categoryName, unitId, unitCode, onHand, onLoan, stockStatus ("OK" | "LOW" | "OUT")`. Only active items. `onHand` is the stock over the user's locations; `onLoan` is what is still out on open loans from those locations (already taken off `onHand`).

### `POST /items`

| Field            | Type         | Rule                                                                              |
| ---------------- | ------------ | --------------------------------------------------------------------------------- |
| `sku`            | string       | required, trimmed, upper-cased, 1–40, `^[A-Z0-9][A-Z0-9._\-/]*$`                  |
| `name`           | string       | required, 1–160                                                                   |
| `description`    | string       | optional, ≤1000                                                                   |
| `categoryId`     | uuid \| null | optional                                                                          |
| `unitId`         | uuid         | required; must be an active unit                                                  |
| `minStock`       | int          | optional, 0–1,000,000, default 0                                                  |
| `brand`, `model` | string       | optional, ≤80                                                                     |
| `barcode`        | string       | optional, ≤100; normalized (upper-case, no spaces); stored as an `MFR` identifier |

- Who: `masterData.manage`.
- 201: item record. Errors: `422` inactive unit; `409 DUPLICATE` SKU, or barcode already used as an identifier or a SKU.

### `GET /items/:id`

- Who: `records.view`.
- 200: item with `category`, `unit`, `identifiers`, `balances[{ quantity, location }]`, `movements` (latest 50, with `transaction`; loans show as `BORROW` / `RETURN` moves), `loans[{ id, reference, borrowerName, dueAt, out }]` (open loans from the user's locations that still have some of it out), `onLoan` (sum of `out`), `onHand`, `stockStatus`, `canManage`. `404` if missing.

### `PATCH /items/:id`

- Who: `masterData.manage`.
- Body (all optional): `name`, `description` (`""` clears it), `categoryId`, `unitId`, `minStock`, `brand`, `model` (same rules as POST), `isActive` boolean. `sku` and `barcode` cannot be changed.
- Fields left out are not changed (including `minStock`; fixed 30 Oct 2026).
- 200: item record. `404` if missing.

### `GET /items/:id/photo` · `PUT /items/:id/photo` · `DELETE /items/:id/photo`

- Who: GET `records.view`; PUT and DELETE `masterData.manage`.
- PUT body: the raw image (not JSON), JPEG, PNG or WebP, up to 2 MB. The type is checked from the file's first bytes, not the name or `Content-Type`; anything else → `422 VALIDATION_FAILED`. The office app shrinks photos to 1280 px JPEG before sending. Replaces any earlier photo (the old file is deleted). 200: `{ photoPath }`.
- GET: the image with its `content-type`. `404` when the item has no photo.
- DELETE: 200 `{ ok: true }` (also when there was no photo).
- Files live in the private documents folder under `item-photos/`, so they are in the same backups as the PDFs. Audit event `item.photo_changed`.

### `GET /settings/logo` · `PUT /settings/logo` · `DELETE /settings/logo`

- The company logo printed at the top of every new form, next to `COMPANY_NAME`. GET: anyone who can view records (`404` when there is none). PUT/DELETE: `settings.manage`.
- PUT body: the raw image, PNG or JPEG, up to 1 MB (type checked from the first bytes, and test-embedded in a PDF; anything unusable → `422`). The office app sends a 600 px PNG. 200 `{ ok: true }`.
- Stored as `branding/logo.png|jpg` in the private documents folder (so it is backed up). Read when a PDF is drawn: stored forms keep the logo they were made with. Audit event `company.logo_changed`.
- The item's `photoPath` is on `GET /items/:id` and on each `GET /items` row.

### `POST /items/bulk-delete` · `/counts/bulk-delete` · `/locations/bulk-delete` · `/users/bulk-delete`

- Who: the same permission as editing that record (`masterData.manage`, `counts.create`, `locations.manage`, `settings.manage`).
- Body: `{ ids: uuid[] }`, 1 to 200. 200: `{ deleted: string[], hidden: string[], skipped: { label, reason }[] }` (labels are SKU, count reference, code or email).
- A record nothing points at is deleted (items with their extra barcodes and photo file; users with their location assignments and reset links). A record with history (stock moves, loans, counts, forms) can't be (the database's Restrict links refuse), so it is **hidden** instead: items and locations deactivated, users set inactive. Counts: one with no counts sent and no decisions is deleted with its lines and counters; an open one with them is **cancelled** (`hidden`; status `CANCELLED`, audited `count.cancelled`, location unfrozen; `GET /counts` leaves cancelled counts out); a closed one is skipped. Your own account is skipped with the reason. Each delete is audited as `<type>.deleted`.

### `GET /items/import` · `POST /items/import`

- Who: `masterData.manage`.
- `GET`: the Excel import template, `attachment; filename="ims-items-template.xlsx"` (the seven columns and two example rows).
- `POST` body: `{ csv: string, mode?: "preview" | "commit" }`, or `multipart/form-data` with `file` (`.xlsx` or `.csv`, ≤2 MB) and `mode`. Anything but `"commit"` is a preview (writes nothing).
- Columns: `sku, name, unit` required; `category, min_stock, description, barcode` optional. An `.xlsx` must use only these names, each once (no quantity columns). Max 2,000 data rows. Units and categories are matched by code/name (case-insensitive) and must exist. Max 2 MB of CSV (larger → `422` "The file is larger than 2 MB"); the JSON form accepts a larger body (2 × 2 MB) so a full-size CSV fits after JSON escaping. Import never sets quantities: receive stock afterwards.
- Preview 200 `{ rows: [{ line, ok, errors[], data }], validCount, errorCount }`.
- Commit 201 `{ imported, skipped }` — re-validates, creates all valid rows in one transaction, skips invalid rows.
- Errors: `422` missing `csv` / wrong file type, bad header, too many rows, no valid rows on commit.

### `GET /items/export`

- Who: `masterData.manage`.
- `?format=xlsx`: the same rows as a formatted Excel file (bold frozen header, sized columns), `attachment; filename="ims-items-YYYY-MM-DD.xlsx"`. Otherwise CSV:
- 200 `text/csv` (UTF-8 BOM), `attachment; filename="ims-items-YYYY-MM-DD.csv"`. Columns: `sku, name, category, unit, min_stock, description, barcode, on_hand, active`. Includes inactive items. `on_hand` is stock on hand over the user's locations (what is out on loan is not in it). Cells are formula-safe.

### `GET /lookup?code=…`

- Who: `records.view`.
- `code` (≤200 chars): an IMS label payload `ims:item|location:<uuid>`, SKU, location code, or an alternate identifier (UPC-A / EAN-13 variants match).
- 200 `{ type: "item" | "location", id, label, href }`. `href` is the UI page to open (`/stock/items/<id>` or `/locations?q=<code>`).
- `404` if nothing matches or the location is outside the user's locations. Items are company-wide, so any item matches.

## 10. Stock

All three confirms: one DB transaction with row locks, a reference `RCV-|ISS-|TRN-YYYY-NNNNNN`, signed ledger lines, an audit event. Balances never go below zero. Lines: 1–100, each `itemId` once, `quantity` whole number 1–1,000,000, items and locations active.

Loans move stock too: a release posts a `BORROW` move (reference = the loan's `BOR-` number, quantities out) and a return posts a `RETURN` move (reference = the `RET-` number, quantities back in). They are made only by the borrowing endpoints (§12), not here, and show in an item's `movements` and in the `movements` report.

`countException` (optional) = `{ reason: string 3–300 }`. Without it, a line whose item is in an OPEN count at that location → `409 COUNT_IN_PROGRESS`. With it, the user also needs `counts.approve` at that location, and the move is audited as `count.exception`.

Success for all three: **201**:

```
{ id, reference, type: "RECEIPT"|"ISSUE"|"TRANSFER", status: "CONFIRMED", confirmedAt,
  lines: [{ itemId, sku, name, unit, locationId, quantity, before, after }],
  documentId? }
```

### `POST /stock/receipts` — Idempotency-Key required

| Field            | Type                     | Rule            |
| ---------------- | ------------------------ | --------------- |
| `locationId`     | uuid                     | required        |
| `lines`          | `[{ itemId, quantity }]` | required        |
| `source`         | string                   | optional, ≤160  |
| `externalRef`    | string                   | optional, ≤80   |
| `notes`          | string                   | optional, ≤1000 |
| `countException` | object                   | optional        |

- Who: `stock.move` at `locationId`. No document for receipts.

### `POST /stock/issues` — Idempotency-Key required

| Field            | Type                     | Rule            |
| ---------------- | ------------------------ | --------------- |
| `locationId`     | uuid                     | required        |
| `lines`          | `[{ itemId, quantity }]` | required        |
| `recipientName`  | string                   | required, 1–120 |
| `purpose`        | string                   | required, 1–300 |
| `notes`          | string                   | optional, ≤1000 |
| `countException` | object                   | optional        |

- Who: `stock.move` at `locationId`.
- Creates a `STOCK_ISSUANCE` document (`documentId`); the PDF is drawn after commit, and a drawing failure never undoes the issue.
- Errors: `409 INSUFFICIENT_STOCK` (all lines checked before anything is written), `409 COUNT_IN_PROGRESS`, `409` inactive item/location, `404` unknown item/location.

Example:

```http
POST /api/v1/stock/issues
Idempotency-Key: 2bc037d1-b3ed-4e3d-9b76-c1c371e6fd09
Content-Type: application/json

{
  "locationId": "0b6c…-location",
  "recipientName": "Juan Dela Cruz",
  "purpose": "Site repair",
  "lines": [{ "itemId": "9f1e…-item", "quantity": 5 }],
  "notes": "Work order 103"
}
```

```json
201
{
  "id": "c4d2…-txn",
  "reference": "ISS-2026-000123",
  "type": "ISSUE",
  "status": "CONFIRMED",
  "confirmedAt": "2026-10-30T02:15:00.000Z",
  "lines": [{ "itemId": "9f1e…-item", "sku": "PPE-0001", "name": "Nitrile gloves", "unit": "box",
              "locationId": "0b6c…-location", "quantity": 5, "before": 20, "after": 15 }],
  "documentId": "a7b3…-doc"
}
```

**Spec:** §12.2 shows `documentStatus: "PENDING_GENERATION"` in the response. Code returns `documentId`; read the PDF state with `GET /documents/:id`.

### `POST /stock/transfers` — Idempotency-Key required

| Field            | Type                     | Rule                                      |
| ---------------- | ------------------------ | ----------------------------------------- |
| `fromLocationId` | uuid                     | required                                  |
| `toLocationId`   | uuid                     | required, different from `fromLocationId` |
| `lines`          | `[{ itemId, quantity }]` | required                                  |
| `reason`         | string                   | optional, ≤300                            |
| `notes`          | string                   | optional, ≤1000                           |
| `countException` | object                   | optional (checked at both locations)      |

- Who: `stock.move` at both locations.
- `lines` in the response has two entries per item: the `from` line, then the `to` line.
- Creates a `TRANSMITTAL` document (`documentId`).

### `GET /stock/balances?locationId=…&itemIds=a,b`

- Who: `records.view` at `locationId`.
- `locationId` must be a UUID (`422` otherwise). Non-UUID ids in `itemIds` are dropped; at most 200 are looked up.
- 200 `{ "<itemId>": quantity, … }` (0 when no balance row).

### `GET /stock/xlsx`

- Who: `masterData.manage`.
- Query (same as the Stock page; invalid values ignored): `q` (≤100), `category` (uuid), `stock` (`low` | `out`).
- 200 Excel file `attachment; filename="ims-stock-YYYY-MM-DD.xlsx"`, one row per item over the user's locations: SKU, Item, Category, Unit, On hand, On loan, Low at, Status. Up to 50,000 rows; headers `x-export-total` and `x-export-truncated` say if rows were cut. Audited as `report.exported` (`recordId: "stock"`).

**Spec:** `GET /stock/movements` does not exist. Use the `movements` report (§14).

## 11. Counts and offline sync

**Spec:** §12.1 names these `/count-sessions/...` with `submit`, `recount`, `reconcile`. Code uses `/counts/...`; counts are submitted only through `/sync/push`; review is split into per-line `approve`, `keep`, `recount` plus `approve-matching`. There is no `GET /counts/:id` (use `/counts/:id/review`).

### `GET /counts`

- Who: `records.view` (filtered to the user's locations; FIELD users see only counts they are assigned to).
- Query: `status=OPEN|CLOSED`, `page`.
- 200 `{ rows, total, page, pageCount }`. Row: `id, reference, name, status, dueAt, createdAt, location, assignees[{ user{ name } }], _count{ targets, entries }, progress{ counted, done }`.

### `POST /counts`

| Field         | Type                              | Rule                                                                                |
| ------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `name`        | string                            | required, 1–120                                                                     |
| `locationId`  | uuid                              | required; active                                                                    |
| `assigneeIds` | uuid[]                            | optional, ≤50, default `[]`; each must be active and allowed `counts.perform` there |
| `categoryIds` | uuid[]                            | optional, ≤100; empty = everything                                                  |
| `dueAt`       | ISO date-time with offset \| null | optional                                                                            |
| `notes`       | string                            | optional, ≤1000                                                                     |

- Who: `counts.create` at `locationId`.
- Snapshots the expected quantity of every active item that has a balance at the location (in the chosen categories). Counts are quantities only. What is out on loan is not on the shelf and not in the balance, so it isn't expected. Reference `CNT-YYYY-NNNNNN`.
- 201: count session record. Errors: `422` bad assignee or nothing to count ("Receive stock there first"); `404` / `409` location.

### `GET /counts/mine`

- Who: any active user.
- 200 `{ data: [{ id, reference, name, dueAt, version, location{ id, code, name }, targetCount }] }` — OPEN sessions assigned to the user where they still have `counts.perform`.

### `POST /counts/:id/close`

- Who: `records.view` (else `404`) and `counts.create` at the session's location. No body.
- 200: count session record (`status: "CLOSED"`, `closedAt`). `409` if not OPEN.

### `POST /counts/:id/reopen`

- Who: as close. No body.
- 200: count session record (`status: "OPEN"`). `409` if not CLOSED.

### `POST /counts/:id/assignees`

- Who: `counts.create` at the count's location. Body `{ assigneeIds: uuid[] }` (max 50) replaces who counts; the count must be OPEN (`409` otherwise).
- New people must be active and able to count at the location (`422` otherwise). People taken off can't send more counts for it; their sent counts stay. Audit event `count.assignees_changed`. 200 `{ assigneeIds }`.

### `GET /counts/:id/review`

- Who: `records.view` (else `404`) and `counts.approve` at the session's location. `409` if the session is CANCELLED.
- 200 `{ session, lines, counters, summary }`:
  - `lines[]`: `targetId, version, sku, name, unit, expected, entries[], priorEvidence?, counted, variance, matches, movedDuringCount, recountRequested, state, review`.
  - `state`: `DONE` | `RECOUNT` | `NOT_COUNTED` | `MOVED` | `DISAGREE` | `READY`.
  - `counters[]`: `{ id, name, counted }`.
  - `summary`: `lines, counted, withDifference, readyMatching, done, ready, moved, disagree, notCounted`.
  - Full types: `lib/counts/review.ts`.

### `POST /counts/:id/approve-matching`

- Who: `counts.approve`. No body. Works on OPEN or CLOSED sessions.
- Approves every READY line whose count matches the records exactly; posts no adjustment.
- 200 `{ approved: number }`.

### `POST /counts/:id/lines/:lineId/approve` — Idempotency-Key required

| Field     | Type   | Rule                                                |
| --------- | ------ | --------------------------------------------------- |
| `entryId` | uuid   | optional; which count to use when counters disagree |
| `notes`   | string | optional, ≤500                                      |

- Who: `counts.approve` at the session's location (checked inside the idempotent transaction).
- Posts ONE `ADJ-YYYY-NNNNNN` adjustment for (counted − current balance); zero difference posts nothing.
- 200 `{ reviewId, targetId, decision: "APPROVED", counted, variance, adjustment: { id, reference } | null }`.
- Errors: `422` body invalid (no field list) or nobody counted yet; `409` already decided, stock moved during the count, counters disagree, chosen entry replaced; `404` line.

Example:

```http
POST /api/v1/counts/5e2a…-session/lines/77c1…-line/approve
Idempotency-Key: 0d9b8f4e-6a52-4a8e-9a43-1c2f0f3e7b10
Content-Type: application/json

{ "notes": "Recounted shelf B, 2 boxes damaged and written off" }
```

```json
200
{
  "reviewId": "e01f…",
  "targetId": "77c1…-line",
  "decision": "APPROVED",
  "counted": 18,
  "variance": -2,
  "adjustment": { "id": "3b9d…-txn", "reference": "ADJ-2026-000017" }
}
```

### `POST /counts/:id/lines/:lineId/keep`

- Who: `counts.approve`. Body `{ notes?: string }` (cut to 500 chars).
- Closes the line as "keep expected"; nothing changes.
- 200: count review record (`decision: "KEPT_EXPECTED"`). `409` already decided; `404` line.

### `POST /counts/:id/lines/:lineId/recount`

- Who: `counts.approve`. No body. Session must be OPEN (`409` otherwise).
- New expected snapshot, line version + 1, session version + 1, current counts superseded.
- 200 `{ targetId }`. `409` already decided.

### `GET /sync/bootstrap?sessionId=…`

- Who: `records.view`, assigned to the session, and `counts.perform` at its location (else `404`). `422` if `sessionId` is not a UUID; `409` if the session is not OPEN.
- 200 `{ session, targets, identifiers, serverTime }`:
  - `session`: `id, reference, name, status, dueAt, version, notes, location`.
  - `targets[]`: `{ id, version, item{ id, sku, name, unit } }`. No expected quantities (blind count).
  - `identifiers[]`: `{ code, targetId }` — SKU, IMS label payload `ims:item:<id>`, and active barcodes.

### `POST /sync/push`

Body:

| Field        | Type   | Rule                    |
| ------------ | ------ | ----------------------- |
| `deviceId`   | string | required, trimmed, 1–64 |
| `operations` | array  | required, 1–50          |

Each operation:

| Field                 | Type                              | Rule                                                      |
| --------------------- | --------------------------------- | --------------------------------------------------------- |
| `operationId`         | uuid                              | required; client-made, reused on retry                    |
| `type`                | `"SUBMIT_COUNT"`                  | required                                                  |
| `sessionId`           | uuid                              | required                                                  |
| `targetId`            | uuid                              | required                                                  |
| `baseVersion`         | int ≥ 1                           | required; the target `version` the count was made against |
| `clientRecordedAt`    | ISO date-time with offset \| null | optional                                                  |
| `payload.quantity`    | int 0–1,000,000                   | required                                                  |
| `payload.notes`       | string \| null                    | optional, ≤1000                                           |
| `payload.evidenceIds` | uuid[]                            | optional, ≤3, each once; photos uploaded first (below)    |

`payload` is strict: unknown keys reject the operation.

- Who: active user; per operation the user must be assigned to the session and have `counts.submit` at its location.
- Batch-level problems (bad `deviceId`, 0 or >50 ops) → `422 VALIDATION_FAILED` (message only). Otherwise **200** with one result per operation, in order. Each operation runs in its own transaction.
- 200 `{ results: PushResult[], serverTime }`.

| `status`          | `code`              | When                                                                                                | Stored for replay   |
| ----------------- | ------------------- | --------------------------------------------------------------------------------------------------- | ------------------- |
| `ACKED`           | –                   | Saved; returns `serverRecordId`, `serverVersion`. Supersedes this user's earlier count of the line. | yes                 |
| `CONFLICT`        | `SESSION_CLOSED`    | Session not OPEN                                                                                    | yes                 |
| `CONFLICT`        | `RECOUNT_REQUESTED` | `baseVersion` ≠ current line version                                                                | yes                 |
| `REJECTED`        | `FORBIDDEN`         | Not assigned / no `counts.submit`, or a photo that isn't this person's for this line                | yes                 |
| `REJECTED`        | `VALIDATION_FAILED` | Line not in this session, no `quantity`, or bad photo list                                          | yes                 |
| `REJECTED`        | `VALIDATION_FAILED` | Operation does not parse (`operationId` may be `null`)                                              | no                  |
| `REJECTED`        | `OPERATION_REUSED`  | Same `operationId` already used with a different payload                                            | no (original stays) |
| `RETRYABLE_ERROR` | `INTERNAL`          | Unexpected server error; resend with the same `operationId`                                         | no                  |

Non-ACKED results carry `message` and `nextAction`; `CONFLICT` also carries `serverVersion`. Replay: the same `(user, operationId)` with the same payload returns the stored result (the `deviceId` is not part of the match).

Example:

```http
POST /api/v1/sync/push
Content-Type: application/json

{
  "deviceId": "dev-3f9a1c",
  "operations": [
    { "operationId": "a1c4f0de-2b7e-4c19-9d55-0e6f8a3b2c11", "type": "SUBMIT_COUNT",
      "sessionId": "5e2a…-session", "targetId": "77c1…-line", "baseVersion": 1,
      "clientRecordedAt": "2026-10-30T09:41:00+08:00", "payload": { "quantity": 18 } },
    { "operationId": "b2d5e1ef-3c8f-4d2a-8e66-1f7a9b4c3d22", "type": "SUBMIT_COUNT",
      "sessionId": "5e2a…-session", "targetId": "88d2…-line", "baseVersion": 2,
      "payload": { "quantity": 4, "notes": "One drill has a cracked handle" } }
  ]
}
```

```json
200
{
  "results": [
    { "operationId": "a1c4f0de-2b7e-4c19-9d55-0e6f8a3b2c11", "status": "ACKED",
      "serverRecordId": "c9e0…-entry", "serverVersion": 1 },
    { "operationId": "b2d5e1ef-3c8f-4d2a-8e66-1f7a9b4c3d22", "status": "CONFLICT",
      "code": "RECOUNT_REQUESTED",
      "message": "Your supervisor asked for a recount of this line after you counted it.",
      "nextAction": "Count it again, then send.", "serverVersion": 3 }
  ],
  "serverTime": "2026-10-30T01:42:05.120Z"
}
```

**Spec:** `GET /sync/changes` does not exist; devices compare `version` from `/counts/mine` and re-download with `/sync/bootstrap`.

### `PUT /evidence/:id` · `GET /evidence/:id`

Photos attached to a count (`evidenceIds` in a push) or to a returned line (`evidenceIds` in a return, §12). The client makes the photo's UUID, uploads it, then sends the record that names it.

- PUT query: `kind=COUNT|RETURN`, `targetId` (the count line, or the loan line), `locationId` (RETURN only: the receiving location, default the loan's). Body: the raw image, JPEG, PNG or WebP, up to 2 MB (`413` when larger; anything that doesn't decode → `422`).
- PUT who: COUNT: assigned to the count and `counts.submit` at its location. RETURN: loan visible and `custody.confirm` at the receiving location. 201 `{ id }`. The same id with the same bytes and target is a replay; a different one → `409`.
- GET: the image (`cache-control: private, no-store`). Visible to whoever uploaded it, to `counts.approve` at the count's location, or to anyone who can see the loan once the return is saved (FIELD only for loans they prepared). Otherwise `404`.
- When the record is saved, each photo must be the sender's, for that same target and location; not uploaded yet → `409`.

## 12. Borrowings

A loan takes quantities of items out of a location's stock and puts back what is returned. Loan statuses: `DRAFT` (request, no number, stock unchanged) → `OPEN` (released, `BOR-YYYY-NNNNNN`, quantities out of stock) → `CLOSED` (everything back, or closed as not returned); or `DRAFT` → `CANCELLED`. Line statuses: `PENDING` (on a draft) → `OUT` → `RETURNED` (when `returnedQuantity` reaches `quantity`).

### `GET /borrowings`

- Who: `records.view` (filtered to the user's locations). FIELD users see only loans they prepared.
- Query: `tab=requests|active|overdue|closed` (default `active`; `requests` = DRAFT, `active` = OPEN, `overdue` = OPEN past `dueAt`, `closed` = CLOSED + CANCELLED), `q` (reference, borrower name, or an item's SKU or name), `page`.
- 200 `{ rows, total, page, pageCount }`. Row: `id, reference, status, borrowerName, borrowerDept, purpose, dueAt, releasedAt, createdAt, location{ code }, preparedBy{ name }, total, returned, items[], overdue`. `total` and `returned` are unit sums over the loan; `items` is one `"3 × Drill"` string per line.

### `POST /borrowings` — Idempotency-Key required (the phone's draft id)

Creates a borrowing request (DRAFT). Stock is not checked or changed.

| Field              | Type                                           | Rule                                                  |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------- |
| `locationId`       | uuid                                           | required                                              |
| `borrowerName`     | string                                         | required, 1–120                                       |
| `borrowerDept`     | string                                         | optional, ≤120                                        |
| `purpose`          | string                                         | required, 1–300                                       |
| `dueAt`            | ISO date-time with offset \| null              | optional                                              |
| `receivedByName`   | string                                         | optional, ≤120                                        |
| `notes`            | string                                         | optional, ≤1000                                       |
| `lines`            | `[{ itemId?: uuid, code?: string, quantity }]` | required, 1–100; each line has `itemId` **or** `code` |
| `lines[].code`     | string                                         | 1–100; a SKU or barcode typed or scanned on the phone |
| `lines[].quantity` | int                                            | required, 1–1,000,000                                 |

- Who: `drafts.prepare` at `locationId` (FIELD allowed).
- Codes are looked up on the server (SKU first, then active barcodes). The same item twice (typed once, scanned once) becomes one line with the quantities added.
- 201 `{ id }`. Errors: `422` unknown code (the message lists them); `404` unknown or inactive item.

### `POST /borrowings/preview`

Returns a DRAFT-watermarked Equipment Borrowing PDF; nothing is saved and stock is not checked.

| Field            | Type                                                                          | Rule           |
| ---------------- | ----------------------------------------------------------------------------- | -------------- |
| `locationId`     | uuid                                                                          | required       |
| `borrowerName`   | string                                                                        | optional, ≤120 |
| `borrowerDept`   | string                                                                        | optional, ≤120 |
| `purpose`        | string                                                                        | optional, ≤300 |
| `dueAt`          | string \| null                                                                | optional       |
| `receivedByName` | string                                                                        | optional, ≤120 |
| `preparedByName` | string                                                                        | optional, ≤120 |
| `lines`          | `[{ itemId: uuid, quantity: int, condition?: string, accessories?: string }]` | required, ≤100 |

- Who: `custody.confirm` at `locationId`.
- 200 `application/pdf`, `inline; filename="DRAFT_Equipment_Borrowing.pdf"`.
- Errors: `422` "The preview request is not valid." (no field list). `404` for an unknown `locationId`. Unknown items print as `?`.

### `POST /borrowings/release` — Idempotency-Key required

Lends items on a new loan, or on an existing draft (`draftId`). The quantities leave the location's stock.

| Field                 | Type                              | Rule                                                                     |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `locationId`          | uuid                              | required; active                                                         |
| `borrowerName`        | string                            | required, 1–120                                                          |
| `borrowerDept`        | string                            | optional, ≤120                                                           |
| `purpose`             | string                            | required, 1–300                                                          |
| `dueAt`               | ISO date-time with offset \| null | optional                                                                 |
| `receivedByName`      | string                            | optional, ≤120                                                           |
| `preparedByName`      | string                            | optional, ≤120; printed as "Prepared by" (default: the signed-in user)   |
| `notes`               | string                            | optional, ≤1000                                                          |
| `draftId`             | uuid                              | optional; DRAFT at the same location. Its lines are replaced by `lines`. |
| `lines`               | array                             | required, 1–100, each `itemId` once                                      |
| `lines[].itemId`      | uuid                              | required; active item                                                    |
| `lines[].quantity`    | int                               | required, 1–1,000,000                                                    |
| `lines[].condition`   | `GOOD` \| `FAIR` \| `DAMAGED`     | optional, default `GOOD`                                                 |
| `lines[].accessories` | string                            | optional, ≤300                                                           |

- Who: `custody.confirm` at `locationId`.
- One transaction with the balance rows locked. Every line needs enough on hand at `locationId`, and no line's item may be in an OPEN count there (no exception possible). Then the loan is `OPEN` with a `BOR-` number, its lines are `OUT`, and one `BORROW` stock move with the same reference takes the quantities off. Audited as `borrowing.released`. An `EQUIPMENT_BORROWING` document is created; the PDF is drawn after commit.
- 201 `{ id, reference, documentId, lines: [{ sku, quantity, unit }] }`.
- Errors: `422` invalid body or the same item twice; `404` location / draft (also a draft at another location) / item; `409 INSUFFICIENT_STOCK` (nothing is written), `409 COUNT_IN_PROGRESS`, `409` inactive location or item, draft already released or cancelled.

Example:

```http
POST /api/v1/borrowings/release
Idempotency-Key: 7e3c2a91-5d4b-4f6e-8a1c-9b0d2e3f4a55
Content-Type: application/json

{
  "locationId": "0b6c…-location",
  "borrowerName": "Pedro Santos",
  "borrowerDept": "Site 4 electrical",
  "purpose": "WO-2210 panel replacement",
  "dueAt": "2026-11-06T17:00:00+08:00",
  "lines": [
    { "itemId": "41aa…-item", "quantity": 2, "condition": "GOOD", "accessories": "Charger, case" },
    { "itemId": "52bb…-item", "quantity": 10 }
  ]
}
```

```json
201
{
  "id": "d8e1…-loan",
  "reference": "BOR-2026-000045",
  "documentId": "f2c9…-doc",
  "lines": [
    { "sku": "TOOL-DRILL", "quantity": 2, "unit": "pcs" },
    { "sku": "PPE-0001", "quantity": 10, "unit": "pair" }
  ]
}
```

**Spec:** §12.1 has `POST /borrowings/:id/release`. Code is `POST /borrowings/release` with an optional `draftId` in the body.

### `GET /borrowings/:id`

- Who: `records.view` at the loan's location; FIELD only loans they prepared. Otherwise `404`.
- 200: loan record with `location`, `preparedBy`, `releasedBy`, `lines[]` (each with `quantity`, `returnedQuantity`, `status`, `conditionOut`, `accessories`, `item{ id, sku, name, unit{ code } }`, `returnLines[{ quantity, condition, notes, return{ reference, returnedAt } }]`, `photos[{ photoId }]`), `returns[{ id, reference, returnedAt, returnedByName, receivedBy{ name } }]`, `documents[{ id, reference, type, status }]` (the loan's form and each return's), `overdue`.

### `POST /borrowings/:id/cancel`

- Who: `records.view` (else `404`) and `custody.confirm` at the loan's location.
- Body `{ reason?: string }` (first 300 chars kept in the audit log).
- Only DRAFT requests (`409` otherwise). Stock is not touched (a draft never took any).
- 200: loan record (`status: "CANCELLED"`).

### `POST /borrowings/:id/return` — Idempotency-Key required

| Field                 | Type                          | Rule                                                                              |
| --------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| `returnedByName`      | string                        | required, 1–120                                                                   |
| `locationId`          | uuid                          | optional; receiving location, default = the loan's location; must be active       |
| `notes`               | string                        | optional, ≤1000                                                                   |
| `lines`               | array                         | required, 1–100, each `lineId` once                                               |
| `lines[].lineId`      | uuid                          | required; a line of this loan still `OUT`                                         |
| `lines[].quantity`    | int                           | required, 1 to what is still out on that line                                     |
| `lines[].condition`   | `GOOD` \| `FAIR` \| `DAMAGED` | optional, default `GOOD` (recorded; the quantity goes back into stock either way) |
| `lines[].notes`       | string                        | optional, ≤500                                                                    |
| `lines[].evidenceIds` | uuid[]                        | optional, ≤3, each once; photos uploaded first (`PUT /evidence/:id`, §11)         |

- Who: `records.view` at the loan's location (else `404`) and `custody.confirm` at the receiving location.
- Partial returns allowed: each line's `returnedQuantity` adds up; a line is `RETURNED` when all of it is back, and the loan `CLOSED` when every line is. What came back goes into stock at the receiving location as one `RETURN` stock move. Reference `RET-YYYY-NNNNNN`; a `RETURN_ACKNOWLEDGMENT` document is created. Audited as `borrowing.returned`.
- An item in an OPEN count at the receiving location → `409 COUNT_IN_PROGRESS` (no exception possible).
- 201 `{ returnId, reference, documentId, loanStatus: "OPEN" | "CLOSED", returned, total }` (`returned` and `total` are unit sums over the whole loan).
- Errors: `422` duplicate line, or more than is still out ("Only 2 pcs of Drill is still out"); `404` loan / line; `409` loan not OPEN, inactive receiving location, line already all back, `COUNT_IN_PROGRESS`, a photo not uploaded yet.

**Spec:** §12.1 has `POST /borrowings/:id/returns` (plural). Code is `/return`.

### `POST /borrowings/:id/close`

Closes an OPEN loan when the rest won't come back (lost, used up, broken beyond use).

- Who: `records.view` at the loan's location (else `404`) and `custody.confirm` there.
- Body `{ reason: string }`, at least 3 characters (`422` otherwise; the first 300 are kept).
- What is still out stays deducted from stock; no stock move is made. The loan becomes `CLOSED`; its lines keep their `returnedQuantity`. Audited as `borrowing.closed_not_returned` with the reason and what was not returned (`[{ sku, quantity }]`).
- 200: loan record (`status: "CLOSED"`, `closedAt`). `409` if the loan is not OPEN.

**Spec:** `/transmittals` and `/transmittals/:id/confirm` do not exist. A confirmed stock transfer creates the `TRANSMITTAL` document directly.

## 13. Documents

Types: `STOCK_ISSUANCE`, `TRANSMITTAL`, `EQUIPMENT_BORROWING`, `RETURN_ACKNOWLEDGMENT`. Statuses: `PENDING`, `READY`, `PDF_FAILED`, `VOID`. Visibility: `documents.download` at the document's location; FIELD users only documents they created. Otherwise `404`.

### `GET /documents`

- Query: `q` (reference contains), `type` (type enum), `status` (`READY` | `PDF_FAILED` | `PENDING`), `page`. Unknown values are ignored.
- 200 `{ rows, total, page, pageCount }`. Row: `id, type, reference, status, pageCount, createdAt, lastError, sourceType, sourceId, location{ code }, createdBy{ name }`. `sourceType` is `stock_transaction` (issue, transfer), `borrowing` (the loan) or `borrowing_return` (one return); `sourceId` is that record's id.

### `GET /documents/:id`

- 200 `{ id, reference, type, status, lastError, pageCount, canRetry }`.

### `GET /documents/:id/pdf`

- Query: `download=1` → `attachment`; otherwise `inline`.
- 200 `application/pdf`, filename `<reference>_<Type>.pdf`, `x-content-type-options: nosniff`. The file is read only from the private folder and its SHA-256 is checked.
- `409` if not READY, voided, or the file is missing/damaged (use retry).

### `POST /documents/:id/retry`

- Who: visible (above) and `stock.move` or `custody.confirm` at the document's location (`403` otherwise). No body.
- Redraws the PDF from its saved snapshot; never touches stock or loans.
- 200 `{ id, reference, status, lastError }` (status `READY` or `PDF_FAILED`). `409` if VOID.

## 14. Reports

### `GET /reports/:name/csv` · `GET /reports/:name/xlsx`

- `name`: `stock-balances` | `movements` | `loans` | `overdue` | `count-discrepancies`. Other names → `404`. `loans` ("Items on loan") lists every line still out on an OPEN loan: loan, borrower, department, SKU, item, still out, unit, due back, from.
- Who: ADMIN or SUPERVISOR (`403` for FIELD), `reports.view` at `locationId` if given, else filtered to the user's locations.
- Query filters (invalid values are silently dropped):

| Param        | Rule                                                                       | Used by                                                        |
| ------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `q`          | ≤100                                                                       | stock-balances, movements, loans, overdue                      |
| `locationId` | uuid                                                                       | all                                                            |
| `itemId`     | uuid                                                                       | stock-balances, movements, loans, count-discrepancies          |
| `userId`     | uuid                                                                       | movements                                                      |
| `type`       | `RECEIPT` \| `ISSUE` \| `TRANSFER` \| `ADJUSTMENT` \| `BORROW` \| `RETURN` | movements                                                      |
| `reference`  | ≤40                                                                        | movements, count-discrepancies                                 |
| `stock`      | `low` \| `out`                                                             | stock-balances                                                 |
| `from`, `to` | `YYYY-MM-DD`, company time (+08:00), inclusive                             | movements (confirmed date), count-discrepancies (decided date) |

- CSV: 200 `text/csv; charset=utf-8` with BOM, `attachment; filename="<name>-YYYY-MM-DD.csv"` (Manila date). XLSX: the same rows as an Excel file, `<name>-YYYY-MM-DD.xlsx`. Both have `x-content-type-options: nosniff`.
- Each file starts with the company name, the report title, the export time, the active filters and the row count, then a blank row and the column headers. Up to 50,000 rows; when rows were cut, the file says "Matching total: N (truncated …)" and the headers `x-export-total` / `x-export-truncated` say so too. Each export is audited (`report.exported`).
- Columns per report: see `lib/reports/service.ts`.

**Spec:** §12.1 has `GET /reports/:reportKey` for "filtered report or CSV". Code only serves files; the on-screen reports are server-rendered pages. `GET /audit-events` does not exist in the API.

## 15. Health

### `GET /api/health`

- No auth, not wrapped by `route()` (no `x-request-id`).
- 200 `{ status: "ok", db: "ok", time }` or 503 `{ status: "degraded", db: "down", time }`. `cache-control: no-store`.

## 16. Route files documented

54 files, 71 exported handlers (the Auth.js catch-all counts as one `GET` and one `POST`): 30 `GET`, 31 `POST`, 5 `PATCH`, 3 `PUT`, 2 `DELETE`.

| #   | File (`ims/app/api/…`)                           | Methods          |
| --- | ------------------------------------------------ | ---------------- |
| 1   | `health/route.ts`                                | GET              |
| 2   | `v1/auth/[...nextauth]/route.ts`                 | GET, POST        |
| 3   | `v1/me/route.ts`                                 | GET              |
| 4   | `v1/users/route.ts`                              | GET, POST        |
| 5   | `v1/users/[id]/route.ts`                         | GET, PATCH       |
| 6   | `v1/users/[id]/password-reset/route.ts`          | POST             |
| 7   | `v1/users/bulk-delete/route.ts`                  | POST             |
| 8   | `v1/locations/route.ts`                          | GET, POST        |
| 9   | `v1/locations/[id]/route.ts`                     | GET, PATCH       |
| 10  | `v1/locations/bulk-delete/route.ts`              | POST             |
| 11  | `v1/categories/route.ts`                         | GET, POST        |
| 12  | `v1/categories/[id]/route.ts`                    | PATCH            |
| 13  | `v1/units/route.ts`                              | GET, POST        |
| 14  | `v1/units/[id]/route.ts`                         | PATCH            |
| 15  | `v1/items/route.ts`                              | GET, POST        |
| 16  | `v1/items/[id]/route.ts`                         | GET, PATCH       |
| 17  | `v1/items/[id]/photo/route.ts`                   | GET, PUT, DELETE |
| 18  | `v1/items/bulk-delete/route.ts`                  | POST             |
| 19  | `v1/items/import/route.ts`                       | GET, POST        |
| 20  | `v1/items/export/route.ts`                       | GET              |
| 21  | `v1/lookup/route.ts`                             | GET              |
| 22  | `v1/settings/logo/route.ts`                      | GET, PUT, DELETE |
| 23  | `v1/stock/receipts/route.ts`                     | POST             |
| 24  | `v1/stock/issues/route.ts`                       | POST             |
| 25  | `v1/stock/transfers/route.ts`                    | POST             |
| 26  | `v1/stock/balances/route.ts`                     | GET              |
| 27  | `v1/stock/xlsx/route.ts`                         | GET              |
| 28  | `v1/counts/route.ts`                             | GET, POST        |
| 29  | `v1/counts/mine/route.ts`                        | GET              |
| 30  | `v1/counts/bulk-delete/route.ts`                 | POST             |
| 31  | `v1/counts/[id]/close/route.ts`                  | POST             |
| 32  | `v1/counts/[id]/reopen/route.ts`                 | POST             |
| 33  | `v1/counts/[id]/assignees/route.ts`              | POST             |
| 34  | `v1/counts/[id]/review/route.ts`                 | GET              |
| 35  | `v1/counts/[id]/approve-matching/route.ts`       | POST             |
| 36  | `v1/counts/[id]/lines/[lineId]/approve/route.ts` | POST             |
| 37  | `v1/counts/[id]/lines/[lineId]/keep/route.ts`    | POST             |
| 38  | `v1/counts/[id]/lines/[lineId]/recount/route.ts` | POST             |
| 39  | `v1/sync/bootstrap/route.ts`                     | GET              |
| 40  | `v1/sync/push/route.ts`                          | POST             |
| 41  | `v1/evidence/[id]/route.ts`                      | GET, PUT         |
| 42  | `v1/borrowings/route.ts`                         | GET, POST        |
| 43  | `v1/borrowings/preview/route.ts`                 | POST             |
| 44  | `v1/borrowings/release/route.ts`                 | POST             |
| 45  | `v1/borrowings/[id]/route.ts`                    | GET              |
| 46  | `v1/borrowings/[id]/cancel/route.ts`             | POST             |
| 47  | `v1/borrowings/[id]/return/route.ts`             | POST             |
| 48  | `v1/borrowings/[id]/close/route.ts`              | POST             |
| 49  | `v1/documents/route.ts`                          | GET              |
| 50  | `v1/documents/[id]/route.ts`                     | GET              |
| 51  | `v1/documents/[id]/pdf/route.ts`                 | GET              |
| 52  | `v1/documents/[id]/retry/route.ts`               | POST             |
| 53  | `v1/reports/[name]/csv/route.ts`                 | GET              |
| 54  | `v1/reports/[name]/xlsx/route.ts`                | GET              |

Check: `route.ts` files under `ims/app/api` = 54 (Glob `ims/app/api/**/route.ts`, 2026-11-12). Matches the 54 rows above.
