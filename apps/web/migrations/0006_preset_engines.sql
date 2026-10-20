-- A user preset's part per engine (src/lib/preset-engines.ts): OrcaSlicer's
-- base preset and own settings, and which shared-settings list it was saved
-- with. JSON, NULL for presets saved before there were two engines.
-- Added beside the old columns: the live site keeps reading inherits + config.
ALTER TABLE presets ADD COLUMN engines TEXT;
