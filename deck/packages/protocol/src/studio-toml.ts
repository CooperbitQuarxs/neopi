import type { StudioGraph, StudioNode, StudioEdge } from "./studio";
import { BUILDABLE_KINDS, type BuildableKind } from "./studio-vocab";

type Value = string | number | boolean | Value[] | Table;
interface Table { [key: string]: Value }
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
function keys(path: string): string[] {
 const result = path.split(".").map(key => key.trim());
 if (result.some(key => !/^[A-Za-z0-9_-]+$/.test(key) || forbidden.has(key))) throw new Error(`Invalid table or key: ${path}`);
 return result;
}
function object(value: unknown): value is Table { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** A deliberately small browser TOML reader: tables, arrays of tables, scalar values and arrays. */
export function parseToml(source: string): Table {
 const root: Table = {};
 let current = root;
 const explicit = new WeakSet<Table>();
 const lines = source.split(/\r?\n/);
 for (let line = 0; line < lines.length; line++) {
  let text = lines[line]!.trim();
  if (!text || text.startsWith("#")) continue;
  try {
   if (text.startsWith("[")) {
    const match = /^(\[\[?)([^\]]+)(\]\]?)(?:\s*#.*)?$/.exec(text);
    if (!match || match[1]!.length !== match[3]!.length) throw new Error("Unclosed table header");
    const path = keys(match[2]!); let table = root;
    for (let i = 0; i < path.length; i++) {
     const key = path[i]!; const last = i === path.length - 1;
     if (last && match[1] === "[[") {
      const existing = table[key];
      if (existing !== undefined && !Array.isArray(existing)) throw new Error(`Table ${key} is already a value`);
      const array = existing as Value[] | undefined ?? []; const next: Table = {}; array.push(next); table[key] = array; table = next;
     } else {
      let next = table[key];
      if (Array.isArray(next)) next = next[next.length - 1];
      if (next === undefined) { next = {}; table[key] = next; }
      if (!object(next)) throw new Error(`Table ${key} is already a value`);
      table = next;
     }
    }
    if (explicit.has(table)) throw new Error("Table declared twice");
    explicit.add(table); current = table; continue;
   }
   const equal = text.indexOf("="); if (equal < 1) throw new Error("Expected key = value");
   const path = keys(text.slice(0, equal)); let table = current;
   for (const key of path.slice(0, -1)) { const next = table[key] ?? {}; if (!object(next)) throw new Error(`Key ${key} is already a value`); table[key] = next; table = next; }
   const key = path[path.length - 1]!;
   if (Object.hasOwn(table, key)) throw new Error(`Key ${key} is repeated`);
   text = text.slice(equal + 1).trim();
   let index = 0;
   function whitespace(): void { while (/\s/.test(text[index] ?? "") && index < text.length) index++; }
   function value(): Value {
    whitespace(); const char = text[index];
    if (char === '"' || char === "'") {
     const start = index++; let escaped = false;
     while (index < text.length) {
      const c = text[index++]!;
      if (c === char && !escaped) {
       const token = text.slice(start, index);
       if (char === "'") return token.slice(1, -1);
       try { return JSON.parse(token) as string; } catch { throw new Error("Invalid string escape"); }
      }
      if (c === "\\" && char === '"') escaped = !escaped; else escaped = false;
     }
     throw new Error("Unclosed string");
    }
    if (char === "{") {
     index++; const table: Table = {}; whitespace();
     while (text[index] !== "}") {
      const match = /^([A-Za-z0-9_-]+)\s*=\s*/.exec(text.slice(index));
      if (!match) throw new Error("Expected an inline table key");
      const key = keys(match[1]!)[0]!;
      if (Object.hasOwn(table, key)) throw new Error(`Key ${key} is repeated`);
      index += match[0].length; table[key] = value(); whitespace();
      if (text[index] === ",") { index++; whitespace(); } else if (text[index] !== "}") throw new Error("Expected a comma in the inline table");
     }
     index++; return table;
    }
    if (char === "[") {
     index++; const array: Value[] = []; whitespace();
     while (text[index] !== "]") {
      if (index >= text.length) throw new Error("Unclosed array");
      array.push(value()); whitespace();
      if (text[index] === ",") { index++; whitespace(); } else if (text[index] !== "]") throw new Error("Expected a comma in the array");
     }
     index++; return array;
    }
    const token = /^[^,\]}#\s]+/.exec(text.slice(index))?.[0];
    if (!token) throw new Error("Expected a value"); index += token.length;
    if (token === "true" || token === "false") return token === "true";
    if (/^[+-]?(?:\d+(?:_\d+)*)(?:\.\d+(?:_\d+)*)?(?:[eE][+-]?\d+)?$/.test(token)) { const number = Number(token.replaceAll("_", "")); if (Number.isFinite(number)) return number; }
    throw new Error(`Unsupported value ${token}. Quote text with double quotes`);
   }
   table[key] = value(); whitespace();
   if (index < text.length && text[index] !== "#") throw new Error("Unexpected text after the value");
  } catch (error) { throw new Error(`Line ${line + 1}: ${error instanceof Error ? error.message : String(error)}`); }
 }
 return root;
}
function encode(value: unknown): string {
 if (typeof value === "string") return JSON.stringify(value);
 if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return String(value);
 if (Array.isArray(value)) return `[${value.map(encode).join(", ")}]`;
 if (object(value)) return `{ ${Object.entries(value).map(([key, item]) => { keys(key); return `${key} = ${encode(item)}`; }).join(", ")} }`;
 throw new Error("TOML values must be strings, finite numbers, booleans, arrays or tables. Null is not a TOML value.");
}
function tableLines(record: Record<string, unknown>, path: string): string[] {
 const rows = Object.entries(record);
 const scalars = rows.filter(([, value]) => !object(value));
 const lines = path ? [`[${path}]`] : [];
 for (const [key, value] of scalars) { keys(key); lines.push(`${key} = ${encode(value)}`); }
 for (const [key, value] of rows.filter(([, value]) => object(value))) { keys(key); lines.push("", ...tableLines(value as Record<string, unknown>, path ? `${path}.${key}` : key)); }
 return lines;
}
/** Serialize authored data, including every node position and named port, without runtime evidence. */
export function graphToToml(graph: StudioGraph): string {
 const lines = ["# Studio graph. Apply source edits to update the canvas.", ...tableLines({ id: graph.id, kind: graph.kind, name: graph.name, description: graph.description, enabled: graph.enabled }, ""), "", ...tableLines(graph.settings, "settings")];
 for (const node of graph.nodes) lines.push("", "[[nodes]]", ...tableLines({ id: node.id, type: node.type, x: node.position.x, y: node.position.y }, ""), ...tableLines(node.config, "nodes.config"));
 for (const edge of graph.edges) lines.push("", "[[edges]]", ...tableLines({ id: edge.id, from_node: edge.from.node, from_port: edge.from.port, to_node: edge.to.node, to_port: edge.to.port }, ""));
 return `${lines.join("\n")}\n`;
}
function string(record: Table, key: string): string { const value = record[key]; if (typeof value !== "string") throw new Error(`${key} must be a string.`); return value; }
function records(value: Value | undefined, key: string): Table[] { if (value === undefined) return []; if (!Array.isArray(value) || !value.every(object)) throw new Error(`${key} must be an array of tables.`); return value; }
/** Parse the source into a graph while keeping its runtime id and run evidence immutable. */
export function graphFromToml(source: string, previous: StudioGraph, parse: (source: string) => unknown = parseToml): StudioGraph {
 const parsed = parse(source);
 if (!object(parsed)) throw new Error("The TOML source must describe a graph.");
 const data = parsed;
 const kind = string(data, "kind");
 if (!BUILDABLE_KINDS.includes(kind as BuildableKind) || kind === "flow") throw new Error("Choose a pipeline, router, classifier or boardflow kind. Flows use YAML.");
 if (data.id !== previous.id) throw new Error("The graph id cannot change. Create a new graph instead.");
 if (typeof data.enabled !== "boolean") throw new Error("enabled must be true or false.");
 const nodes: StudioNode[] = records(data.nodes, "nodes").map(node => {
  if (typeof node.x !== "number" || typeof node.y !== "number") throw new Error("Node x and y must be numbers.");
  if (node.config !== undefined && !object(node.config)) throw new Error("Node config must be a table.");
  return { id: string(node, "id"), type: string(node, "type"), position: { x: node.x, y: node.y }, config: node.config ?? {} };
 });
 const edges: StudioEdge[] = records(data.edges, "edges").map(edge => ({ id: string(edge, "id"), from: { node: string(edge, "from_node"), port: string(edge, "from_port") }, to: { node: string(edge, "to_node"), port: string(edge, "to_port") } }));
 if (new Set(nodes.map(node => node.id)).size !== nodes.length) throw new Error("Node ids must be unique.");
 if (data.settings !== undefined && !object(data.settings)) throw new Error("settings must be a table.");
 return { ...previous, kind: kind as BuildableKind, name: string(data, "name"), description: string(data, "description"), enabled: data.enabled, nodes, edges, settings: data.settings ?? {} };
}
