CREATE TABLE studio_graphs (
    id TEXT PRIMARY KEY,
    source_toml TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_run_at TEXT,
    last_run_ok INTEGER
);
CREATE TABLE studio_graph_runs (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL REFERENCES studio_graphs(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    graph_toml TEXT NOT NULL,
    record_json TEXT NOT NULL
);
CREATE INDEX studio_graph_runs_history ON studio_graph_runs(graph_id, started_at DESC);
