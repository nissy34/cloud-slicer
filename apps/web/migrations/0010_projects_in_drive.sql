-- Projects live in each person's own Google Drive (functions/_lib/drive.ts):
-- file_key is "drive:<file id>" and our project storage (R2) is gone. The list
-- picture moves into the row. Additive only (production and previews share
-- this database).
ALTER TABLE projects ADD COLUMN thumb BLOB;        -- the list picture (256 px WebP or PNG, about 15 KB)
ALTER TABLE projects ADD COLUMN thumb_type TEXT;  -- its content type
ALTER TABLE projects ADD COLUMN drive_md5 TEXT;   -- the saved file's MD5 as Drive reports it: a different one means it was changed in Drive
-- Online projects for this person: NULL or 1 on, 0 off (presets and printers still save).
ALTER TABLE user_limits ADD COLUMN projects INTEGER;
