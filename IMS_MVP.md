# Inventory Management System (IMS)

**MVP Development and Turnover Plan**  
**Version:** 1.0  
**Date:** 19 October 2026  
**Status:** Approved functional scope, with operational details listed for confirmation  
**Deployment target:** Hostinger KVM VPS  
**Primary application:** Next.js web application with installable mobile PWA

## 1. Purpose and expected result

Build one inventory system for two kinds of records:

1. **Stock items:** materials and supplies measured in quantities, such as 150 gloves or 20 boxes of fittings.
2. **Individual assets:** separately identified equipment, such as laptops, printers, testing devices, and power tools. Every asset has its own ID and custody history.

Office users maintain the inventory and approve adjustments. Field personnel use a phone to scan QR codes or barcodes, count items, inspect assets, and save work in places where internet service is unreliable. When the connection returns, the app uploads pending work safely.

The system also records borrowing, issuance, returns, and handovers. Users can complete the relevant form on screen and download an official, printable PDF once the transaction has been confirmed.

**Success means** that every confirmed stock change or asset handover can be traced to an authorized action, offline counts are not lost during normal use, repeated uploads do not create duplicates, and records can be restored after a server failure.

### What this document covers

- Requirements and boundaries for the first release
- Permissions, screens, and operational workflows
- Stock and asset rules, including borrowing and returns
- Data tables, API contracts, and offline synchronization
- QR/barcode scanning and PDF documents
- Next.js, Docker, NGINX, PostgreSQL, and Hostinger deployment
- Implementation sequence, test cases, release checks, and handover items

### Important distinction

The **feature scope is approved**. The exact field names, official form layouts, approval authorities, devices, item import data, and hosting capacity still need verification against actual business records. These are identified in section 20. They must not be silently invented during development.

---

## 2. Technical decisions

| Area | Selected approach | Reason |
|---|---|---|
| Application | Next.js App Router with TypeScript | One codebase for admin web pages, mobile pages, and API routes |
| User interface | Tailwind CSS with accessible components such as shadcn/ui | Responsive screens and consistent forms |
| Production database | PostgreSQL inside Docker with a persistent volume | Safe concurrent transactions, constraints, and reporting |
| Local phone database | IndexedDB through Dexie.js | Works in a normal PWA without requiring native installation |
| Offline application files | Service worker and controlled cache rules | Previously opened field screens can load without internet |
| Scanning | Browser camera using `@zxing/browser`, manual code entry fallback | Supports common QR and linear barcode formats |
| Label creation | QR and Code 128 label generation | Printable identifiers for inventory items and assets |
| PDF creation | `pdf-lib`, using approved layouts or existing PDF templates | Creates consistent print-ready forms |
| Data access | Prisma ORM, PostgreSQL migrations, Zod validation | Explicit schema and server-side input checking |
| Web entry point | NGINX with HTTPS | Reverse proxy for the Next.js container |
| Containers | Docker Compose | Same service types in development and production |
| Production server | Hostinger KVM VPS | Self-managed application and database hosting |
| Native mobile packaging | **No Capacitor in the MVP** | Reduces build, release, and testing overhead |

### SQLite versus PostgreSQL versus Docker

Docker is not a database. It runs the PostgreSQL database as a managed container. SQLite is a capable database, but it is not the chosen main database because this system will process simultaneous inventory transactions from several users. SQLite inside the browser is also unnecessary: Dexie uses IndexedDB directly, which is supported in modern browsers. The browser database is only a working copy of assigned information, not the official inventory ledger.

### Why not Capacitor now?

Capacitor is useful when the product needs Android or iOS store distribution, native scanner plugins, managed-device integration, or another feature that is not dependable in the browser. A normal PWA can already use the camera, save counts offline, install on supported phones, and synchronize through HTTPS.

**Important for future work:** Capacitor expects built web files for its mobile package. A full Next.js application that depends on server rendering, cookies, and route handlers cannot simply be exported as a static Capacitor app without changes. Keep field screens and API calls separate so a future mobile shell can reuse the interface against a remote HTTPS API. Do not enable Next.js `output: 'export'` for the current server-based application.

Reconsider Capacitor only after pilot testing shows an actual requirement, for example repeated camera failure on supported phones, native hardware integration, store distribution, or company-managed device deployment. If chosen later, budget for Android/iOS build tools, signing, updates, native plugin testing, and possibly separating the field client from the server application.

---

## 3. Architecture

```text
                       OFFICE / FIELD USERS
                       Desktop and Mobile PWA
                                 |
                            HTTPS / 443
                                 |
                    Hostinger KVM VPS (Linux)
                                 |
                           NGINX container
                                 |
                         Next.js container
                    Admin UI | Field UI | API
                                 |
                   Private Docker network
                                 |
                       PostgreSQL container
                         Persistent volume

  On each field phone:
  PWA files cached by service worker
  IndexedDB (Dexie): assignments, items, counts, sync queue

  Nightly DB backup -> encrypted off-VPS destination
  Document files or regenerate-able document snapshots -> backup
```

NGINX must not connect directly to the database. The browser must never hold database credentials. PostgreSQL must not expose port 5432 to the public internet.

### Main data flow

1. User signs in to the application while online.
2. Server checks identity, role, and location assignment.
3. Field PWA downloads authorized count assignments and item identifiers.
4. Staff record counts and inspections locally, even offline.
5. When connected, the PWA sends queued operations to the Next.js API.
6. The API validates and records the results in PostgreSQL and replies with a result for each operation.
7. A supervisor reviews differences and approves any stock adjustment.
8. Confirmed transactions are available for reporting and official PDF generation.

---

## 4. Scope of the MVP

### Included

- Account login, user activation/deactivation, and role permissions
- Dashboard showing stock, asset status, low-stock items, pending work, and recent activity
- Categories, units of measure, item records, and location records
- CSV import/export of initial item data
- Stock receipt, stock issue, and transfer between locations
- Individual asset registry with unique QR or barcode tags, condition, location, and custodian
- QR/barcode label printing and manual identifier lookup
- Inventory count sessions assigned to field personnel
- Offline mobile count entry and individual asset inspection
- Reconnection, manual synchronization, duplicate protection, and conflict review
- Supervisor reconciliation, recounts, and approved stock adjustments
- Asset borrowing, release, return, and custody history
- Remittal/transmittal, borrowing, stock issuance, and return forms
- PDF preview, download, reprint, and document tracking
- Basic reports, CSV exports, and audit history
- Docker-based deployment with NGINX, PostgreSQL backups, and recovery instructions

### Explicitly not included

- Purchasing, supplier management, purchase orders, and accounting integration
- POS, sales invoicing, and general ledger
- Stock costing (FIFO, moving average, inventory valuation)
- Expiry dates, batch/lot controls, and complex warehouse picking
- GPS tracking, RFID, BLE device integration, or native barcode hardware plugins
- Native Android/iOS apps and Capacitor
- Offline approval, offline official stock movement, or offline confirmed borrowing
- Public borrower portal, digital signature certificates, SMS, or push alerts
- Multi-company accounts or custom drag-and-drop form builders
- Advanced forecasting and dashboards

A request for a feature outside this list requires separate approval and an estimate before implementation.

---

## 5. Roles and permission rules

| Operation | Admin | Supervisor | Field personnel |
|---|:---:|:---:|:---:|
| Manage users, roles, and settings | Yes | No | No |
| Maintain item and asset master data | Yes | Assigned scope | No |
| Manage locations | Yes | Assigned scope | No |
| Create count sessions | Yes | Yes | No |
| Perform assigned counts and inspections | Yes | Yes | Yes |
| Submit own count | Yes | Yes | Yes |
| Review and approve count adjustments | Yes | Yes | No |
| Receive / issue / transfer stock | Yes | Yes | No |
| Prepare borrowing or handover drafts | Yes | Yes | Yes, assigned scope |
| Confirm release and return | Yes | Yes | No |
| Download own or authorized transaction PDFs | Yes | Yes | Limited |
| View audit trail and reports | Yes | Yes, assigned scope | Own work only |

