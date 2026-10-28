-- CreateEnum
CREATE TYPE "SyncResult" AS ENUM ('ACKED', 'CONFLICT', 'REJECTED');

-- CreateEnum
CREATE TYPE "CountDecision" AS ENUM ('APPROVED', 'KEPT_EXPECTED');

-- AlterTable
ALTER TABLE "count_session_items" ADD COLUMN     "recount_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "snapshot_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "sync_operations" (
    "user_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "device_id" VARCHAR(64),
    "type" VARCHAR(40) NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "result" "SyncResult" NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("user_id","operation_id")
);

-- CreateTable
CREATE TABLE "count_reviews" (
    "id" UUID NOT NULL,
    "session_item_id" UUID NOT NULL,
    "decision" "CountDecision" NOT NULL,
    "entry_id" UUID,
    "expected_quantity" INTEGER,
    "counted_quantity" INTEGER,
    "variance" INTEGER,
    "adjustment_transaction_id" UUID,
    "notes" VARCHAR(500),
    "reviewer_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "count_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_operations_created_at_idx" ON "sync_operations"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "count_reviews_session_item_id_key" ON "count_reviews"("session_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "count_reviews_adjustment_transaction_id_key" ON "count_reviews"("adjustment_transaction_id");

-- AddForeignKey
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_reviews" ADD CONSTRAINT "count_reviews_session_item_id_fkey" FOREIGN KEY ("session_item_id") REFERENCES "count_session_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_reviews" ADD CONSTRAINT "count_reviews_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "count_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_reviews" ADD CONSTRAINT "count_reviews_adjustment_transaction_id_fkey" FOREIGN KEY ("adjustment_transaction_id") REFERENCES "stock_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_reviews" ADD CONSTRAINT "count_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written rules (spec §9.3, §11.1)
-- ---------------------------------------------------------------------------
-- A stored sync outcome is evidence: never changed or deleted.
CREATE TRIGGER sync_operations_append_only
  BEFORE UPDATE OR DELETE ON "sync_operations"
  FOR EACH ROW EXECUTE FUNCTION ims_block_audit_mutation();

-- A review decision is final (a new count needs a recount request first, which happens before review).
CREATE TRIGGER count_reviews_append_only
  BEFORE UPDATE OR DELETE ON "count_reviews"
  FOR EACH ROW EXECUTE FUNCTION ims_block_audit_mutation();

-- An approved non-zero stock variance must point at its adjustment; "keep expected" never posts one.
ALTER TABLE "count_reviews"
  ADD CONSTRAINT "count_reviews_approved_variance_has_adjustment"
    CHECK ("decision" <> 'APPROVED' OR "variance" IS NULL OR "variance" = 0 OR "adjustment_transaction_id" IS NOT NULL),
  ADD CONSTRAINT "count_reviews_kept_has_no_adjustment"
    CHECK ("decision" <> 'KEPT_EXPECTED' OR "adjustment_transaction_id" IS NULL);
