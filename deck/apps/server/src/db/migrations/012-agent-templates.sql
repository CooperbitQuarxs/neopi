CREATE TABLE agent_templates (
    id TEXT PRIMARY KEY,
    definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