All permissions must be checked by the API and scoped to locations or records. Changing a request body or URL must not grant access. Never rely on hidden buttons as the security control.

**Default policy for the first release:** only administrators and supervisors can finalize inventory movements. Field personnel may prepare drafts and submit counts, but they cannot directly change official balances. Confirm actual approval roles before launch.

---

## 6. Main records and identification rules

### 6.1 Stock item

Example: Safety Gloves, SKU `PPE-0001`, unit `pair`. There may be 120 pairs at Main Warehouse and 40 at Site B. One item record holds the product details; each location has its own quantity.

Minimum fields: item ID, SKU, name, category, unit of measure, minimum stock level, active status, created/updated dates. Optional fields: description, brand, model, supplier reference, and image.

### 6.2 Individual asset

Example: three identical cordless drills with three different asset tags.

| Asset tag | Item/model | Serial number | Status | Custodian |
|---|---|---|---|---|
| TOOL-0001 | Cordless Drill | MFG-821 | Available | Warehouse A |
| TOOL-0002 | Cordless Drill | MFG-822 | Borrowed | Maintenance Team |
| TOOL-0003 | Cordless Drill | MFG-823 | Under maintenance | Workshop |

Each physical asset must have one unique asset record. Duplicate serial numbers should be flagged where serial numbers are supplied, allowing documented exceptions where a serial is absent or unreliable.

Minimum fields: asset ID, asset tag, linked item/model, current location, status, condition, optional serial number, custodian, and history timestamps.

### 6.3 Code rules

- Each generated QR represents either a stock SKU, an individual asset, or a location.
- Scan payloads use a type and stable ID, such as `ims:item:<uuid>`, `ims:asset:<uuid>`, or `ims:location:<uuid>`.
- QR values never contain passwords, private employee details, or privileged API URLs.
- Existing manufacturer barcodes are registered as alternate identifiers and must not map to two active records in the same identifier namespace.
- Support QR, Code 128, EAN-13, and UPC-A in the first pilot. Check each format against actual labels.
- An unreadable label must be replaceable without changing the item's or asset's internal ID.

### 6.4 Stock is not the same as asset custody

- A **stock issue** reduces available stock when confirmed.
- **Asset borrowing** changes custody and status, not a quantity in a consumable stock balance.
- Returned assets are marked available only after inspection and confirmation.
- An asset assigned to a borrower is not automatically considered missing in a warehouse count. The location count and custody register must be reconciled separately.

---

## 7. Functional workflows

### 7.1 Register an item or asset

1. Admin opens the item master and enters unique SKU, name, unit, category, and minimum quantity.
2. The server checks uniqueness and required fields.
3. For individual equipment, an asset record is created for each physical unit.
4. The system assigns an internal ID and offers a printable QR or barcode label.
5. Deactivation hides records from new transactions but retains all history.

### 7.2 Receive stock

1. Supervisor selects receiving location and item.
2. Enters quantity, reference, source, date, and remarks.
3. API validates positive quantity and authorization.
4. One database transaction records the receipt and increases that location's balance.
5. An audit entry and transaction reference are saved.

### 7.3 Issue stock

1. Supervisor selects item, location, recipient, quantity, and purpose.
2. System checks the available balance at confirmation time.
3. On approval, a database transaction subtracts the issued amount.
4. A stock issuance document can be downloaded and printed.
5. Failed validation must not create a partial issue or PDF represented as official.

### 7.4 Transfer stock

1. Supervisor selects source, destination, item, and quantity.
2. System checks that source and destination differ and sufficient stock exists.
3. In one committed database transaction, source quantity decreases and destination quantity increases by the same amount.
4. Transaction history stores both sides under the same transfer reference.
5. A failed transfer leaves both balances unchanged.

### 7.5 Borrow an individual asset

1. User opens a draft and chooses borrower, department/site, purpose, due date, and asset tag(s).
2. System confirms the asset exists and is available when finalizing.
3. Supervisor authorizes release, records condition, accessories, and receiving person.
4. In one database transaction, the loan is recorded and each asset becomes `BORROWED` with a current custodian.
5. The official borrowing PDF becomes available with a unique reference number.
6. A duplicate or competing release request cannot borrow the same asset again.

### 7.6 Return an asset

1. Receiver scans the asset or opens the active borrowing record.
2. Records return date, condition, missing accessories, and notes.
3. Supervisor confirms receipt.
4. If acceptable, the loan line closes and the asset becomes `AVAILABLE` at the receiving location.
5. If damaged, the asset becomes `UNDER_MAINTENANCE` or `NEEDS_REVIEW`, not automatically available.
6. The system generates a return acknowledgment PDF and retains the custody history.

Allow a borrowing record containing several assets to be **partially returned**. Each asset line has its own return state. The borrowing header closes only when every line is resolved.

### 7.7 Physical inventory count

1. Supervisor creates a session with assigned location, covered items/assets, personnel, and planned count window.
2. Staff log in and download the session while online. The app displays a clear `Ready for Offline Use` confirmation.
3. Staff scan and enter stock quantities, or mark each targeted asset found/not found and its condition.
4. Re-scanning an item reopens the recorded result. It must never silently increase the count.
5. Staff may revise locally saved results until submitting the session.
6. Counts can be submitted while offline into the local queue. The UI distinguishes `Submitted on Device` from `Received by Server`.
7. Once online, staff synchronize and see per-operation results.
8. Supervisor reviews count discrepancies, requests recounts, or approves adjustments.
9. Only an approved adjustment changes official stock quantities.

**Counting control:** Movement of covered stock during a physical count makes variance interpretation difficult. For the initial release, default to a short, scheduled freeze on stock movements for the counted location/scope. If operations cannot stop, a supervisor must record an exception; affected count lines need review or recount before adjustment. Confirm whether this workflow fits the actual sites before implementation. Do not silently apply stale counts over intervening movements.

### 7.8 Remittal or transmittal

Use a document to record the handover of materials/equipment between people or locations, including the sender, receiver, items, quantities or asset IDs, purpose, and receiving acknowledgment. The document must link to a real stock transfer, stock issue, or custody event when that event changes inventory. A printed form alone must not change balances. Confirm whether the organization's term `remittal` means handover, return, or another process before locking the document template.

---

## 8. User screens

### Administration and supervision

| Screen | Required contents |
|---|---|
| Login | Credentials, password reset, helpful error messages |
| Dashboard | Total SKUs/assets, stock by location, low stock, pending approvals, overdue assets, active counts |
| Item master | Search, category, SKU, new/edit/deactivate, CSV import/export |
| Asset registry | Tag, model, status, location, custodian, history, printable label |
| Locations | Site, warehouse, rack/area, active status, assigned staff |
| Stock transactions | Receipt, issue, transfer, transaction history |
| Count sessions | Create, assign, track, receive, request recount, close |
| Reconciliation | Expected vs counted quantity, variance, evidence, approval |
| Borrowing and returns | Draft, release, due date, returned items, condition, overdue |
| Forms and documents | Preview, approved document list, download, reprint |
| Reports | Stock balances, movement ledger, asset status, overdue, count discrepancies, CSV |
| Users and audit | Roles, location restrictions, activity history |

### Mobile field PWA

1. Home / My Assignments
2. Assignment detail / Download for Offline Use
3. Scan QR or barcode / Manual lookup
4. Stock quantity entry / Asset presence and condition
5. Saved count results / Edit count
6. Submit count / Pending Sync
7. Draft borrowing or handover form (official confirmation online only)
8. Sync status / Resolve errors
9. Profile / Offline storage and device guidance

