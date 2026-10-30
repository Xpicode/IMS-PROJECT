# IMS API reference

Written from the code in `app/api/**/route.ts` and `lib/**`. Where the original spec (`IMS_MVP.md` §12) differs, the code is documented and the difference is noted with **Spec:**.

## 1. Basics

| Topic      | Rule (as implemented)                                                                                                                                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base path  | `/api/v1` (health check is `/api/health`).                                                                                                                                                                                                                                               |
| Format     | JSON in, JSON out (`Response.json`). Exceptions: CSV exports and PDF downloads/previews.                                                                                                                                                                                                 |
| Body size  | JSON bodies over 1,000,000 bytes (4,000,000 for `POST /items/import`) → `413` with code `VALIDATION_FAILED`. Empty body is read as `{}`. Bad JSON → `400 INVALID_JSON`. NGINX also caps bodies at 8 MB.                                                                                  |
| Timestamps | Stored as `timestamptz`; returned as ISO 8601 UTC strings (`2026-10-30T02:15:00.000Z`). Date inputs (`dueAt`, `clientRecordedAt`) must be ISO 8601 date-times **with an offset** (`Z` or `+08:00`). Report CSVs are the exception: dates are display text in company time (Asia/Manila). |
| IDs        | UUIDs. A path `:id` that is not a UUID → `404 NOT_FOUND` (checked before the database).                                                                                                                                                                                                  |
| Request id | Send `X-Request-Id` (first 64 chars kept) or the server makes a UUID. Every wrapped response echoes it in `x-request-id` and in error bodies as `requestId`. NGINX sets it to `$request_id` in production.                                                                               |
| Caching    | Every wrapped response has `cache-control: no-store`.                                                                                                                                                                                                                                    |
| Pagination | `?page=N` (1–10,000, default 1). Page size is fixed at **50**, except `GET /items` which takes `?pageSize=` (1–100, default 50). Paged lists return `{ rows, total, page, pageCount }`. Unpaged lists return `{ data: [...] }`.                                                          |

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
| `reports.view`       | all   | assigned   | own (but every report route refuses FIELD, see §15) |

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
| `INSUFFICIENT_STOCK`       | 409                          | Issue/transfer would take a balance below zero.                                                                                                          |
| `COUNT_IN_PROGRESS`        | 409                          | Stock being counted (open count) at that location; send `countException` to override.                                                                    |
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

`POST /sync/push` does not use the header. It is idempotent per operation (`operationId`); see §12.

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

## 9. Items, import, export, lookup

Items are company-wide master data; balances are per location and filtered to the user's locations.

### `GET /items`

- Who: `records.view`.
- Query:

| Param              | Rule                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `q`                | up to 100 chars; SKU or name contains (case-insensitive), or exact active identifier (barcode) |
| `categoryId`       | UUID; a malformed value is ignored                                                             |
| `stock`            | `low` \| `out` (STOCK items only)                                                              |
| `tracking`         | `STOCK` \| `ASSET`                                                                             |
| `page`, `pageSize` | see §1 (`pageSize` 1–100, default 50)                                                          |

- 200 `{ rows, total, page, pageCount }`. Row: `id, sku, name, trackingType, minStock, isActive, categoryName, unitCode, onHand, assetCount, stockStatus ("OK" | "LOW" | "OUT" | null for assets)`. Only active items.

### `POST /items`

| Field            | Type               | Rule                                                                              |
| ---------------- | ------------------ | --------------------------------------------------------------------------------- |
| `sku`            | string             | required, trimmed, upper-cased, 1–40, `^[A-Z0-9][A-Z0-9._\-/]*$`                  |
| `name`           | string             | required, 1–160                                                                   |
| `description`    | string             | optional, ≤1000                                                                   |
| `categoryId`     | uuid \| null       | optional                                                                          |
| `unitId`         | uuid               | required; must be an active unit                                                  |
| `trackingType`   | `STOCK` \| `ASSET` | required                                                                          |
| `minStock`       | int                | optional, 0–1,000,000, default 0; must be 0 for `ASSET`                           |
| `brand`, `model` | string             | optional, ≤80                                                                     |
| `barcode`        | string             | optional, ≤100; normalized (upper-case, no spaces); stored as an `MFR` identifier |

