-- Name the protected table in the error instead of always saying audit_events.
CREATE OR REPLACE FUNCTION ims_block_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