Design for one-handed use, large buttons, readable text outdoors, clear success/failure messages, and an always-visible count of pending operations. Never show `Synced` until the server acknowledges receipt.

---
## 9. Database design

PostgreSQL is the sole authority for confirmed stock quantities and custody state. The application may maintain `stock_balances` as a fast current balance, but every change must also appear in a permanent movement ledger. Only items marked `STOCK` may use quantity balances and stock movements; serialized assets use asset events and custody records. Do not update balances directly from a form or a browser sync request.

### 9.1 Proposed tables

| Table | Important columns and purpose |
|---|---|
| `users` | `id`, name, email, password hash or auth provider ID, role, status, timestamps |
| `user_locations` | `user_id`, `location_id`, access type; unique pair |
| `locations` | `id`, code, name, optional parent location, active flag |
| `categories` | `id`, name, active flag |
| `units` | `id`, code, display name |
| `items` | `id`, unique SKU, name, category, unit, `tracking_type` (`STOCK` or `ASSET`), min stock, active flag |
| `item_identifiers` | `id`, item/asset/location reference, type, normalized code, unique namespace/code pair |
| `assets` | `id`, unique asset tag, item ID, optional serial, location, custodian, status, condition, row version |
| `stock_balances` | Item ID + location ID unique, available quantity, row version |
| `stock_transactions` | `id`, unique reference, type, reason, actor, status, confirmation time |
| `stock_movements` | `id`, transaction ID, item ID, location ID, signed quantity, time; immutable entries |
| `asset_events` | `id`, asset ID, event type, old/new custody, old/new condition, actor, timestamp |
| `borrowings` | `id`, reference, borrower, purpose, due date, status, approved/released by |
| `borrowing_lines` | `id`, borrowing ID, asset ID, release/return condition and dates, line status |
| `count_sessions` | `id`, location, scope, assignees, status, planned window, snapshot time/version |
| `count_session_items` | `session_id`, item/asset ID, expected snapshot, eligibility, scope identifier |
| `count_entries` | `id`, session, item/asset, counter, recorded count or presence, condition, base version, status |
| `count_reviews` | Count entry, expected value, submitted value, variance, decision, reviewer, notes |
| `sync_operations` | Unique user + operation UUID, request hash, processing outcome, stored response, date |
| `pdf_documents` | `id`, official document number, type, source transaction, template version, snapshot, file path/checksum, status |
| `audit_events` | Actor, event type, record type/ID, safe before/after details, timestamp, request ID |
| `document_sequences` | Document type, year, next sequence; incremented transactionally |

The names are a proposed starting point. Exact Prisma models and foreign keys must be reviewed before migration `0001` is accepted.

### 9.2 Database constraints

- Use UUIDs for internal IDs; use human-readable SKUs, tags, and document numbers for display.
- Unique SKU across all items; unique asset tag across all assets.
- Unique identifier code within a defined code namespace.
- Unique current balance per (`item_id`, `location_id`).
- Quantity is a fixed-precision decimal or integer smallest unit, **never JavaScript floating point for official arithmetic**. If only whole-number units are permitted, use integer quantities. The unit policy requires confirmation.
- Reject negative receipt, issue, transfer, or count quantities.
- Stock quantity cannot become negative unless a separately approved negative-stock policy exists; none is proposed in the MVP.
- Borrowing a serialized asset requires it to be available and not already on an open borrowing line.
- Foreign keys protect relationships. Historical records use deactivation or cancellation, not destructive deletion.
- Every approval, stock movement, borrowing change, and PDF number is attributed to an authenticated user.
- Store UTC timestamps in the database and display dates in the agreed company timezone.

### 9.3 Transactions and concurrency

**Receiving:** create transaction header, signed movement, updated balance, and audit event in one database transaction.

**Issuing:** lock or atomically update the relevant balance row with a nonnegative balance condition. Reject the request if another user has already issued the remaining stock.

**Transfers:** lock both balance rows in a stable order to reduce deadlock risk. Create the outgoing and incoming movements and update both balances in the same transaction. The signed movement sum for a transfer must equal zero.

**Asset release and return:** lock the affected asset row(s), verify allowed state transition, update status/custodian, create borrowing or return records, and append asset events in a single transaction.

**Count approvals:** verify the count session remains reviewable, validate that underlying stock has not changed contrary to count policy, and post an adjustment transaction rather than overwriting a balance. Each reconciliation line may create at most one approved adjustment.

**Corrections:** reverse a posted transaction using a linked, authorized reversing transaction. Do not edit or delete an earlier posted movement.

### 9.4 Asset statuses

`AVAILABLE`, `BORROWED`, `UNDER_MAINTENANCE`, `NEEDS_REVIEW`, `LOST`, `RETIRED`.

Document permitted transitions in code. For instance, `AVAILABLE -> BORROWED` requires confirmed release, and `BORROWED -> AVAILABLE` requires a return inspection. `RETIRED` must not be borrowed. Do not let an ordinary edit screen directly set status without creating a corresponding event.

### 9.5 Reporting approach

Calculate current stock from `stock_balances`, with periodic verification against aggregated `stock_movements`. Use movement and custody histories to produce date-range reports. Support at least item, location, user, date, status, and reference filtering. CSV exports must use appropriate encoding and defend against spreadsheet formula injection by escaping dangerous leading characters in user-provided cells.

---

## 10. PWA and Dexie offline design

### 10.1 What must work offline

- Open previously cached field screens
- See assignments explicitly downloaded for the current user/device
- Find downloaded SKUs and assets by scanned or typed identifier
- Save or revise stock counts locally
- Record individual asset presence, condition, and notes
- Review local counts and queue them for submission
- See pending count and storage warnings

### 10.2 What requires internet

- First sign-in and first assignment download
- Refreshing permissions and receiving new assignments
- Final validation and acknowledgment of counts
- Confirming stock receipt/issue/transfer
- Releasing or returning borrowed assets officially
- Supervisor approval, stock adjustments, and official PDF numbering
- Downloading an official document that is not already locally available

Draft form input may be saved locally if this is useful to field staff. It must be clearly marked `Draft on this device` and cannot show an official document number while offline.

### 10.3 Proposed Dexie tables

| Local table | Data | Key considerations |
|---|---|---|
| `assignments` | Session ID, location, allowed scope, server version, downloaded date | Only current user's assignments |
| `items` | ID, SKU, name, unit, type, matching codes | No confidential server fields |
| `assets` | ID, tag, item, last known status, condition, code | Mark all values as last-synced data |
| `identifiers` | Code, kind, record ID | Local scan lookup index |
| `countDrafts` | Device draft ID, session, target item/asset, count/presence, notes, local update time | Unique per user/session/target for one consolidated count |
| `outbox` | Stable operation UUID, type, frozen payload, base version, queue status, attempts, last error | Never discard until acknowledged or deliberately resolved |
| `syncMeta` | User, device ID, schema version, last cursor, last successful sync, storage warning | Do not store auth secrets |
| `inboxConflicts` | Operation ID, server details, suggested action | User-visible conflict handling |

Illustrative Dexie definition, to be adapted once field types are finalized:

