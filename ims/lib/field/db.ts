import Dexie, { type Table } from "dexie";

/**
 * The field device's local database (spec §10.3). One database per signed-in
 * user (`ims-field-<userId>`), so a shared phone never mixes people's work.
 * Holds no passwords, session tokens, or expected quantities.
 */
export type AssignmentRec = {
  id: string;
  reference: string;
  name: string;
  status: string;
  dueAt: string | null;
  notes: string | null;
  location: { id: string; code: string; name: string };
  serverVersion: number;
  targetCount: number;
  downloadedAt: string;
  serverTime: string;
};

/** One thing to count: a stock item (quantity) or one tagged asset (found / not found). */
export type TargetRec = {
  id: string;
  sessionId: string;
  kind: "STOCK" | "ASSET";
  version: number;
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  assetId: string | null;
  tag: string | null;
  serialNumber: string | null;
  /** Last-synced values, for display only. */
  lastStatus: string | null;
  lastCondition: string | null;
};

export type IdentifierRec = { sessionId: string; code: string; targetId: string };

export type Condition = "GOOD" | "FAIR" | "DAMAGED";

/** One consolidated count per user/session/target (id = `${sessionId}:${targetId}`). */
export type CountDraft = {
  id: string;
  sessionId: string;
  targetId: string;
  kind: "STOCK" | "ASSET";
  quantity: number | null;
  found: boolean | null;
  condition: Condition | null;
  notes: string;
  baseVersion: number;
  createdAt: string;
  updatedAt: string;
  saveCount: number;
};

/** §11.2 states, plus REJECTED (no permission / invalid) kept apart from CONFLICT (closed / recount). */
export type OutboxStatus = "PENDING" | "SENDING" | "ACKED" | "CONFLICT" | "REJECTED" | "FAILED";

/** What the server said about a count it didn't accept. */
export type OutboxResult = { code: string; message: string; nextAction: string; serverVersion?: number };

/**
 * One frozen upload (spec §11.1–11.2). `payload` is exactly what is sent, under
 * a UUID made once on this device; it is never changed after creation. Never
 * discarded until acknowledged or deliberately resolved.
 */
export type OutboxOperation = {
  operationId: string;
  userId: string;
  sessionId: string;
  targetId: string;
  /** The count draft this was made from, and which save of it. */
  draftId: string;
  draftSaveCount: number;
  type: "SUBMIT_COUNT";
  payload: unknown;
  baseVersion: number;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  /** Send order (strictly increasing on this device). */
  seq: number;
  sentAt?: string;
  ackedAt?: string;
  lastError?: string;
  result?: OutboxResult;
};

export type SyncMeta = {
  id: "meta";
  userId: string;
  deviceId: string;
  schemaVersion: number;
  lastDownloadAt?: string;
  lastSyncAt?: string;
};
export type InboxConflict = { operationId: string; sessionId: string; message: string; nextAction: string };

/** A borrowing request prepared on the phone (§7.5 step 1). Not official until a supervisor releases it. */
export type BorrowDraftStatus = "DRAFT" | "SENDING" | "SENT" | "REJECTED" | "FAILED";
export type BorrowDraftRec = {
  /** Also the Idempotency-Key, so a resend after a lost reply creates one request. */
  id: string;
  location: { id: string; code: string; name: string };
  borrowerName: string;
  borrowerDept: string;
  purpose: string;
  tags: string[];
  /** Assets scanned by QR label (the label holds the id, not the tag). */
  assetIds?: { id: string; label: string }[];
  notes: string;
  status: BorrowDraftStatus;
  attempts: number;
  serverId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export class FieldDB extends Dexie {
  assignments!: Table<AssignmentRec, string>;
  targets!: Table<TargetRec, string>;
  identifiers!: Table<IdentifierRec, [string, string]>;
  countDrafts!: Table<CountDraft, string>;
  outbox!: Table<OutboxOperation, string>;
  syncMeta!: Table<SyncMeta, string>;
  inboxConflicts!: Table<InboxConflict, string>;
  borrowDrafts!: Table<BorrowDraftRec, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      assignments: "id, downloadedAt",
      targets: "id, sessionId, [sessionId+kind]",
      identifiers: "[sessionId+code], code, targetId",
      countDrafts: "id, sessionId, targetId, updatedAt",
      outbox: "operationId, userId, sessionId, status, createdAt",
      syncMeta: "id",
      inboxConflicts: "operationId, sessionId",
    });
    // Phase 4: outbox rows know their draft and their send order.
    this.version(2).stores({
      outbox: "operationId, userId, sessionId, status, createdAt, draftId, seq",
    });
    // Phase 5: borrowing requests prepared in the field.
    this.version(3).stores({ borrowDrafts: "id, status, updatedAt" });
  }
}

export const fieldDbName = (userId: string) => `ims-field-${userId}`;

/** Browser-only. Create after identifying the signed-in user. */
export function makeFieldDB(userId: string) {
  return new FieldDB(fieldDbName(userId));
}
