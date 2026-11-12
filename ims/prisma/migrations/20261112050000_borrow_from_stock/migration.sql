-- Remove the "asset" concept. Every item is counted stock; a loan takes a quantity
-- of an item out of stock on release, and returns put it back.

-- 1. Stock moves for loans.
ALTER TYPE "StockTxnType" ADD VALUE 'BORROW';
ALTER TYPE "StockTxnType" ADD VALUE 'RETURN';

-- 2. Every available tagged asset becomes 1 in stock at its location, as one
--    adjustment, so the ledger still adds up to the balances.
DO $$
DECLARE
  txn uuid := gen_random_uuid();
  actor uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM "assets" WHERE "status" = 'AVAILABLE') THEN
    SELECT "id" INTO actor FROM "users" ORDER BY ("role" = 'ADMIN') DESC, "created_at" LIMIT 1;
    INSERT INTO "stock_transactions" ("id", "reference", "type", "reason", "actor_id")
      VALUES (txn, 'ADJ-ASSETS-TO-STOCK', 'ADJUSTMENT', 'Tagged assets became counted stock: 1 per available asset', actor);
    INSERT INTO "stock_balances" ("item_id", "location_id", "quantity", "version", "updated_at")
      SELECT "item_id", "location_id", 0, 1, now() FROM "assets" WHERE "status" = 'AVAILABLE' GROUP BY 1, 2
      ON CONFLICT DO NOTHING;
    WITH n AS (
      SELECT "item_id", "location_id", count(*)::int AS q FROM "assets" WHERE "status" = 'AVAILABLE' GROUP BY 1, 2
    ), upd AS (
      UPDATE "stock_balances" b
      SET "quantity" = b."quantity" + n.q, "version" = b."version" + 1, "updated_at" = now()
      FROM n WHERE b."item_id" = n."item_id" AND b."location_id" = n."location_id"
      RETURNING b."item_id", b."location_id", b."quantity", n.q
    )
    INSERT INTO "stock_movements" ("id", "transaction_id", "item_id", "location_id", "quantity", "balance_after")
      SELECT gen_random_uuid(), txn, "item_id", "location_id", q, "quantity" FROM upd;
  END IF;
END $$;

-- 3. Loans of tagged assets, asset counts and asset tags can't be turned into
--    quantities, so they go. These history tables refuse deletes; the guards are
--    paused for this cleanup only.
ALTER TABLE "return_line_photos" DISABLE TRIGGER "return_line_photos_immutable";
ALTER TABLE "asset_returns" DISABLE TRIGGER "asset_returns_append_only";
ALTER TABLE "pdf_documents" DISABLE TRIGGER "pdf_documents_snapshot_frozen";
ALTER TABLE "count_reviews" DISABLE TRIGGER "count_reviews_append_only";
ALTER TABLE "count_entry_photos" DISABLE TRIGGER "count_entry_photos_immutable";

DELETE FROM "return_line_photos";
DELETE FROM "pdf_documents" WHERE "source_type" IN ('borrowing', 'asset_return');
DELETE FROM "borrowing_lines";
DELETE FROM "asset_returns";
DELETE FROM "borrowings";
DELETE FROM "count_reviews" r USING "count_session_items" t
  WHERE r."session_item_id" = t."id" AND t."kind" = 'ASSET';
DELETE FROM "count_entry_photos" p USING "count_entries" e, "count_session_items" t
  WHERE p."entry_id" = e."id" AND e."session_item_id" = t."id" AND t."kind" = 'ASSET';
DELETE FROM "count_entries" e USING "count_session_items" t
  WHERE e."session_item_id" = t."id" AND t."kind" = 'ASSET';
DELETE FROM "count_session_items" WHERE "kind" = 'ASSET';
DELETE FROM "item_identifiers" WHERE "asset_id" IS NOT NULL;

ALTER TABLE "return_line_photos" ENABLE TRIGGER "return_line_photos_immutable";
ALTER TABLE "asset_returns" ENABLE TRIGGER "asset_returns_append_only";
ALTER TABLE "pdf_documents" ENABLE TRIGGER "pdf_documents_snapshot_frozen";
ALTER TABLE "count_reviews" ENABLE TRIGGER "count_reviews_append_only";
ALTER TABLE "count_entry_photos" ENABLE TRIGGER "count_entry_photos_immutable";

