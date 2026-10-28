-- CreateEnum
CREATE TYPE "CountSessionStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CountTargetKind" AS ENUM ('STOCK', 'ASSET');

-- CreateEnum
CREATE TYPE "CountEntryStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'SUPERSEDED', 'REJECTED');

-- CreateTable
CREATE TABLE "count_sessions" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "location_id" UUID NOT NULL,
    "status" "CountSessionStatus" NOT NULL DEFAULT 'OPEN',
    "due_at" TIMESTAMPTZ(3),
    "snapshot_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "notes" VARCHAR(1000),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "count_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_session_assignees" (
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "count_session_assignees_pkey" PRIMARY KEY ("session_id","user_id")
);

-- CreateTable
CREATE TABLE "count_session_items" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "kind" "CountTargetKind" NOT NULL,
    "item_id" UUID NOT NULL,
    "asset_id" UUID,
    "expected_quantity" INTEGER,
    "expected_status" "AssetStatus",
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "count_session_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_entries" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "session_item_id" UUID NOT NULL,
    "counter_id" UUID NOT NULL,
    "quantity" INTEGER,
    "found" BOOLEAN,
    "condition" "AssetCondition",
    "notes" VARCHAR(1000),
    "base_version" INTEGER NOT NULL,
    "status" "CountEntryStatus" NOT NULL DEFAULT 'SUBMITTED',
    "operation_id" UUID NOT NULL,
    "device_id" VARCHAR(64),
    "client_recorded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "count_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "count_sessions_reference_key" ON "count_sessions"("reference");

-- CreateIndex
CREATE INDEX "count_sessions_location_id_status_idx" ON "count_sessions"("location_id", "status");

-- CreateIndex
CREATE INDEX "count_session_assignees_user_id_idx" ON "count_session_assignees"("user_id");

-- CreateIndex
CREATE INDEX "count_session_items_session_id_idx" ON "count_session_items"("session_id");

-- CreateIndex
CREATE INDEX "count_entries_session_id_session_item_id_idx" ON "count_entries"("session_id", "session_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "count_entries_counter_id_operation_id_key" ON "count_entries"("counter_id", "operation_id");

-- AddForeignKey
ALTER TABLE "count_sessions" ADD CONSTRAINT "count_sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_sessions" ADD CONSTRAINT "count_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_session_assignees" ADD CONSTRAINT "count_session_assignees_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_session_assignees" ADD CONSTRAINT "count_session_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_session_items" ADD CONSTRAINT "count_session_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_session_items" ADD CONSTRAINT "count_session_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_session_items" ADD CONSTRAINT "count_session_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_entries" ADD CONSTRAINT "count_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "count_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_entries" ADD CONSTRAINT "count_entries_session_item_id_fkey" FOREIGN KEY ("session_item_id") REFERENCES "count_session_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_entries" ADD CONSTRAINT "count_entries_counter_id_fkey" FOREIGN KEY ("counter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written rules (spec §9.2)
-- ---------------------------------------------------------------------------
ALTER TABLE "count_session_items"
  ADD CONSTRAINT "count_session_items_kind_matches_asset"
    CHECK (("kind" = 'ASSET') = ("asset_id" IS NOT NULL)),
  ADD CONSTRAINT "count_session_items_expected_nonnegative"
    CHECK ("expected_quantity" IS NULL OR "expected_quantity" >= 0),
  ADD CONSTRAINT "count_session_items_version_positive" CHECK ("version" >= 1);

-- One target per stock item and per asset in a session.
CREATE UNIQUE INDEX "count_session_items_stock_once"
  ON "count_session_items" ("session_id", "item_id") WHERE "kind" = 'STOCK';
CREATE UNIQUE INDEX "count_session_items_asset_once"
  ON "count_session_items" ("session_id", "asset_id") WHERE "asset_id" IS NOT NULL;

ALTER TABLE "count_entries"
  ADD CONSTRAINT "count_entries_quantity_nonnegative" CHECK ("quantity" IS NULL OR "quantity" >= 0),
  ADD CONSTRAINT "count_entries_quantity_xor_found" CHECK (("quantity" IS NULL) <> ("found" IS NULL)),
  ADD CONSTRAINT "count_entries_condition_needs_found" CHECK ("condition" IS NULL OR "found" IS TRUE);

ALTER TABLE "count_sessions"
  ADD CONSTRAINT "count_sessions_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "count_sessions_closed_has_time" CHECK (("status" = 'OPEN') = ("closed_at" IS NULL));
