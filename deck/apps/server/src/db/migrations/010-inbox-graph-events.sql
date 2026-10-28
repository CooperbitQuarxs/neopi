-- Snapshot subscribers with the card commit, never by enumerating the inbox at boot.
CREATE TABLE inbox_graph_events (
    card_id TEXT NOT NULL,
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL,
    event_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'admitted', 'discarded')),
    run_id TEXT,
    graph_json TEXT,
    PRIMARY KEY (card_id, routine_id, source_node_id)
);
CREATE INDEX inbox_graph_events_pending ON inbox_graph_events(state);