```ts
import Dexie, { type Table } from 'dexie';

type OutboxStatus = 'PENDING' | 'SENDING' | 'ACKED' | 'CONFLICT' | 'FAILED';

type OutboxOperation = {
  operationId: string;
  userId: string;
  sessionId: string;
  type: 'SUBMIT_COUNT';
  payload: unknown;
  baseVersion: number;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  lastError?: string;
};

class FieldDB extends Dexie {
  assignments!: Table<unknown, string>;
  items!: Table<unknown, string>;
  assets!: Table<unknown, string>;
  identifiers!: Table<unknown, string>;
  countDrafts!: Table<unknown, string>;
  outbox!: Table<OutboxOperation, string>;
  syncMeta!: Table<unknown, string>;
  inboxConflicts!: Table<unknown, string>;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(1).stores({
      assignments: 'id, locationId, updatedAt',
      items: 'id, sku, name',
      assets: 'id, tag, itemId, status',
      identifiers: 'code, kind, recordId',
      countDrafts: 'id, sessionId, targetId, updatedAt',
      outbox: 'operationId, userId, sessionId, status, createdAt',
      syncMeta: 'id',
      inboxConflicts: 'operationId, sessionId'
    });
  }
}

// Create only in the browser after identifying the signed-in user.
// Separate databases by user and company/workspace if applicable.
export function makeFieldDB(userId: string) {
  return new FieldDB(`ims-field-${userId}`);
}
```

This is a **model example, not a complete copy-paste implementation**. Define strict TypeScript record types, IndexedDB version migrations, and tests before using it. Construct the DB in a client-only module and avoid accessing `window`, `navigator`, or IndexedDB during server rendering.

### 10.4 Service worker and caching

- Include manifest, app icons, install instructions, and an offline fallback screen.
- Precache the minimum field app shell required to load offline after initial visit, including the scanner code needed for field work.
- Implement field routes as client-rendered screens that load assigned content from Dexie while offline. Configure a tested service-worker navigation fallback for those routes rather than depending on a fresh server-rendered response.
- Cache only safe static assets automatically. Do not blindly cache private API responses.
- Save assigned inventory data in Dexie, not as uncontrolled browser response cache.
- Use an explicit cache version and update strategy. An app update must not delete pending Dexie submissions.
- Tell users when an update is available; do not reload mid-count if it risks interrupting work.
- Use HTTPS for production. Camera and several PWA features depend on a secure context.

### 10.5 Device storage and account safety

- Ask for `navigator.storage.persist()` where available and display the result, but do not promise the browser will grant it.
- Check estimated quota and handle quota errors, storage eviction, private browsing, and disabled storage.
- Keep downloaded data small and scoped to assignments. Avoid photos and large attachments in offline MVP unless explicitly approved.
- For an installed iPhone Home Screen app, verify its own local assignment data has been downloaded after installation. Do not assume it shares Safari tab storage or login state.
- Show `X counts not yet synced` prominently. Warn before logout, data clearing, or uninstall.
- Never log a different user into the same local database. Separate or securely clear local records after synchronization.
- Pending changes must not be sent under a different account. Reauthentication and current server permissions are required before upload.
- If the user loses their phone before upload, unsynced data may be unrecoverable. Explain this limitation in the field manual.
- Do not store passwords, session tokens, database credentials, or administrator-only data in Dexie.

### 10.6 Browser background sync

The primary path is a visible **Sync Now** button. The app may retry while open when connection returns. Do not rely on service-worker background sync, periodic sync, or notifications as the only delivery mechanism because support varies between browsers, especially on iOS.

---

## 11. Synchronization contract and conflict handling

### 11.1 Rules

1. The server is the source of truth.
2. A count saved offline is a draft or submitted observation, not a stock movement.
3. Every outbound action has a stable `operationId` UUID created once on the device.
4. Retrying **the same operation** must reuse its UUID and identical payload.
5. The server records operation ID, payload hash, and response under a unique (`user_id`, `operation_id`) constraint.
6. If the same ID is received again with the same hash, return the stored result. If the hash differs, reject it.
7. Each operation carries `sessionId`, `targetId`, and `baseVersion` so the server can detect stale work.
8. The API checks current permissions and session status at the moment of upload.
9. Conflicts remain visible for review; do not use `last write wins`.
10. An outbox entry is removed only after a durable server acknowledgment or explicit safe resolution.

### 11.2 Outbox lifecycle

```text
LOCAL DRAFT
    |
Submit on device
    v
PENDING -> SENDING -> ACKED
              |  |
              |  +-> CONFLICT (needs review / recount)
              +----> FAILED (network or server; retry safely)
```

A draft may be edited freely before submission. At submission, copy it into a **frozen payload** with a new operation UUID. If a person wants to edit after that operation has been sent, first obtain its server outcome. Do not silently replace the payload under the same operation ID.

### 11.3 Suggested endpoints

**Download scope:** `GET /api/v1/sync/bootstrap?sessionId=<uuid>`

Returns assigned session, authorized item and asset identifiers, current server revisions, and a server time. Access is denied for unassigned sessions.

**Push operations:** `POST /api/v1/sync/push`

Example request:

```json
{
  "deviceId": "device-6b3b",
  "operations": [
    {
      "operationId": "8a46e658-60a7-4dad-9128-167640c7fa2b",
      "type": "SUBMIT_COUNT",
      "sessionId": "SESSION-UUID",
      "targetType": "STOCK_ITEM",
      "targetId": "ITEM-UUID",
      "baseVersion": 4,
      "clientRecordedAt": "2026-10-19T02:30:00Z",
      "payload": {"quantity": 98, "notes": "Two damaged pairs"}
    }
  ]
}
```

Example mixed response (each operation is handled independently):

```json
{
  "results": [
    {
      "operationId": "8a46e658-60a7-4dad-9128-167640c7fa2b",
      "status": "ACKED",
      "serverRecordId": "COUNT-UUID",
      "serverVersion": 5
    }
  ],
  "serverTime": "2026-10-19T02:30:05Z"
}
```

Use `ACKED`, `CONFLICT`, `REJECTED`, and `RETRYABLE_ERROR` as operation-level results. Network failures may prevent any response at all, so the client retries with the original operation ID. A `CONFLICT` response must include a safe explanation, current server version, and next action. Do not send sensitive data about other users unnecessarily.

**Pull changes:** `GET /api/v1/sync/changes?cursor=<opaque-cursor>`

Return updates only for assignments the authenticated user can access. Treat the cursor as opaque and verify that it is bound to the correct user/scope. If a cursor expires, require a fresh bootstrap. An MVP may simply re-fetch active assignments after a successful push instead of maintaining a complex change feed, provided performance is acceptable.

### 11.4 Server processing order

For each incoming operation:

1. Authenticate request and check CSRF/session policy.
2. Validate payload type, size, values, assignment, and allowed status.
3. Look for (`user`, `operationId`) in `sync_operations`.
4. If previously processed, verify the payload hash and return the stored response.
5. Lock the relevant count session/entry or apply an optimistic row-version check.
6. If the session is closed, target is no longer assigned, or base version changed, save a conflict result.
7. Otherwise save the submitted count and its audit record.
8. Save the operation outcome in the **same database transaction** as the accepted count.
9. Return the result. Only after receiving it may the client mark `ACKED`.

Use a server-side transaction to prevent two simultaneous requests from processing the same operation twice. Keep operation outcomes long enough to cover the entire supported offline period and all foreseeable retries. For an MVP, retaining these keys with the underlying count history is simpler and safer than aggressive cleanup.

### 11.5 Required failure scenarios

| Scenario | Required result |
|---|---|
| Device loses connection while saving local count | Count remains in Dexie |
| Upload succeeds but HTTP response is lost | Retry returns previous acknowledgment, no duplicate |
| Same operation ID arrives with modified content | Reject and log request |
| Supervisor closes session before upload | Conflict, preserve local evidence |
| Same item is counted differently on two devices | Two traceable observations or explicit conflict; never silent overwrite |
| User loses permission before syncing | Block submission, preserve local record for administrator review |
| Storage runs out | Clear actionable warning; do not claim save succeeded |
| App restarts while queue has `SENDING` records | Recover and retry with original ID |
| Count is accepted twice through repeated taps | One accepted count per intended submission/version |
| Site is temporarily down | Queue remains; user can retry later |

### 11.6 Counts and live stock changes

