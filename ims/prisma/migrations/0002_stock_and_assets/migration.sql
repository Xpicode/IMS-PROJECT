-- CreateEnum
CREATE TYPE "TrackingType" AS ENUM ('STOCK', 'ASSET');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'BORROWED', 'UNDER_MAINTENANCE', 'NEEDS_REVIEW', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('GOOD', 'FAIR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "StockTxnType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "StockTxnStatus" AS ENUM ('CONFIRMED');

-- CreateEnum
CREATE TYPE "IdentifierKind" AS ENUM ('QR', 'CODE128', 'EAN13', 'UPCA', 'OTHER');

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000),
    "category_id" UUID,
    "unit_id" UUID NOT NULL,
    "tracking_type" "TrackingType" NOT NULL,
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "brand" VARCHAR(80),
    "model" VARCHAR(80),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_identifiers" (
    "id" UUID NOT NULL,
    "namespace" VARCHAR(20) NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "kind" "IdentifierKind" NOT NULL,
    "item_id" UUID,
    "asset_id" UUID,
    "location_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "tag" VARCHAR(40) NOT NULL,
    "item_id" UUID NOT NULL,
    "serial_number" VARCHAR(100),
    "location_id" UUID NOT NULL,
    "custodian_name" VARCHAR(120),
    "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "notes" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_events" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "event_type" VARCHAR(40) NOT NULL,
    "from_status" "AssetStatus",
    "to_status" "AssetStatus",
    "from_location_id" UUID,
    "to_location_id" UUID,
    "from_custodian" VARCHAR(120),
    "to_custodian" VARCHAR(120),
    "from_condition" "AssetCondition",
    "to_condition" "AssetCondition",
    "notes" VARCHAR(1000),
    "actor_id" UUID NOT NULL,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("item_id","location_id")
);

-- CreateTable
CREATE TABLE "stock_transactions" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "type" "StockTxnType" NOT NULL,
    "status" "StockTxnStatus" NOT NULL DEFAULT 'CONFIRMED',
    "reason" VARCHAR(300),
    "source" VARCHAR(160),
    "external_ref" VARCHAR(80),
    "recipient_name" VARCHAR(120),
    "notes" VARCHAR(1000),
    "actor_id" UUID NOT NULL,
    "request_id" VARCHAR(64),
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "doc_type" VARCHAR(30) NOT NULL,
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("doc_type","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "items_sku_key" ON "items"("sku");

-- CreateIndex
CREATE INDEX "items_category_id_idx" ON "items"("category_id");

-- CreateIndex
CREATE INDEX "items_name_idx" ON "items"("name");

-- CreateIndex
CREATE INDEX "item_identifiers_code_idx" ON "item_identifiers"("code");

-- CreateIndex
CREATE INDEX "item_identifiers_item_id_idx" ON "item_identifiers"("item_id");

-- CreateIndex
CREATE INDEX "item_identifiers_asset_id_idx" ON "item_identifiers"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_tag_key" ON "assets"("tag");

-- CreateIndex
CREATE INDEX "assets_item_id_idx" ON "assets"("item_id");

-- CreateIndex
CREATE INDEX "assets_location_id_status_idx" ON "assets"("location_id", "status");

-- CreateIndex
CREATE INDEX "assets_serial_number_idx" ON "assets"("serial_number");

-- CreateIndex
CREATE INDEX "asset_events_asset_id_created_at_idx" ON "asset_events"("asset_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_balances_location_id_idx" ON "stock_balances"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transactions_reference_key" ON "stock_transactions"("reference");

-- CreateIndex
CREATE INDEX "stock_transactions_type_confirmed_at_idx" ON "stock_transactions"("type", "confirmed_at");

-- CreateIndex
CREATE INDEX "stock_transactions_confirmed_at_idx" ON "stock_transactions"("confirmed_at");

-- CreateIndex
CREATE INDEX "stock_movements_item_id_created_at_idx" ON "stock_movements"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_location_id_created_at_idx" ON "stock_movements"("location_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_transaction_id_idx" ON "stock_movements"("transaction_id");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_identifiers" ADD CONSTRAINT "item_identifiers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_identifiers" ADD CONSTRAINT "item_identifiers_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_identifiers" ADD CONSTRAINT "item_identifiers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "stock_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written additions (reviewed with migration 0002)
-- ---------------------------------------------------------------------------

-- Codes are stored normalized so uniqueness is real.
ALTER TABLE "items" ADD CONSTRAINT "items_sku_normalized"
  CHECK ("sku" = upper(btrim("sku")) AND length("sku") > 0);
ALTER TABLE "assets" ADD CONSTRAINT "assets_tag_normalized"
  CHECK ("tag" = upper(btrim("tag")) AND length("tag") > 0);
ALTER TABLE "item_identifiers" ADD CONSTRAINT "item_identifiers_code_normalized"
  CHECK ("code" = upper("code") AND "code" !~ '\s' AND length("code") > 0);

-- Whole-number quantities only (§9.2 default); never negative stock.
ALTER TABLE "items" ADD CONSTRAINT "items_min_stock_nonnegative" CHECK ("min_stock" >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_nonzero" CHECK ("quantity" <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_balance_after_nonnegative" CHECK ("balance_after" >= 0);
ALTER TABLE "assets" ADD CONSTRAINT "assets_version_positive" CHECK ("version" >= 1);
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_next_positive" CHECK ("next" >= 1);

-- An identifier points at exactly one record.
ALTER TABLE "item_identifiers" ADD CONSTRAINT "item_identifiers_one_target"
  CHECK (num_nonnulls("item_id", "asset_id", "location_id") = 1);

-- An active code may not map to two records in the same namespace (§6.3).
CREATE UNIQUE INDEX "item_identifiers_active_namespace_code_key"
  ON "item_identifiers" ("namespace", "code") WHERE "is_active";

-- Ledger and custody history are append-only (§9.1, §9.3 "Corrections").
CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION ims_block_audit_mutation();
CREATE TRIGGER asset_events_append_only
  BEFORE UPDATE OR DELETE ON "asset_events"
  FOR EACH ROW EXECUTE FUNCTION ims_block_audit_mutation();
CREATE TRIGGER stock_transactions_no_delete
  BEFORE DELETE ON "stock_transactions"
  FOR EACH ROW EXECUTE FUNCTION ims_block_audit_mutation();
