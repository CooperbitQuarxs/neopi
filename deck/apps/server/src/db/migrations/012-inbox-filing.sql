CREATE TABLE inbox_filing_receipts (
    item_id TEXT NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
    ref TEXT NOT NULL,
    destination_json TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    filed_at TEXT NOT NULL,
    PRIMARY KEY (item_id, ref)
);
