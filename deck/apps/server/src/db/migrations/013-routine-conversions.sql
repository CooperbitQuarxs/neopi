-- Source definitions remain restorable after native edits and process restarts.
-- This journal is a backup, never consulted by routine execution.
CREATE TABLE routine_graph_conversions (
    routine_id TEXT NOT NULL,
    source_digest TEXT NOT NULL,
    original_json TEXT NOT NULL,
    converted_graph_json TEXT NOT NULL,
    backup_path TEXT NOT NULL,
    converted_at TEXT NOT NULL,
    restored_at TEXT,
    PRIMARY KEY (routine_id, source_digest)
);
