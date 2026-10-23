CREATE TABLE task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    text TEXT NOT NULL,
    tone TEXT CHECK (tone IN ('ok', 'warn', 'bad'))
);
CREATE INDEX task_events_task_at ON task_events(task_id, at);
