-- The engine a project slices with: 'snapmaker' (Snapmaker Orca) or 'orca'
-- (OrcaSlicer). NULL for projects saved before there were two engines, which
-- are Snapmaker Orca's. Added beside the old columns: every deploy, previews
-- included, shares this database.
ALTER TABLE projects ADD COLUMN engine TEXT;
