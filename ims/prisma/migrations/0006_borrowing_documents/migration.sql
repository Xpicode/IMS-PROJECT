-- CreateEnum
CREATE TYPE "BorrowingStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BorrowingLineStatus" AS ENUM ('PENDING', 'OUT', 'RETURNED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('STOCK_ISSUANCE', 'TRANSMITTAL', 'EQUIPMENT_BORROWING', 'RETURN_ACKNOWLEDGMENT');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'READY', 'PDF_FAILED', 'VOID');

-- CreateTable
CREATE TABLE "borrowings" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(30),
    "status" "BorrowingStatus" NOT NULL DEFAULT 'DRAFT',
    "location_id" UUID NOT NULL,
    "borrower_name" VARCHAR(120) NOT NULL,
    "borrower_dept" VARCHAR(120),
    "purpose" VARCHAR(300) NOT NULL,
    "due_at" TIMESTAMPTZ(3),
    "received_by_name" VARCHAR(120),
    "notes" VARCHAR(1000),
    "prepared_by_id" UUID NOT NULL,
    "released_by_id" UUID,
    "released_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "borrowings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "borrowing_lines" (
    "id" UUID NOT NULL,
    "borrowing_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "status" "BorrowingLineStatus" NOT NULL DEFAULT 'PENDING',
    "condition_out" "AssetCondition",
    "accessories" VARCHAR(300),
    "return_id" UUID,
    "condition_in" "AssetCondition",
    "status_after_return" "AssetStatus",
    "missing_accessories" VARCHAR(300),
    "return_notes" VARCHAR(500),
    "returned_at" TIMESTAMPTZ(3),

    CONSTRAINT "borrowing_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_returns" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "borrowing_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "returned_by_name" VARCHAR(120) NOT NULL,
    "received_by_id" UUID NOT NULL,
    "notes" VARCHAR(1000),
    "returned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_documents" (
    "id" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "template_version" VARCHAR(20) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "file_path" VARCHAR(300),
    "sha256" VARCHAR(64),
    "size_bytes" INTEGER,
    "page_count" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(300),
    "void_reason" VARCHAR(300),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rendered_at" TIMESTAMPTZ(3),

    CONSTRAINT "pdf_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "borrowings_reference_key" ON "borrowings"("reference");

-- CreateIndex
CREATE INDEX "borrowings_status_due_at_idx" ON "borrowings"("status", "due_at");

-- CreateIndex
CREATE INDEX "borrowings_location_id_status_idx" ON "borrowings"("location_id", "status");

-- CreateIndex
CREATE INDEX "borrowing_lines_asset_id_idx" ON "borrowing_lines"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "borrowing_lines_borrowing_id_asset_id_key" ON "borrowing_lines"("borrowing_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_returns_reference_key" ON "asset_returns"("reference");

-- CreateIndex
CREATE INDEX "asset_returns_borrowing_id_idx" ON "asset_returns"("borrowing_id");

-- CreateIndex
CREATE UNIQUE INDEX "pdf_documents_reference_key" ON "pdf_documents"("reference");

-- CreateIndex
CREATE INDEX "pdf_documents_type_created_at_idx" ON "pdf_documents"("type", "created_at");

-- CreateIndex
CREATE INDEX "pdf_documents_status_idx" ON "pdf_documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pdf_documents_source_type_source_id_type_key" ON "pdf_documents"("source_type", "source_id", "type");

-- AddForeignKey
ALTER TABLE "borrowings" ADD CONSTRAINT "borrowings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borrowings" ADD CONSTRAINT "borrowings_prepared_by_id_fkey" FOREIGN KEY ("prepared_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borrowings" ADD CONSTRAINT "borrowings_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borrowing_lines" ADD CONSTRAINT "borrowing_lines_borrowing_id_fkey" FOREIGN KEY ("borrowing_id") REFERENCES "borrowings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borrowing_lines" ADD CONSTRAINT "borrowing_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borrowing_lines" ADD CONSTRAINT "borrowing_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "asset_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_returns" ADD CONSTRAINT "asset_returns_borrowing_id_fkey" FOREIGN KEY ("borrowing_id") REFERENCES "borrowings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_returns" ADD CONSTRAINT "asset_returns_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_returns" ADD CONSTRAINT "asset_returns_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_documents" ADD CONSTRAINT "pdf_documents_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_documents" ADD CONSTRAINT "pdf_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written rules (spec §7.5–7.6, §9.2–9.3, §13.3–13.4)
-- ---------------------------------------------------------------------------
-- An asset can be out on only one loan at a time (A08), whatever the app does.
CREATE UNIQUE INDEX "borrowing_lines_asset_out_once"
  ON "borrowing_lines" ("asset_id") WHERE "status" = 'OUT';

ALTER TABLE "borrowings"
  ADD CONSTRAINT "borrowings_number_only_when_released"
    CHECK (("status" IN ('DRAFT', 'CANCELLED') AND "released_at" IS NULL) OR ("reference" IS NOT NULL AND "released_at" IS NOT NULL AND "released_by_id" IS NOT NULL)),
  ADD CONSTRAINT "borrowings_draft_has_no_number"
    CHECK ("status" <> 'DRAFT' OR "reference" IS NULL),
  ADD CONSTRAINT "borrowings_closed_has_time"
    CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL)),
  ADD CONSTRAINT "borrowings_version_positive" CHECK ("version" >= 1);

ALTER TABLE "borrowing_lines"
  ADD CONSTRAINT "borrowing_lines_out_has_condition"
    CHECK ("status" = 'PENDING' OR "condition_out" IS NOT NULL),
  ADD CONSTRAINT "borrowing_lines_returned_complete"
    CHECK (("status" = 'RETURNED') = ("return_id" IS NOT NULL AND "condition_in" IS NOT NULL AND "returned_at" IS NOT NULL));

-- A return event is a record of what happened: never edited or deleted.
CREATE TRIGGER asset_returns_append_only
  BEFORE UPDATE OR DELETE ON "asset_returns"
  FOR EACH ROW EXECUTE FUNCTION ims_block_audit_mutation();

-- A document's printed values never change after confirm (§13.4 step 4); only its
-- render status/file fields may be updated, and it can't be deleted (numbers are never recycled).
CREATE OR REPLACE FUNCTION ims_document_snapshot_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pdf_documents rows can''t be deleted (official numbers are never recycled)';
  END IF;
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'pdf_documents snapshot is immutable (document %)', OLD.reference;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pdf_documents_snapshot_frozen
  BEFORE UPDATE OR DELETE ON "pdf_documents"
  FOR EACH ROW EXECUTE FUNCTION ims_document_snapshot_frozen();

ALTER TABLE "pdf_documents"
  ADD CONSTRAINT "pdf_documents_ready_has_file"
    CHECK ("status" <> 'READY' OR ("file_path" IS NOT NULL AND "sha256" IS NOT NULL));
