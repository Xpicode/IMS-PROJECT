CREATE TABLE evidence_photos (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_kind varchar(10) NOT NULL CHECK (target_kind IN ('COUNT', 'RETURN')),
  target_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  sha256 varchar(64) NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  content_type varchar(30) NOT NULL,
  file_path varchar(200) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX evidence_photos_owner_id_target_kind_target_id_idx ON evidence_photos(owner_id, target_kind, target_id);
CREATE TABLE count_entry_photos (
  entry_id uuid NOT NULL REFERENCES count_entries(id) ON DELETE RESTRICT,
  photo_id uuid NOT NULL REFERENCES evidence_photos(id) ON DELETE RESTRICT,
  PRIMARY KEY(entry_id, photo_id)
);
CREATE INDEX count_entry_photos_photo_id_idx ON count_entry_photos(photo_id);
CREATE TABLE return_line_photos (
  line_id uuid NOT NULL REFERENCES borrowing_lines(id) ON DELETE RESTRICT,
  photo_id uuid NOT NULL REFERENCES evidence_photos(id) ON DELETE RESTRICT,
  PRIMARY KEY(line_id, photo_id)
);
CREATE INDEX return_line_photos_photo_id_idx ON return_line_photos(photo_id);
CREATE FUNCTION evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Photo evidence is immutable';
END;
$$;
CREATE TRIGGER evidence_photos_immutable BEFORE UPDATE OR DELETE ON evidence_photos FOR EACH ROW EXECUTE FUNCTION evidence_immutable();
CREATE TRIGGER count_entry_photos_immutable BEFORE UPDATE OR DELETE ON count_entry_photos FOR EACH ROW EXECUTE FUNCTION evidence_immutable();
CREATE TRIGGER return_line_photos_immutable BEFORE UPDATE OR DELETE ON return_line_photos FOR EACH ROW EXECUTE FUNCTION evidence_immutable();
