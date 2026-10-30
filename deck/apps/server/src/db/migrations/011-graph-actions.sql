-- Independent of run lifetime: a later node failure never erases a write receipt.
CREATE TABLE graph_actions (
  logical_key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  effect_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