-- 4. Asset columns (their foreign keys, indexes and checks go with them), then tables and types.
ALTER TABLE "item_identifiers" DROP COLUMN "asset_id";
ALTER TABLE "item_identifiers" ADD CONSTRAINT "item_identifiers_one_target"
  CHECK (num_nonnulls("item_id", "location_id") = 1);

ALTER TABLE "count_session_items" DROP COLUMN "asset_id", DROP COLUMN "expected_status", DROP COLUMN "kind";
CREATE UNIQUE INDEX "count_session_items_item_once" ON "count_session_items" ("session_id", "item_id");

ALTER TABLE "count_entries" DROP COLUMN "found", DROP COLUMN "condition";
ALTER TABLE "count_entries" ADD CONSTRAINT "count_entries_has_quantity" CHECK ("quantity" IS NOT NULL);

ALTER TABLE "items" DROP COLUMN "tracking_type";

ALTER TABLE "borrowing_lines"
  DROP COLUMN "asset_id",
  DROP COLUMN "return_id",
  DROP COLUMN "condition_in",
  DROP COLUMN "status_after_return",
  DROP COLUMN "missing_accessories",
  DROP COLUMN "return_notes",
  DROP COLUMN "returned_at",
  ADD COLUMN "item_id" UUID NOT NULL,
  ADD COLUMN "quantity" INTEGER NOT NULL,
  ADD COLUMN "returned_quantity" INTEGER NOT NULL DEFAULT 0;

DROP TABLE "asset_events";
DROP TABLE "assets";
DROP TYPE "TrackingType";
DROP TYPE "AssetStatus";
DROP TYPE "CountTargetKind";
ALTER TYPE "AssetCondition" RENAME TO "Condition";

-- 5. Loan lines: an item and a quantity; the line is back when all of it is.
CREATE INDEX "borrowing_lines_item_id_idx" ON "borrowing_lines"("item_id");
CREATE UNIQUE INDEX "borrowing_lines_borrowing_id_item_id_key" ON "borrowing_lines"("borrowing_id", "item_id");
ALTER TABLE "borrowing_lines" ADD CONSTRAINT "borrowing_lines_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "borrowing_lines"
  ADD CONSTRAINT "borrowing_lines_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "borrowing_lines_returned_in_range" CHECK ("returned_quantity" BETWEEN 0 AND "quantity"),
  ADD CONSTRAINT "borrowing_lines_returned_when_all_back" CHECK (("status" = 'RETURNED') = ("returned_quantity" = "quantity"));

-- 6. Returns keep their history table under a new name, with one line per item brought back.
ALTER TABLE "asset_returns" RENAME TO "borrowing_returns";
ALTER TABLE "borrowing_returns" RENAME CONSTRAINT "asset_returns_pkey" TO "borrowing_returns_pkey";
ALTER TABLE "borrowing_returns" RENAME CONSTRAINT "asset_returns_borrowing_id_fkey" TO "borrowing_returns_borrowing_id_fkey";
ALTER TABLE "borrowing_returns" RENAME CONSTRAINT "asset_returns_location_id_fkey" TO "borrowing_returns_location_id_fkey";
ALTER TABLE "borrowing_returns" RENAME CONSTRAINT "asset_returns_received_by_id_fkey" TO "borrowing_returns_received_by_id_fkey";
ALTER INDEX "asset_returns_reference_key" RENAME TO "borrowing_returns_reference_key";
ALTER INDEX "asset_returns_borrowing_id_idx" RENAME TO "borrowing_returns_borrowing_id_idx";
ALTER TRIGGER "asset_returns_append_only" ON "borrowing_returns" RENAME TO "borrowing_returns_append_only";

CREATE TABLE "return_lines" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" "Condition" NOT NULL,
    "notes" VARCHAR(500),

    CONSTRAINT "return_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "return_lines_quantity_positive" CHECK ("quantity" > 0)
);
CREATE INDEX "return_lines_line_id_idx" ON "return_lines"("line_id");
CREATE UNIQUE INDEX "return_lines_return_id_line_id_key" ON "return_lines"("return_id", "line_id");
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_id_fkey"
  FOREIGN KEY ("return_id") REFERENCES "borrowing_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_line_id_fkey"
  FOREIGN KEY ("line_id") REFERENCES "borrowing_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- What came back is a record: never edited or deleted.
CREATE TRIGGER "return_lines_append_only"
  BEFORE UPDATE OR DELETE ON "return_lines"
  FOR EACH ROW EXECUTE FUNCTION ims_block_audit_mutation();