A count observation and a stock adjustment are separate records. The count's reference snapshot and any intervening movement must be visible to the reviewer. The first release should use a planned counting window with movement freeze or recorded exceptions (see section 7.7). If business operations cannot accept a freeze, agree on a more detailed movement reconciliation policy before development; do not assume a scanned quantity can replace live stock without checking intervening movements.

---
## 12. API design

Use `/api/v1` for the first release. Keep the endpoint names stable and document them in an OpenAPI file or an equivalent maintained API reference. Validate bodies with Zod. Enforce permissions at the server service layer for every operation. All timestamps are ISO 8601 UTC. Lists use pagination, bounded page sizes, and explicit filters.

### 12.1 Proposed endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Start authenticated session |
| `POST` | `/api/v1/auth/logout` | End authenticated session |
| `GET` | `/api/v1/me` | Current user, role, authorized locations |
| `GET/POST` | `/api/v1/users` | List/create users (admin) |
| `PATCH` | `/api/v1/users/:id` | Edit/disable account (admin) |
| `GET/POST` | `/api/v1/items` | Search/create items |
| `GET/PATCH` | `/api/v1/items/:id` | Item details and edits |
| `POST` | `/api/v1/items/import` | Validate/commit CSV import |
| `GET/POST` | `/api/v1/assets` | Asset registry |
| `GET/PATCH` | `/api/v1/assets/:id` | Asset details and permitted edits |
| `GET/POST` | `/api/v1/locations` | Manage locations |
| `GET` | `/api/v1/stock/balances` | Current stock filtered by location/item |
| `POST` | `/api/v1/stock/receipts` | Confirm stock receipt |
| `POST` | `/api/v1/stock/issues` | Confirm stock issue |
| `POST` | `/api/v1/stock/transfers` | Confirm transfer |
| `GET` | `/api/v1/stock/movements` | Audit movement ledger |
| `GET/POST` | `/api/v1/count-sessions` | List/create counting assignments |
| `GET` | `/api/v1/count-sessions/:id` | Session scope and progress |
| `POST` | `/api/v1/count-sessions/:id/submit` | Submit online counting results |
| `POST` | `/api/v1/count-sessions/:id/recount` | Request recount |
| `POST` | `/api/v1/count-sessions/:id/reconcile` | Review/approve an adjustment |
| `GET/POST` | `/api/v1/borrowings` | List/create borrowing drafts |
| `POST` | `/api/v1/borrowings/:id/release` | Confirm asset release |
| `POST` | `/api/v1/borrowings/:id/returns` | Confirm full/partial returns |
| `GET/POST` | `/api/v1/transmittals` | List/create handover drafts |
| `POST` | `/api/v1/transmittals/:id/confirm` | Confirm handover, if authorized |
| `GET` | `/api/v1/documents/:id` | Document metadata and access checks |
| `GET` | `/api/v1/documents/:id/pdf` | Download confirmed PDF |
| `GET` | `/api/v1/reports/:reportKey` | Filtered report or CSV download |
| `GET` | `/api/v1/audit-events` | Authorized audit history |
| `GET` | `/api/v1/sync/bootstrap` | Download assigned offline scope |
| `POST` | `/api/v1/sync/push` | Idempotent offline operation upload |
| `GET` | `/api/v1/sync/changes` | Refresh local assigned data |
| `GET` | `/api/health` | Non-sensitive application health |

The `:id` syntax above describes routes; implement it in the Next.js folder structure as appropriate. Some operations may be grouped differently after the API contract is reviewed, but behavior and authorization must remain unchanged.

### 12.2 Example: stock issue

```json
POST /api/v1/stock/issues
Idempotency-Key: 2bc037d1-b3ed-4e3d-9b76-c1c371e6fd09

{
  "locationId": "LOCATION-UUID",
  "recipientName": "Juan Dela Cruz",
  "purpose": "Site repair",
  "lines": [{"itemId": "ITEM-UUID", "quantity": 5}],
  "notes": "Work order 103"
}
```

Response after successful confirmation:

```json
{
  "id": "TXN-UUID",
  "reference": "ISS-2026-000123",
  "status": "CONFIRMED",
  "lines": [{"itemId": "ITEM-UUID", "quantity": 5}],
  "documentStatus": "PENDING_GENERATION"
}
```

`documentStatus` may become `READY` after the server generates the PDF. Document generation failure must not reverse a committed stock movement. The user should be able to retry document generation safely without issuing stock again.

### 12.3 Errors and safe behavior

| HTTP status | Meaning | Client action |
|---|---|---|
| `400` / `422` | Invalid input | Correct highlighted fields |
| `401` | Not signed in or expired login | Sign in again, do not discard local drafts |
| `403` | No permission | Stop action and show appropriate message |
| `404` | Record not found or not visible | Show not found without exposing hidden records |
| `409` | Stock conflict, asset unavailable, outdated version | Refresh/review; never auto-overwrite |
| `429` | Too many requests | Wait and retry according to server guidance |
| `500` / `503` | Server problem or unavailable | Preserve outbox, retry safely later |

Use a consistent error shape, for example `{"code":"INSUFFICIENT_STOCK","message":"Only 3 units are available","requestId":"..."}`. Do not return stack traces, SQL queries, or internal paths to users.

### 12.4 Request limits

- Limit batch sizes in `/sync/push`; start with no more than 50 operations per request and tune after testing.
- Enforce input length, numeric range, and file size limits.
- Apply rate limits to login, password reset, and sensitive transaction endpoints.
- Require an idempotency key for online stock and release/return confirmations as well as offline submissions.
- Use server-generated transaction references, never client-provided official numbers.

---

## 13. Printable forms and PDF requirements

### 13.1 Form types

| Form | Trigger | Purpose |
|---|---|---|
| Remittal / Transmittal | Confirmed handover or transfer | Record sender, receiver, and transferred items |
| Equipment Borrowing | Confirmed asset release | Record borrower, borrowed assets, condition, due date |
| Stock Issuance | Confirmed consumable issue | Record issued stock and recipient |
| Return Acknowledgment | Confirmed asset return | Record returned asset, condition, date, and receiver |

Do not build a generic document designer. Build four controlled templates whose fields are populated from the actual transactions. If existing company templates are provided, use them as the design source and preserve their required wording and logos.

### 13.2 Shared fields

- Company name, logo, address if required
- Form title and template version
- Unique official document reference and issuance date/time
- Person who prepared the transaction
- Sending and receiving person or location
- Purpose, remarks, and related transaction ID/reference
- Multiple item rows with code, description, quantity/unit or asset tag
- Prepared by, released by, received by, approved by as applicable
- Signature lines and dates for physical signatures
- Page number and continuation notice on multi-page forms

The following fields depend on form type:

**Borrowing:** borrower name/department, individual asset tags, model/serial number if needed, initial condition, accessories, due date, release authorization, borrower acknowledgment.

**Return:** original borrowing reference, item/asset tags, received quantity or asset identity, return date, return condition, missing/damaged items, receiving signature.

**Stock issuance:** source location, stock item, issued quantity, unit, recipient, purpose, authorization.

**Remittal/transmittal:** sender, receiver, source and destination, item or asset listing, reason, acknowledgment.

### 13.3 Form lifecycle

```text
DRAFT -> SUBMITTED / REVIEWED -> CONFIRMED -> PDF READY
                      |                |
                      |                +-> PDF FAILED (retry document only)
                      +-> REJECTED (not official)
```

Official numbering occurs only when the underlying authorized transaction is confirmed. A draft preview must contain a visible `DRAFT` watermark and no official number. Voided confirmed documents retain their numbers and remain visible in history with a void reason; numbers are not recycled.

### 13.4 PDF generation steps

