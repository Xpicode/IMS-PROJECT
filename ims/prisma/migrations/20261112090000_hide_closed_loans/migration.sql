-- "Delete selected" on the Closed tab: closed loans keep their history and are only hidden.
ALTER TABLE "borrowings" ADD COLUMN "hidden_at" TIMESTAMPTZ(3);
ALTER TABLE "borrowings" ADD CONSTRAINT "borrowings_hidden_only_when_closed"
  CHECK ("hidden_at" IS NULL OR "status" = 'CLOSED');
