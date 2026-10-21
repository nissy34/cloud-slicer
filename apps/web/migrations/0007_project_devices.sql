-- AutoSave and Continue on another device (PR "AutoSave like Word").
-- draft: 1 for the one unsaved project a person may have (it isn't in their
-- project list and doesn't count toward the project limit, only its bytes do).
-- device / device_name: the device editing the project now ("phone",
-- "Windows computer"); another device's save is refused until it takes over.
-- Added beside the old columns: every deploy, previews included, shares this database.
ALTER TABLE projects ADD COLUMN draft INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN device TEXT;
ALTER TABLE projects ADD COLUMN device_name TEXT;