1. User fills in a form or opens a confirmed transaction.
2. The API validates source records, user permission, and approval status.
3. Database transaction confirms business event and allocates a unique document number.
4. Save an immutable document snapshot with template version and exact printable values.
5. Generate the PDF from that snapshot using `pdf-lib`.
6. Store it in a private directory/volume or controlled object storage, with checksum and path in `pdf_documents`.
7. Permit secure download, print, or regeneration from the unchanged snapshot if document generation failed.

Only authorized people may download documents. Do not serve private PDFs from Next.js `public/` or an unrestricted NGINX directory.

### 13.5 File naming and numbering

Proposed references, subject to actual company numbering rules:

- `BOR-2026-000001` for borrowing
- `RET-2026-000001` for returns
- `ISS-2026-000001` for stock issuance
- `TRN-2026-000001` for transmittal/remittal

Example filename: `BOR-2026-000001_Equipment_Borrowing.pdf`.

Allocate numbers transactionally in PostgreSQL to prevent collisions during concurrent requests. The document should contain a readable reference and, optionally, a QR that leads an authenticated user to the matching record. Do not expose a public verification endpoint without approval.

### 13.6 Layout and print checks

- A4 is the proposed primary size. Test Letter if the company uses it.
- Use approved logo and company header.
- Fonts must display names and local characters correctly. Embed fonts when needed.
- Long item lists flow onto additional pages with repeated headings and page numbers.
- No cut-off text, misaligned signatures, missing quantities, or blank last pages.
- PDF opens in common desktop and phone viewers.
- Print at 100% scale and verify signatory spaces on paper.
- Reprinting the same document must show the same official details; revised documents require a controlled new version/correction.
- PDF is evidence of a transaction, not a substitute for the stored database record.

### 13.7 Failure and recovery

If stock issue or asset release has already committed but PDF rendering fails, keep the official transaction and document number, mark the document `PDF_FAILED`, and permit authorized retry. Never create a second stock movement merely to regenerate the form. Log failures without exposing personal data or raw document content.

---

## 14. Project layout and development conventions

Suggested single repository:

```text
ims/
  app/
    (admin)/
    (field)/
    api/v1/
    manifest.ts
  components/
    common/
    admin/
    field/
  lib/
    auth/
    permissions/
    db/
    inventory/
    assets/
    counts/
    sync/
    pdf/
    validation/
  offline/
    dexie-db.ts
    outbox.ts
    sync-client.ts
  prisma/
    schema.prisma
    migrations/
    seed.ts
  public/
    icons/
    offline.html
  infrastructure/
    nginx/
    scripts/
  tests/
    unit/
    integration/
    e2e/
    fixtures/
  docs/
    api.md
    deployment.md
    backup-restore.md
    field-guide.md
  Dockerfile
  compose.yaml
  compose.dev.yaml
  .env.example
  README.md
```

The exact Next.js folder organization can differ, but keep business rules out of screen components. Count submission, stock movement, asset release, and PDF document logic should be implemented in server-side services with tests. Keep client offline code isolated from server-only modules.

### Code standards

- TypeScript strict mode; ESLint; code formatting checks.
- Consistent API error codes and request IDs.
- Database schema changes only through reviewed migrations.
- Every business state change has an audit event.
- Centralized authorization checks and typed request validation.
- Automated tests for stock and asset state transitions.
- No passwords, database dumps, certificates, or production `.env` files committed to the repository.
- Document any change to agreed behavior before merging it.

---

## 15. Docker, NGINX, and Hostinger VPS

### 15.1 Production services

Run at least three containers on one private Compose network:

1. `nginx`: public ports 80 and 443, SSL termination, forwarding to `web`.
2. `web`: production Next.js Node server on internal port 3000.
3. `db`: PostgreSQL on private port 5432 with a named persistent volume.

A separate scheduled backup process is required. The container itself is disposable; its data is not. Store documents in a backed-up private volume if keeping generated PDF files.

### 15.2 Starting resource estimate

For a small pilot, start with **at least 2 vCPU and 4 GB RAM**, with **8 GB RAM preferred** when application, PostgreSQL, reverse proxy, and backups share a VPS. These are planning estimates, not capacity guarantees. Verify the actual Hostinger plan, concurrent users, attachment volume, operating system, and load-test results before purchase or deployment. Leave room for database growth and backups.

### 15.3 Illustrative Compose configuration

This is a **starting structure**, not a complete production deployment. Add hardened images, secrets, a working certificate process, migration steps, log limits, backup jobs, and tested health checks before launch.

```yaml
services:
  nginx:
    image: nginx:stable-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./infrastructure/nginx/conf.d:/etc/nginx/conf.d:ro
      - ./infrastructure/nginx/certs:/etc/nginx/certs:ro
    depends_on:
      - web
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      NODE_ENV: production
      DATABASE_URL: ${DATABASE_URL:?required}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    # No public ports. Expose only to the Compose network.

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: ims
      POSTGRES_USER: ims_app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    # No public database ports.

volumes:
  pg_data:
```

Keep runtime credentials in restricted VPS-managed configuration and prefer Docker secrets for production where supported. Do not keep actual passwords in committed Compose files. The PostgreSQL image and major version must be selected and tested with the chosen Prisma version. The database URL must point to the Compose service name `db`, not `localhost` inside the `web` container.

**Note:** The example mounts an SSL certificate directory but does not create certificates. Implement and document initial issuance and automatic renewal, for example an ACME/Certbot process using a webroot served by NGINX. Validate HTTP challenge access, configure redirects only after certificate bootstrapping, and reload NGINX after renewal.

### 15.4 NGINX reverse proxy example

Once valid certificates are installed and mapped into the container, a baseline virtual host could resemble:

