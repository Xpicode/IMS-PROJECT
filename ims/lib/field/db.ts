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

export type OutboxStatus = "PENDING" | "SENDING" | "ACKED" | "CONFLICT" | "FAILED";

/** Filled by "Submit count" in Phase 4. Never discarded until acknowledged or resolved. */
export type OutboxOperation = {
  operationId: string;
  userId: string;
  sessionId: string;
  type: "SUBMIT_COUNT";
  payload: unknown;
  baseVersion: number;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  lastError?: string;
};

export type SyncMeta = { id: "meta"; userId: string; deviceId: string; schemaVersion: number; lastDownloadAt?: string };
export type InboxConflict = { operationId: string; sessionId: string; message: string; nextAction: string };

export class FieldDB extends Dexie {
  assignments!: Table<AssignmentRec, string>;
  targets!: Table<TargetRec, string>;
  identifiers!: Table<IdentifierRec, [string, string]>;
  countDrafts!: Table<CountDraft, string>;
  outbox!: Table<OutboxOperation, string>;
  syncMeta!: Table<SyncMeta, string>;
  inboxConflicts!: Table<InboxConflict, string>;

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
  }
}

export const fieldDbName = (userId: string) => `ims-field-${userId}`;

/** Browser-only. Create after identifying the signed-in user. */
export function makeFieldDB(userId: string) {
  return new FieldDB(fieldDbName(userId));
}
