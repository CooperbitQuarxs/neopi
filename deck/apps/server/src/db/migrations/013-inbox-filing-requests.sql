-- Reserve the destination before an external write so an unresolved GitHub
-- acceptance cannot race a board filing, including after a server restart.
CREATE TABLE inbox_filing_requests (
    item_id TEXT PRIMARY KEY REFERENCES inbox_items(id) ON DELETE CASCADE,
    destination_json TEXT NOT NULL,
    item_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