```nginx
server {
    listen 80;
    server_name ims.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ims.example.com;
    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    client_max_body_size 8m;

    location / {
        proxy_pass http://web:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

Replace the example domain and certificate paths. This snippet omits the initial ACME challenge location and several hardening details intentionally. Verify forwarded headers, cookie security, timeouts, cache rules, security headers, and real client IP configuration against the final VPS setup. Do not cache private API responses at the proxy.

### 15.5 Development and production parity

- Use the same Node.js major LTS version and PostgreSQL major version in development and production.
- Build the application with a multi-stage Dockerfile, then deploy a tested image.
- Use a separate development Compose override for hot reload and local database access when needed.
- Keep separate secrets, databases, and volumes for local, staging, and production.
- Run Prisma migrations as a controlled one-off deployment step before switching traffic to the new app. Back up first and test migration/rollback implications.
- Never use `prisma db push` as a replacement for reviewed production migrations.
- Use seeded test users, sample stock and assets only in non-production environments.

### 15.6 First VPS setup checklist

1. Create a Linux VPS, domain DNS record, and a restricted deploy account.
2. Use SSH keys, disable password SSH access where appropriate, and keep system packages updated.
3. Configure firewall access only for SSH and web ports; restrict SSH by IP if feasible.
4. Install Docker Engine and Compose plugin following supported Linux instructions.
5. Prepare directories and access-controlled environment configuration.
6. Verify the database volume survives container replacement.
7. Build/deploy images, run migrations, and execute health checks.
8. Issue HTTPS certificate and configure automatic renewal.
9. Set up encrypted off-server backups and alerting for backup failures.
10. Confirm restore procedure on an isolated environment.
11. Complete production smoke tests on real supported phones.

### 15.7 Backups, retention, and monitoring

- Run scheduled PostgreSQL logical backups (for example `pg_dump`) and keep an encrypted copy **outside** the VPS.
- Back up the private document volume if PDFs are stored as files; retain document snapshots so failed or missing files can be regenerated.
- Define retention with the company. A proposed starting point is daily backups for 14 days and weekly backups for 8 weeks, subject to legal and operational requirements.
- Test a complete restoration at least before go-live and on a recurring schedule afterward.
- Monitor disk space, database health, available memory, HTTP error rates, TLS expiry, backups, and failed sync operations.
- Use log rotation and avoid logging passwords, full personal details, or document contents.
- Write a deployment and rollback procedure. A rollback must account for database schema changes, not only changing the container image.

---
## 16. Security and access controls

### Authentication and sessions

- Use a maintained server-side authentication solution, such as Auth.js or another reviewed equivalent, rather than implementing session security from scratch.
- Hash passwords with an appropriate modern password-hashing function if local passwords are used.
- Use secure, HTTP-only cookies for authenticated browser sessions, with suitable SameSite and CSRF protection.
- Force HTTPS in production. Regenerate sessions when privilege changes and terminate sessions on logout. If pending local counts exist, warn clearly and require a deliberate safe handling choice before clearing their local data.
- Enforce account deactivation on the server even if a device has cached its old assignments.
- Provide password reset through a verified, time-limited process. Do not send passwords in email.

### Authorization and data safety

- Apply role **and** assigned-location checks on all reads and writes.
- Prevent guessing another user's PDF URL or session ID from revealing information.
- Validate item, location, asset, and transaction relationships server-side, not only in the interface.
- Restrict CSV imports and downloads to authorized roles.
- Escape user text placed into PDFs and CSVs appropriately. Reject unsupported file types and unsafe filenames.
- Keep PostgreSQL private; use least-privilege database accounts and separate migration credentials if feasible.
- Audit important changes, approvals, failed authorization checks, and administrative actions.
- Keep logs and backed-up documents access-controlled.

### Field-device risk

The PWA keeps a local copy of some inventory information. It cannot offer the same storage guarantees as a centrally managed server. Minimize personal details on the device, require reauthentication before synchronizing, isolate local storage per user, and train staff not to clear browser storage while work is pending. If offline use on shared or unmanaged phones is sensitive, require company-approved devices or reconsider a native managed app in a later phase.

### Minimum security review before release

Test unauthorized access to records, altered prices or quantities (if later added), cross-location access, replayed transactions, duplicate requests, CSRF, broken session expiry, PDF downloads, file path traversal, and injection in search/import inputs. Use OWASP ASVS and the current OWASP Top 10 as a review checklist. Run dependency and container image scans before deployment.

---

## 17. Testing method and acceptance criteria

Use automated tests for business rules and direct tests on the actual field devices. A screen that looks correct is not enough. Verify the resulting database records and documents.

### Recommended tools

- **Vitest** or equivalent for validation, calculations, and status-transition unit tests
- **Integration tests with a temporary PostgreSQL database** for real transactions and constraints
- **Playwright** for desktop/mobile browser end-to-end tests and form flows
- **Real Android and iPhone devices** for camera scanning, installation, offline storage, and app restarts
- **Lighthouse and accessibility checks** for the PWA and field screens
- **k6 or an equivalent load tool** for concurrent stock actions and sync traffic
- **`pg_dump` / `pg_restore`** in an isolated environment for recovery tests
- **Docker health checks, log review, and basic monitoring** for deployment tests

### Acceptance test list

| ID | Test | Expected result |
|---|---|---|
| A01 | Admin creates SKU and assigns item to a location | Item searchable; duplicate SKU rejected |
| A02 | Admin creates five identical model assets | Five separate unique tags and histories |
| A03 | Supervisor receives 10 units at Warehouse A | Balance increases by 10; ledger and audit match |
| A04 | Two users try to issue the last 3 units at the same time | Only permitted quantity issues; no negative stock |
| A05 | Transfer 7 units from A to B | A decreases 7; B increases 7; both ledger entries share one reference |
| A06 | Transfer fails during database transaction | Neither balance changes |
| A07 | Borrow an available drill | Asset becomes borrowed, borrower recorded, PDF generated |
| A08 | Two supervisors try to borrow the same drill | Only one release succeeds |
| A09 | Partially return two of three borrowed assets | Two lines closed; third remains on loan |
| A10 | Return a damaged asset | Status becomes needs review/maintenance, not available |
| A11 | Scan QR, Code 128, EAN-13, and UPC-A on pilot phones | Correct item/asset or clear unsupported message |
| A12 | Scan same count item twice | Existing count opens; quantity is not silently doubled |
| A13 | Download count session, disconnect, record at least 100 lines | All counts saved locally and editable without internet |
| A14 | Force-close and reopen PWA while offline | All saved counts remain accessible |
| A15 | Restore connection and tap Sync Now | Server acknowledges each count; queue clears only for acknowledged entries |
| A16 | Drop network after server processes upload but before response | Retry does not duplicate count or movement |
| A17 | Submit same operation UUID with changed payload | Operation rejected without overwriting original |
| A18 | Two devices submit conflicting counts | Conflict or separate reviewed observations; no silent last-write-wins |
| A19 | Close session before an offline upload arrives | Submission preserved as conflict; no adjustment applied |
| A20 | Approve one variance line | Exactly one auditable stock adjustment posted |
| A21 | Repeat an approval request | No duplicate adjustment |
| A22 | Field user tries to finalize stock issue through API | Permission denied; balance unchanged |
| A23 | Field user requests another site's records | Access denied; no protected data returned |
| A24 | Generate all four PDFs, including 30-row document | Correct details, page breaks, signatures, and readable print |
| A25 | PDF rendering fails after confirmed issue | Transaction remains confirmed; PDF can be regenerated without duplicate issue |
| A26 | Restore latest backed-up DB and documents to test server | Data, relationships, and printable records match backup scope |
| A27 | Replace/restart PostgreSQL container | Data remains present through persistent volume |
| A28 | Change a user role while device is offline | Unauthorized operation is rejected after reconnect |
| A29 | Browser denies camera permission | Manual code entry works and user gets clear instructions |
| A30 | Browser storage is full or disabled | Error is visible; app never claims count was saved |

### Pilot criteria

- All critical tests A01 through A30 pass or have an approved, documented exception that does not compromise stock accuracy or data safety.
- Test on at least one company-representative Android phone with Chrome and one supported iPhone using Safari/Home Screen installation. Expand the device list based on actual field equipment.
- A complete count session with at least 100 mixed stock and asset observations can be performed without connectivity and synchronized without missing or duplicated records.
- Reconciliation must match the known physical test inventory after documented approvals.
- Each official PDF must match the approved company template and print clearly on the selected paper size.
- The application can be deployed from the repository to an empty test environment using documented steps.
- A complete off-server backup and restore is witnessed and verified.
- Supervisors and field staff can complete the primary workflows with the provided instructions.

Record test date, device/browser version, tester, expected result, actual result, evidence, and defect reference. Do not mark a test passed based only on a developer demonstration.

---

## 18. Implementation plan

Estimated effort for **one experienced full-stack developer: 10 to 14 weeks** for a properly tested pilot, assuming source forms and sample inventory data are available on time. This is a planning estimate, not a delivery commitment. Re-estimate after requirements verification and initial technical tests.

| Phase | Target window | Work | Exit condition |
|---|---|---|---|
| 0. Verify workflows | Week 1 | Review real stock records, borrowing/remittal forms, permissions, devices, and VPS | Signed-off examples and open decisions listed |
| 1. Foundation | Weeks 2-3 | Repository, Docker dev environment, schema, migrations, authentication, roles | Local stack works; basic authorization tests pass |
| 2. Stock and assets | Weeks 4-5 | Items, locations, stock ledger, transfers, asset register, labels | Movement and asset state tests pass |
| 3. Field PWA | Weeks 6-7 | PWA shell, scanner, offline assignments, Dexie drafts | Real devices save and reopen offline counts |
| 4. Synchronization and counts | Weeks 8-9 | Outbox, server idempotency, conflicts, review, adjustments | Failure cases and two-device tests pass |
| 5. Borrowing and PDFs | Weeks 10-11 | Loan, partial returns, forms, official numbering and rendering | Concurrent borrowing and PDF tests pass |
| 6. Hardening and pilot | Weeks 12-14 | Reports, security, QA, backup restore, HTTPS, VPS deployment, training | Acceptance checklist and pilot sign-off |

Some tasks can overlap. Do not compress the offline/reconciliation tests merely to meet a target date.

### Phase-by-phase deliverables

**Phase 0:** process examples, sample form templates, screen sketches, permission matrix, approved inventory numbering conventions, confirmed browser support list.

**Phase 1:** README, running Docker Compose, Prisma migration history, seed data, authentication and permission tests, first admin screens.

**Phase 2:** stock movement ledger, asset history, QR labels, CSV import, integration tests under concurrent requests.

**Phase 3:** installable PWA, Dexie schema/versioning, offline predownload, camera and manual scan workflows, device test report.

**Phase 4:** `/sync` routes, idempotency records, conflict UI, counting review, approved adjustment records, sync test evidence.

**Phase 5:** borrowing and returns, four form templates, official document sequences, secure PDF downloads, printable sample documents.

**Phase 6:** production Compose and NGINX config, domain/HTTPS, backup automation and restore record, reports, security checklist, UAT results, user guides, and final deployment instructions.

### Development practice

At the end of each phase, demonstrate work against the relevant test records, not a slide presentation. Keep defects in a shared issue tracker and prioritize problems that affect stock accuracy, asset custody, offline data retention, authorization, or production recovery. Fix critical defects before adding optional screens.

---

## 19. Deliverables at completion

The repository and project folder must contain:

- [ ] Complete readable source code with branch/release tags
- [ ] Dependency lockfile and supported runtime versions
- [ ] Dockerfile, production and development Compose files
- [ ] NGINX configuration and documented TLS renewal procedure
- [ ] `.env.example` without real credentials
- [ ] Database schema, migrations, and sample seed data
- [ ] API reference with example requests, responses, and error codes
- [ ] Role and location permission matrix
- [ ] Dexie schema, offline update notes, and sync failure behavior
- [ ] PWA install and camera permission instructions
- [ ] QR/barcode label template and sample print sheet
- [ ] Four approved PDF layouts and sample completed PDFs
- [ ] Automated tests and full pilot test report
- [ ] Backup job configuration and successful restore record
- [ ] Deployment, rollback, and recovery runbook
- [ ] Short administrator, supervisor, and field user guides
- [ ] Known issues, limitations, and future work list
- [ ] Documented procedure for rotating credentials and transferring server access

No real passwords or private keys should be included in the repository or written into the turnover document. Transfer them separately through an authorized password or secrets manager.

---

## 20. Information that still requires confirmation

These are **business-specific facts not supplied yet**. The approved architecture can be developed in preparation, but the affected workflows or final templates cannot be declared correct until these questions are answered.

| Decision | Why it matters | Temporary working assumption |
|---|---|---|
| Actual remittal/transmittal form | Determines official wording, sections, and signatories | Standard handover form; replace with approved template |
| Borrowing and return form samples | Confirms legal wording, signatures, accessories, approvals | Standard equipment loan and return acknowledgment |
| Inventory list/Excel sample | Establishes SKUs, categories, units, duplicates, and imports | Manual seed data plus CSV import |
| Real location hierarchy | Defines assignment and stock transfer scope | Warehouse / site / area hierarchy |
| Numbering conventions | Must match current company document process | `BOR`, `RET`, `ISS`, `TRN` plus year and sequence |
| Who may approve releases and adjustments | Determines role rules | Admin and assigned supervisor |
| Who signs printed documents | Determines PDF field positions | Prepared, released, received, approved as applicable |
| Meaning of asset custody at external sites | Affects location and borrower state | Custody tracked separately from physical location |
| Counting freeze policy | Prevents inaccurate variance adjustments | Schedule short freeze; exception requires recount/review |
| Decimal or whole-number quantities | Affects arithmetic and validation | Whole numbers unless real units require decimals |
| Android and iPhone models | Determines camera and offline support | Modern Chrome on Android; Safari/Home Screen on iPhone |
| Maximum time without connectivity | Determines queue retention, assignment validity, and staff procedure | Pilot test one full workday offline; support longer only after testing |
| Number of users and simultaneous field staff | Affects capacity and load testing | Small pilot, verify actual counts |
| Hostinger VPS plan and OS | Confirms memory, CPU, storage, backups, Docker support | Linux KVM VPS with suitable resources |
| Document retention policy | Determines backup size and deletion restrictions | Retain official transaction history; agree on legal periods |
| Domain, logo, company details | Needed for SSL and form layout | Use placeholders in development |

**Before development starts:** obtain at least one real example for each form and one sanitized inventory export. Review those with a person responsible for inventory. If unavailable, use clearly labeled sample data and hold PDF/business-rule acceptance until the originals are provided.

---

## 21. Release checklist

### Ready for internal pilot

- [ ] Actual workflows and form templates reviewed
- [ ] Role and location access tested
- [ ] Item and asset imports checked for duplicate identifiers
- [ ] All stock actions produce balanced, auditable database results
- [ ] Asset borrowing and returns preserve custody history
- [ ] QR and barcode scanning work on representative field phones
- [ ] PWA opens downloaded assignments offline
- [ ] Dexie saves drafts and survives normal app restarts
- [ ] Duplicate, delayed, and conflicting sync submissions handled safely
- [ ] Approval cannot silently overwrite live stock
- [ ] All four approved PDFs print correctly
- [ ] HTTPS and NGINX reverse proxy configured
- [ ] Database and documents recover from off-VPS backup
- [ ] Critical test cases passed and recorded
- [ ] Pilot users trained on `Sync Now` and pending count warnings

### Ready for wider use

- [ ] Real pilot inventory matches physical sample and ledger
- [ ] Critical pilot defects fixed
- [ ] Capacity and disk usage reviewed against pilot results
- [ ] Backup alerting, restoration owner, and maintenance procedure assigned
- [ ] Documentation, credentials, and server access transferred securely
- [ ] Release version tagged and rollback procedure tested

---

## 22. Reference documentation

The following are official or project-maintained sources to consult when implementing the system. Confirm version compatibility and browser behavior against the project's chosen release versions.

- [Next.js deployment methods](https://nextjs.org/docs/app/getting-started/deploying)
- [Next.js self-hosting and reverse proxy guidance](https://nextjs.org/docs/app/guides/self-hosting)
- [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Next.js static export limitations](https://nextjs.org/docs/app/guides/static-exports)
- [Capacitor installation and web bundle requirements](https://capacitorjs.com/docs/getting-started)
- [Dexie React and IndexedDB guide](https://dexie.org/docs/Tutorial/React)
- [Dexie storage persistence considerations](https://dexie.org/docs/StorageManager)
- [MDN: Background Synchronization support](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- [MDN: Requesting persistent storage](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
- [MDN: Camera access and HTTPS](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [ZXing browser scanner](https://github.com/zxing-js/browser)
- [pdf-lib PDF form documentation](https://pdf-lib.js.org/docs/api/classes/pdfform)
- [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)
- [NGINX proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [PostgreSQL official documentation](https://www.postgresql.org/docs/)
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)

---

## Final scope statement

The first release is a **single Next.js inventory application** with a field PWA. PostgreSQL in Docker is the official database; Dexie and IndexedDB handle offline work on field devices; NGINX serves the application securely on Hostinger KVM VPS. Stock balances and asset custody are changed only through authorized server transactions. Physical counts can be gathered offline and synchronized for review. Borrowing, returns, and remittal/issuance documents can be completed in the app and printed as official PDFs after confirmation.

**Capacitor is not part of the MVP.** Add it later only when real device testing or an approved operational requirement justifies a native mobile package.

This document is ready to guide implementation planning. The final business forms, policies, device support, and pilot data must still be verified against actual company records before release approval.
