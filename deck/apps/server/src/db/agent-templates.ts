import type { AgentTemplate, AgentTemplateInput } from "@npi-deck/protocol";
import { getDb } from "./index.ts";

type Row = { id: string; definition_json: string; created_at: string; updated_at: string };
function template(row: Row): AgentTemplate {
	return { ...JSON.parse(row.definition_json), id: row.id, source: { format: "deck" }, instanceCount: 0,
		createdAt: row.created_at, updatedAt: row.updated_at };
}
export function listAgentTemplates(): AgentTemplate[] {
	return getDb().query<Row, []>("SELECT * FROM agent_templates ORDER BY created_at, id").all().map(template);
}
export function getAgentTemplate(id: string): AgentTemplate | undefined {
	const row = getDb().query<Row, [string]>("SELECT * FROM agent_templates WHERE id = ?").get(id);
	return row ? template(row) : undefined;
}
export function saveAgentTemplate(input: AgentTemplateInput): AgentTemplate {
	const now = new Date().toISOString();
	getDb().query("INSERT INTO agent_templates (id, definition_json, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET definition_json = excluded.definition_json, updated_at = excluded.updated_at")
		.run(input.id, JSON.stringify(input), now, now);
	return getAgentTemplate(input.id)!;
}
export function removeAgentTemplate(id: string): boolean {
	return getDb().query("DELETE FROM agent_templates WHERE id = ?").run(id).changes > 0;
}