- Who: `masterData.manage`.
- 201: item record. Errors: `422` (inactive unit, minStock on asset item); `409 DUPLICATE` SKU, or barcode already used as identifier/SKU/asset tag.

### `GET /items/:id`

- Who: `records.view`.
- 200: item with `category`, `unit`, `identifiers`, `balances[{ quantity, location }]`, `movements` (latest 50, with `transaction`), `assetCount`, `onHand`, `stockStatus`, `canManage`. `404` if missing.

### `PATCH /items/:id`

- Who: `masterData.manage`.
- Body (all optional): `name`, `description`, `categoryId`, `unitId`, `minStock`, `brand`, `model` (same rules as POST), `isActive` boolean. `sku`, `trackingType`, `barcode` cannot be changed.
- Fields left out are not changed (including `minStock`; fixed 30 Oct 2026).
- 200: item record. `404` if missing.

### `POST /items/import`

- Who: `masterData.manage`.
- Body: `{ csv: string, mode?: "preview" | "commit" }`. Anything but `"commit"` is a preview (writes nothing).
- CSV: header row required with `sku, name, unit, tracking_type`; optional `category, min_stock, description, barcode`. Max 2,000 data rows. Units and categories are matched by code/name (case-insensitive) and must exist. Max 2 MB of CSV (larger → `422` "The file is larger than 2 MB"); this route accepts a larger JSON body (2 × 2 MB) so a full-size CSV fits after JSON escaping.
- Preview 200 `{ rows: [{ line, ok, errors[], data }], validCount, errorCount }`.
- Commit 201 `{ imported, skipped }` — re-validates, creates all valid rows in one transaction, skips invalid rows.
- Errors: `422` missing `csv`, bad header, too many rows, no valid rows on commit.

### `GET /items/export`

- Who: `masterData.manage`.
- 200 `text/csv` (UTF-8 BOM), `attachment; filename="ims-items-YYYY-MM-DD.csv"`. Columns: `sku, name, category, unit, tracking_type, min_stock, description, barcode, on_hand, active`. Includes inactive items. `on_hand` is stock on hand (or asset count) over the user's locations. Cells are formula-safe.

### `GET /lookup?code=…`

- Who: `records.view`.
- `code` (≤200 chars): an IMS label payload `ims:item|asset|location:<uuid>`, SKU, asset tag, location code, or an alternate identifier (UPC-A / EAN-13 variants match).
- 200 `{ type: "item" | "asset" | "location", id, label, href }`. `href` is the UI page to open.
- `404` if nothing matches or the asset/location is outside the user's locations.

## 10. Assets

Status changes follow fixed rules (`lib/assets/transitions.ts`). Manual changes allowed:

| From                | Manual →                                               |
| ------------------- | ------------------------------------------------------ |
| `AVAILABLE`         | `UNDER_MAINTENANCE`, `NEEDS_REVIEW`, `LOST`, `RETIRED` |
| `BORROWED`          | `LOST` (back to stock only through a return)           |
| `UNDER_MAINTENANCE` | `AVAILABLE`, `NEEDS_REVIEW`, `LOST`, `RETIRED`         |
| `NEEDS_REVIEW`      | `AVAILABLE`, `UNDER_MAINTENANCE`, `LOST`, `RETIRED`    |
| `LOST`              | `NEEDS_REVIEW`, `RETIRED`                              |
| `RETIRED`           | none                                                   |

`AVAILABLE → BORROWED` only by release; `BORROWED → AVAILABLE / UNDER_MAINTENANCE / NEEDS_REVIEW` only by return.

### `GET /assets`

