import type { BuildableKind, GraphKind } from "./studio-vocab";

export interface GraphSummary { id: string; kind: GraphKind; name: string; description: string; nodes: number; enabled: boolean; lastRun?: { at: string; ok?: boolean } }
export interface StudioGraph { id: string; kind: BuildableKind; name: string; description: string; enabled: boolean; nodes: StudioNode[]; edges: StudioEdge[]; settings: Record<string, unknown>; lastRun?: { at: string; ok: boolean }; updatedAt: string }
export interface StudioNode { id: string; type: string; config: Record<string, unknown>; position: { x: number; y: number } }
export interface StudioEdge { id: string; from: { node: string; port: string }; to: { node: string; port: string } }
export interface StudioRunOptions { mode?: "preview" | "execute"; input?: unknown }
export interface StudioRun { id: string; graphId: string; startedAt: string; endedAt?: string; ok: boolean | null; trigger: string; mode?: "preview" | "execute"; costUsd?: number; nodes: { nodeId: string; startedAt: string; endedAt?: string; status: "ok" | "failed" | "skipped" | "running"; note?: string; output?: unknown }[] }
export interface GraphProblem { nodeId?: string; message: string }
