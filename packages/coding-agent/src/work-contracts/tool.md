Manage operational clauses for this session. Clauses survive compaction and resume, but a new session starts without them. Use list/show to inspect clauses and provenance; set creates or replaces text, edit requires an existing id, enable/disable changes activation, remove deletes the clause. Active clauses are reinjected intact on every request.

The user MUST opt in with `/contract policy on` before you use this tool. You MUST preserve the user's intended scope. You MUST NOT change policy or promote a clause. Only explicit `/contract policy` and `/contract promote <id> user|project` commands authorize those operations. Never use contracts for assignment tracking or as a replacement for sticky RULES.md.

Example: {"action":"set","id":"funnel","text":"The funnel publishes; the lane stays free."}
