CREATE TABLE inbox_mutation_receipts (
    scope TEXT NOT NULL,
    request_key TEXT NOT NULL,
    response_json TEXT NOT NULL,
    PRIMARY KEY (scope, request_key)
);