- Who: `records.view` (filtered to the user's locations).
- Query: `q` (≤100; tag, serial, item name or SKU contains), `status` (asset status enum), `locationId`, `itemId`, `page`. Malformed `status`/`locationId`/`itemId` values are ignored.
- 200 `{ rows, total, page, pageCount }`; rows are asset records with `item{ sku, name }`, `location{ code, name }`, sorted by tag.

### `POST /assets`

Creates N assets of one ASSET item, each with its own tag `PREFIX-0001…`.

| Field           | Type                          | Rule                                                      |
| --------------- | ----------------------------- | --------------------------------------------------------- |
| `itemId`        | uuid                          | required; ASSET item, active                              |
| `locationId`    | uuid                          | required; active                                          |
| `quantity`      | int                           | required, 1–200                                           |
| `tagPrefix`     | string                        | required, upper-cased, 1–20, `^[A-Z0-9][A-Z0-9-]*$`       |
| `condition`     | `GOOD` \| `FAIR` \| `DAMAGED` | optional, default `GOOD`                                  |
| `custodianName` | string                        | optional, ≤120                                            |
| `serialNumbers` | string[]                      | optional, each ≤100, ≤200 items, not more than `quantity` |
| `notes`         | string                        | optional, ≤1000                                           |

- Who: `masterData.manage` at `locationId`.
- 201 `{ assets: Asset[], warnings: string[] }`. Duplicate serials are warnings, not errors.
- Errors: `422` (STOCK item, too many serials); `404` item/location; `409` inactive item/location.

### `GET /assets/:id`

- Who: `records.view` at the asset's location; otherwise `404`.
- 200: asset with `item`, `location`, `events` (latest 100, with `actor.name`, `fromLocationCode`, `toLocationCode`), `canManage`, `nextStatuses` (manual choices, empty if not allowed).

### `PATCH /assets/:id`

| Field             | Type           | Rule                         |
| ----------------- | -------------- | ---------------------------- |
| `serialNumber`    | string \| null | optional, ≤100 (upper-cased) |
| `condition`       | condition enum | optional                     |
| `custodianName`   | string \| null | optional, ≤120               |
| `notes`           | string \| null | optional, ≤1000              |
| `expectedVersion` | int > 0        | **required**                 |

- Who: `masterData.manage` at the asset's location. At least one field besides `expectedVersion`.
- 200: asset record (version + 1). `409 CONFLICT` if `expectedVersion` is stale.

### `POST /assets/:id/status`

| Field             | Type              | Rule             |
| ----------------- | ----------------- | ---------------- |
| `status`          | asset status enum | required         |
| `reason`          | string            | required, 1–1000 |
| `expectedVersion` | int > 0           | required         |

- Who: `masterData.manage` at the asset's location.
- 200: asset record. `409` stale version or transition not allowed (message says why).

## 11. Stock

All three confirms: one DB transaction with row locks, a reference `RCV-|ISS-|TRN-YYYY-NNNNNN`, signed ledger lines, an audit event. Balances never go below zero. Lines: 1–100, each `itemId` once, `quantity` whole number 1–1,000,000, items must be active STOCK items, locations active.

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
- Errors: `409 INSUFFICIENT_STOCK` (all lines checked before anything is written), `409 COUNT_IN_PROGRESS`, `409` inactive item/location, `422` asset item in lines, `404` unknown item/location.

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

**Spec:** `GET /stock/movements` does not exist. Use the `movements` report CSV (§15).

## 12. Counts and offline sync

**Spec:** §12.1 names these `/count-sessions/...` with `submit`, `recount`, `reconcile`. Code uses `/counts/...`; counts are submitted only through `/sync/push`; review is split into per-line `approve`, `keep`, `recount` plus `approve-matching`. There is no `GET /counts/:id` (use `/counts/:id/review`).

### `GET /counts`

- Who: `records.view` (filtered to the user's locations; FIELD users see only counts they are assigned to).
- Query: `status=OPEN|CLOSED`, `page`.
- 200 `{ rows, total, page, pageCount }`. Row: `id, reference, name, status, dueAt, createdAt, location, assignees[{ user{ name } }], _count{ targets, entries }, progress{ counted, done }`.

### `POST /counts`

| Field           | Type                              | Rule                                                                                |
| --------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `name`          | string                            | required, 1–120                                                                     |
| `locationId`    | uuid                              | required; active                                                                    |
| `assigneeIds`   | uuid[]                            | optional, ≤50, default `[]`; each must be active and allowed `counts.perform` there |
| `includeStock`  | boolean                           | optional, default `true`                                                            |
| `includeAssets` | boolean                           | optional, default `true`; at least one of the two must be true                      |
| `categoryIds`   | uuid[]                            | optional, ≤100; empty = everything                                                  |
| `dueAt`         | ISO date-time with offset \| null | optional                                                                            |
| `notes`         | string                            | optional, ≤1000                                                                     |

- Who: `counts.create` at `locationId`.
- Snapshots expected stock quantities and lists assets in `AVAILABLE`, `UNDER_MAINTENANCE`, `NEEDS_REVIEW`. Reference `CNT-YYYY-NNNNNN`.
- 201: count session record. Errors: `422` bad assignee or nothing to count; `404` / `409` location.

### `GET /counts/mine`

- Who: any active user.
- 200 `{ data: [{ id, reference, name, dueAt, version, location{ id, code, name }, targetCount }] }` — OPEN sessions assigned to the user where they still have `counts.perform`.

### `POST /counts/:id/close`

- Who: `records.view` (else `404`) and `counts.create` at the session's location. No body.
- 200: count session record (`status: "CLOSED"`, `closedAt`). `409` if not OPEN.

### `POST /counts/:id/reopen`

- Who: as close. No body.
- 200: count session record (`status: "OPEN"`). `409` if not CLOSED.

### `GET /counts/:id/review`

- Who: `records.view` (else `404`) and `counts.approve` at the session's location. `409` if the session is CANCELLED.
- 200 `{ session, lines, counters, summary }`:
  - `lines[]`: `targetId, kind, version, sku, itemSku, name, unit, tag, serialNumber, expected, expectedStatus, currentCondition, entries[], counted, found, condition, variance, matches, movedDuringCount, recountRequested, state, review`.
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
- Stock line: posts ONE `ADJ-YYYY-NNNNNN` adjustment for (counted − current balance); zero difference posts nothing. Asset line: not found → asset `LOST`; new condition → asset condition updated.
- 200 `{ reviewId, targetId, decision: "APPROVED", counted, variance, adjustment: { id, reference } | null }`.
- Errors: `422` body invalid (no field list) or nobody counted yet; `409` already decided, stock moved during the count, counters disagree, chosen entry replaced, asset can't go to LOST; `404` line.

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
  - `targets[]`: `{ id, kind, version, item{ id, sku, name, unit }, asset{ id, tag, serialNumber, status, condition } | null }`. No expected quantities (blind count).
  - `identifiers[]`: `{ code, targetId }` — SKU / tag, IMS label payload, and active barcodes.

### `POST /sync/push`

Body:

| Field        | Type   | Rule                    |
| ------------ | ------ | ----------------------- |
| `deviceId`   | string | required, trimmed, 1–64 |
| `operations` | array  | required, 1–50          |

Each operation:

| Field               | Type                                  | Rule                                                         |
| ------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `operationId`       | uuid                                  | required; client-made, reused on retry                       |
| `type`              | `"SUBMIT_COUNT"`                      | required                                                     |
| `sessionId`         | uuid                                  | required                                                     |
| `targetId`          | uuid                                  | required                                                     |
| `baseVersion`       | int ≥ 1                               | required; the target `version` the count was made against    |
| `clientRecordedAt`  | ISO date-time with offset \| null     | optional                                                     |
| `payload.quantity`  | int 0–1,000,000 \| null               | stock lines: required; asset lines: must be empty            |
| `payload.found`     | boolean \| null                       | asset lines: required; stock lines: must be empty            |
| `payload.condition` | `GOOD` \| `FAIR` \| `DAMAGED` \| null | asset lines: required when `found` is true, empty when false |
| `payload.notes`     | string \| null                        | optional, ≤1000                                              |

`payload` is strict: unknown keys reject the operation.

- Who: active user; per operation the user must be assigned to the session and have `counts.submit` at its location.
- Batch-level problems (bad `deviceId`, 0 or >50 ops) → `422 VALIDATION_FAILED` (message only). Otherwise **200** with one result per operation, in order. Each operation runs in its own transaction.
- 200 `{ results: PushResult[], serverTime }`.

| `status`          | `code`              | When                                                                                                | Stored for replay   |
| ----------------- | ------------------- | --------------------------------------------------------------------------------------------------- | ------------------- |
| `ACKED`           | –                   | Saved; returns `serverRecordId`, `serverVersion`. Supersedes this user's earlier count of the line. | yes                 |
| `CONFLICT`        | `SESSION_CLOSED`    | Session not OPEN                                                                                    | yes                 |
| `CONFLICT`        | `RECOUNT_REQUESTED` | `baseVersion` ≠ current line version                                                                | yes                 |
| `REJECTED`        | `FORBIDDEN`         | Not assigned / no `counts.submit`                                                                   | yes                 |
| `REJECTED`        | `VALIDATION_FAILED` | Line not in this session, or wrong payload shape for the line kind                                  | yes                 |
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
      "sessionId": "5e2a…-session", "targetId": "88d2…-asset-line", "baseVersion": 2,
      "payload": { "found": true, "condition": "FAIR", "notes": "Cracked handle" } }
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

## 13. Borrowings

Loan statuses: `DRAFT` (request, no number) → `OPEN` (released, `BOR-YYYY-NNNNNN`) → `CLOSED` (all returned); or `DRAFT` → `CANCELLED`.

### `GET /borrowings`

- Who: `records.view` (filtered to the user's locations). FIELD users see only loans they prepared.
- Query: `tab=requests|active|overdue|closed` (default `active`; `requests` = DRAFT, `active` = OPEN, `overdue` = OPEN past `dueAt`, `closed` = CLOSED + CANCELLED), `q` (reference, borrower name, or asset tag), `page`.
- 200 `{ rows, total, page, pageCount }`. Row: `id, reference, status, borrowerName, borrowerDept, purpose, dueAt, releasedAt, createdAt, location{ code }, preparedBy{ name }, total, returned, tags[], overdue`.

### `POST /borrowings` — Idempotency-Key required (the phone's draft id)

Creates a borrowing request (DRAFT). Nothing changes on the assets.

| Field            | Type                              | Rule                                           |
| ---------------- | --------------------------------- | ---------------------------------------------- |
| `locationId`     | uuid                              | required                                       |
| `borrowerName`   | string                            | required, 1–120                                |
| `borrowerDept`   | string                            | optional, ≤120                                 |
| `purpose`        | string                            | required, 1–300                                |
| `dueAt`          | ISO date-time with offset \| null | optional                                       |
| `receivedByName` | string                            | optional, ≤120                                 |
| `notes`          | string                            | optional, ≤1000                                |
| `assetIds`       | uuid[]                            | optional, ≤100                                 |
| `assetTags`      | string[]                          | optional, ≤100, each 1–60 (typed/scanned tags) |

At least one asset (ids + tags).

- Who: `drafts.prepare` at `locationId` (FIELD allowed).
- 201 `{ id }`. Errors: `422` unknown tag; `404` unknown asset id.

### `POST /borrowings/preview`

Returns a DRAFT-watermarked Equipment Borrowing PDF; nothing is saved.

| Field            | Type                                                                | Rule           |
| ---------------- | ------------------------------------------------------------------- | -------------- |
| `locationId`     | uuid                                                                | required       |
| `borrowerName`   | string                                                              | optional, ≤120 |
| `borrowerDept`   | string                                                              | optional, ≤120 |
| `purpose`        | string                                                              | optional, ≤300 |
| `dueAt`          | string \| null                                                      | optional       |
| `receivedByName` | string                                                              | optional, ≤120 |
| `lines`          | `[{ assetId: uuid, condition: string, accessories?: string ≤300 }]` | required, ≤100 |

- Who: `custody.confirm` at `locationId`.
- 200 `application/pdf`, `inline; filename="DRAFT_Equipment_Borrowing.pdf"`.
- Errors: `422` "The preview request is not valid." (no field list). `404` for an unknown `locationId`. Only assets at `locationId` are filled in (others show as `?`), like the release.

### `POST /borrowings/release` — Idempotency-Key required

Releases assets on a new loan, or on an existing draft (`draftId`).

| Field            | Type                                                                                   | Rule                                                                         |
| ---------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `locationId`     | uuid                                                                                   | required; active                                                             |
| `borrowerName`   | string                                                                                 | required, 1–120                                                              |
| `borrowerDept`   | string                                                                                 | optional, ≤120                                                               |
| `purpose`        | string                                                                                 | required, 1–300                                                              |
| `dueAt`          | ISO date-time with offset \| null                                                      | optional                                                                     |
| `receivedByName` | string                                                                                 | optional, ≤120                                                               |
| `notes`          | string                                                                                 | optional, ≤1000                                                              |
| `draftId`        | uuid                                                                                   | optional; DRAFT at the same location. Its asset list is replaced by `lines`. |
| `lines`          | `[{ assetId: uuid, condition: "GOOD"\|"FAIR"\|"DAMAGED", accessories?: string ≤300 }]` | required, 1–100, each asset once                                             |

- Who: `custody.confirm` at `locationId`.
- Each asset must be at `locationId`, `AVAILABLE`, and not on another open loan. Assets become `BORROWED` with custodian = borrower.
- 201 `{ id, reference, documentId, assets: [tags] }`. An `EQUIPMENT_BORROWING` document is created; the PDF is drawn after commit.
- Errors: `422` duplicate asset; `404` location / draft / asset; `409` inactive location, draft already released or cancelled, asset not available / elsewhere / already out (one message listing all problems).

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
    { "assetId": "41aa…-asset", "condition": "GOOD", "accessories": "Charger, case" },
    { "assetId": "52bb…-asset", "condition": "FAIR" }
  ]
}
```

```json
201
{
  "id": "d8e1…-loan",
  "reference": "BOR-2026-000045",
  "documentId": "f2c9…-doc",
  "assets": ["TOOL-0012", "TOOL-0031"]
}
```

**Spec:** §12.1 has `POST /borrowings/:id/release`. Code is `POST /borrowings/release` with an optional `draftId` in the body.

### `GET /borrowings/:id`

- Who: `records.view` at the loan's location; FIELD only loans they prepared. Otherwise `404`.
- 200: loan record with `location`, `preparedBy`, `releasedBy`, `lines[]` (with `asset{ id, tag, serialNumber, status, item }`, `return{ reference }`), `returns[]`, `documents[{ id, reference, type, status }]`, `overdue`.

### `POST /borrowings/:id/cancel`

- Who: `records.view` (else `404`) and `custody.confirm` at the loan's location.
- Body `{ reason?: string }` (first 300 chars kept in the audit log).
- Only DRAFT requests (`409` otherwise).
- 200: loan record (`status: "CANCELLED"`).

### `POST /borrowings/:id/return` — Idempotency-Key required

| Field                        | Type                                  | Rule                                                                        |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `returnedByName`             | string                                | required, 1–120                                                             |
| `locationId`                 | uuid                                  | optional; receiving location, default = the loan's location; must be active |
| `notes`                      | string                                | optional, ≤1000                                                             |
| `lines`                      | array                                 | required, 1–100, each `lineId` once                                         |
| `lines[].lineId`             | uuid                                  | required; a line of this loan still `OUT`                                   |
| `lines[].condition`          | `GOOD` \| `FAIR` \| `DAMAGED`         | required                                                                    |
| `lines[].damagedStatus`      | `UNDER_MAINTENANCE` \| `NEEDS_REVIEW` | optional; used when `DAMAGED` (default `NEEDS_REVIEW`)                      |
| `lines[].missingAccessories` | string                                | optional, ≤300                                                              |
| `lines[].notes`              | string                                | optional, ≤500                                                              |

- Who: `records.view` at the loan's location (else `404`) and `custody.confirm` at the receiving location.
- Partial returns allowed. Non-damaged assets go back to `AVAILABLE`. The loan closes when every line is returned. Reference `RET-YYYY-NNNNNN`; a `RETURN_ACKNOWLEDGMENT` document is created.
- 201 `{ returnId, reference, documentId, loanStatus: "OPEN" | "CLOSED", returned, total }`.
- Errors: `422` duplicate line; `404` loan / line; `409` loan not OPEN, inactive receiving location, line already returned.

**Spec:** §12.1 has `POST /borrowings/:id/returns` (plural). Code is `/return`.

**Spec:** `/transmittals` and `/transmittals/:id/confirm` do not exist. A confirmed stock transfer creates the `TRANSMITTAL` document directly.

## 14. Documents

Types: `STOCK_ISSUANCE`, `TRANSMITTAL`, `EQUIPMENT_BORROWING`, `RETURN_ACKNOWLEDGMENT`. Statuses: `PENDING`, `READY`, `PDF_FAILED`, `VOID`. Visibility: `documents.download` at the document's location; FIELD users only documents they created. Otherwise `404`.

### `GET /documents`

- Query: `q` (reference contains), `type` (type enum), `status` (`READY` | `PDF_FAILED` | `PENDING`), `page`. Unknown values are ignored.
- 200 `{ rows, total, page, pageCount }`. Row: `id, type, reference, status, pageCount, createdAt, lastError, sourceType, sourceId, location{ code }, createdBy{ name }`.

### `GET /documents/:id`

- 200 `{ id, reference, type, status, lastError, pageCount, canRetry }`.

### `GET /documents/:id/pdf`

- Query: `download=1` → `attachment`; otherwise `inline`.
- 200 `application/pdf`, filename `<reference>_<Type>.pdf`, `x-content-type-options: nosniff`. The file is read only from the private folder and its SHA-256 is checked.
- `409` if not READY, voided, or the file is missing/damaged (use retry).

### `POST /documents/:id/retry`

- Who: visible (above) and `stock.move` or `custody.confirm` at the document's location (`403` otherwise). No body.
- Redraws the PDF from its saved snapshot; never touches stock or assets.
- 200 `{ id, reference, status, lastError }` (status `READY` or `PDF_FAILED`). `409` if VOID.

## 15. Reports

### `GET /reports/:name/csv`

- `name`: `stock-balances` | `movements` | `assets` | `overdue` | `count-discrepancies`. Other names → `404`.
- Who: ADMIN or SUPERVISOR (`403` for FIELD), `reports.view` at `locationId` if given, else filtered to the user's locations.
- Query filters (invalid values are silently dropped):

| Param        | Rule                                               | Used by                                                        |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------- |
| `q`          | ≤100                                               | stock-balances, movements, assets, overdue                     |
| `locationId` | uuid                                               | all                                                            |
| `itemId`     | uuid                                               | stock-balances, movements, assets, count-discrepancies         |
| `userId`     | uuid                                               | movements                                                      |
| `type`       | `RECEIPT` \| `ISSUE` \| `TRANSFER` \| `ADJUSTMENT` | movements                                                      |
| `reference`  | ≤40                                                | movements, count-discrepancies                                 |
| `status`     | asset status enum                                  | assets                                                         |
| `stock`      | `low` \| `out`                                     | stock-balances                                                 |
| `from`, `to` | `YYYY-MM-DD`, company time (+08:00), inclusive     | movements (confirmed date), count-discrepancies (decided date) |

- 200 `text/csv; charset=utf-8` with BOM, `attachment; filename="<name>-YYYY-MM-DD.csv"` (Manila date), `x-content-type-options: nosniff`. Up to 50,000 rows; extra rows are cut without a marker in the file. Each export is audited (`report.exported`).
- Columns per report: see `lib/reports/service.ts`.

**Spec:** §12.1 has `GET /reports/:reportKey` for "filtered report or CSV". Code only serves CSV; the on-screen reports are server-rendered pages. `GET /audit-events` does not exist in the API.

## 16. Health

### `GET /api/health`

- No auth, not wrapped by `route()` (no `x-request-id`).
- 200 `{ status: "ok", db: "ok", time }` or 503 `{ status: "degraded", db: "down", time }`. `cache-control: no-store`.

## 17. Route files documented

44 files, 57 exported handlers (the Auth.js catch-all counts as one `GET` and one `POST`). No route exports `PUT` or `DELETE`.

| #   | File (`ims/app/api/…`)                           | Methods    |
| --- | ------------------------------------------------ | ---------- |
| 1   | `health/route.ts`                                | GET        |
| 2   | `v1/auth/[...nextauth]/route.ts`                 | GET, POST  |
| 3   | `v1/me/route.ts`                                 | GET        |
| 4   | `v1/users/route.ts`                              | GET, POST  |
| 5   | `v1/users/[id]/route.ts`                         | GET, PATCH |
| 6   | `v1/users/[id]/password-reset/route.ts`          | POST       |
| 7   | `v1/locations/route.ts`                          | GET, POST  |
| 8   | `v1/locations/[id]/route.ts`                     | GET, PATCH |
| 9   | `v1/categories/route.ts`                         | GET, POST  |
| 10  | `v1/units/route.ts`                              | GET, POST  |
| 11  | `v1/items/route.ts`                              | GET, POST  |
| 12  | `v1/items/[id]/route.ts`                         | GET, PATCH |
| 13  | `v1/items/import/route.ts`                       | POST       |
| 14  | `v1/items/export/route.ts`                       | GET        |
| 15  | `v1/lookup/route.ts`                             | GET        |
| 16  | `v1/assets/route.ts`                             | GET, POST  |
| 17  | `v1/assets/[id]/route.ts`                        | GET, PATCH |
| 18  | `v1/assets/[id]/status/route.ts`                 | POST       |
| 19  | `v1/stock/receipts/route.ts`                     | POST       |
| 20  | `v1/stock/issues/route.ts`                       | POST       |
| 21  | `v1/stock/transfers/route.ts`                    | POST       |
| 22  | `v1/stock/balances/route.ts`                     | GET        |
| 23  | `v1/counts/route.ts`                             | GET, POST  |
| 24  | `v1/counts/mine/route.ts`                        | GET        |
| 25  | `v1/counts/[id]/close/route.ts`                  | POST       |
| 26  | `v1/counts/[id]/reopen/route.ts`                 | POST       |
| 27  | `v1/counts/[id]/review/route.ts`                 | GET        |
| 28  | `v1/counts/[id]/approve-matching/route.ts`       | POST       |
| 29  | `v1/counts/[id]/lines/[lineId]/approve/route.ts` | POST       |
| 30  | `v1/counts/[id]/lines/[lineId]/keep/route.ts`    | POST       |
| 31  | `v1/counts/[id]/lines/[lineId]/recount/route.ts` | POST       |
| 32  | `v1/sync/bootstrap/route.ts`                     | GET        |
| 33  | `v1/sync/push/route.ts`                          | POST       |
| 34  | `v1/borrowings/route.ts`                         | GET, POST  |
| 35  | `v1/borrowings/preview/route.ts`                 | POST       |
| 36  | `v1/borrowings/release/route.ts`                 | POST       |
| 37  | `v1/borrowings/[id]/route.ts`                    | GET        |
| 38  | `v1/borrowings/[id]/cancel/route.ts`             | POST       |
| 39  | `v1/borrowings/[id]/return/route.ts`             | POST       |
| 40  | `v1/documents/route.ts`                          | GET        |
| 41  | `v1/documents/[id]/route.ts`                     | GET        |
| 42  | `v1/documents/[id]/pdf/route.ts`                 | GET        |
| 43  | `v1/documents/[id]/retry/route.ts`               | POST       |
| 44  | `v1/reports/[name]/csv/route.ts`                 | GET        |

Check: `route.ts` files under `ims/app/api` = 44 (Glob `ims/app/api/**/route.ts`, 2026-10-30). Matches the 44 rows above.
