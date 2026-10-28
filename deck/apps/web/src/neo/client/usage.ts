import { auth, previewAccountRecords } from "./auth";
import { PREVIEW_POOLS, PREVIEW_SPEND, type SpendPoint } from "./preview-data";
import { SOURCES } from "./source";
export type UsagePeriod = "today" | "week" | "month";
/** A budget stage in a virtual model's ordered demotion chain. Fractions are 0..1. */
export interface Stage {
 model: string;
 accounts: "all" | string[];
 draw: "alternate" | "least-used" | "fill";
 perAccount: number;
 cap: number;
 window: "5h" | "day" | "week" | "month";
 per: "user" | "all";
 effort?: string;
 used: number;
}
/** What happens after the virtual model has exhausted its budget stages. */
export interface Terminal { kind: "limit" | "queue" | "passthrough"; message: string }
/** An account's budget and measured use of a virtual model, after its allotment is applied. */
export interface UsagePool { name: string; stages: Stage[]; terminal: Terminal; spentUsd: number; requests: number; accounts: string[] }
/** A metered inference request and its destination in the office. */
export interface UsageRequest { id: string; at: string; virtualModel: string; model: string; where: { kind: "thread" | "card" | "routine"; label: string; href: string }; tokens: number; costUsd: number }
/** Account usage for the selected reporting period. Spend always includes fourteen daily buckets. */
export interface UsageSummary { pools: UsagePool[]; spend: SpendPoint[]; requests: UsageRequest[]; requestCount: number; resetsAt: string; allotment: number }
export interface UsageClient { me(period: UsagePeriod): Promise<UsageSummary>; account(id: string, period: UsagePeriod): Promise<UsageSummary> }
const REQUEST_TOKENS = [9_800, 41_280, 1_870, 230_400, 12_640, 3_920, 86_100, 7_310, 184_600, 2_450, 28_900, 15_720, 940, 63_400, 5_180, 112_800];
function fixture(id: string, period: UsagePeriod): UsageSummary {
 const account = previewAccountRecords.find(a => a.id === id) ?? previewAccountRecords[0]!;
 const allotment = account.allotment ?? 1;
 const scale = (period === "today" ? 0.18 : period === "month" ? 2.7 : 1) * (id === "u_lin" ? 0.32 : id === "u_ada" ? 0.7 : 1);
 const pools: UsagePool[] = PREVIEW_POOLS.filter(p => account.roles.includes(p.role)).map(p => ({
  name: p.role, spentUsd: p.spentUsd * scale, requests: Math.round(p.requests * scale), accounts: previewAccountRecords.filter(a => a.roles.includes(p.role)).map(a => a.name),
  stages: p.chain.map((s, i) => ({ model: `${s.provider}/${s.model}`, accounts: "all", draw: "alternate", perAccount: s.sharePct / 100 * allotment, cap: s.sharePct / 100 * allotment, window: "week", per: "user", used: Math.min(s.sharePct / 100 * allotment, s.usedPct / 100 * scale * (period === "month" ? 2 : 1)), ...(i === 0 && p.role === "heavy" ? {effort:"high"} : {}) })),
  terminal: { kind: "limit", message: `You've used your ${p.role} share ${period === "today" ? "today" : period === "month" ? "this month" : "this week"}.` },
 }));
 const requests = Array.from({length:pools.length ? 40 : 0}, (_, i): UsageRequest => {
  const pool = pools[i % pools.length]!;
  const stage = pool.stages[i % pool.stages.length]!;
  const kind = i % 3 === 0 ? "card" : i % 3 === 1 ? "thread" : "routine";
  return { id:`${id}-${period}-${i}`, at:new Date(Date.now() - (i * 47 + 4) * 60_000).toISOString(), virtualModel:pool.name, model:stage.model, where:{kind, label: kind === "card" ? `T-${5 + i % 8}` : kind === "thread" ? "Fix anchor links" : "Nightly docs", href: kind === "card" ? `/board?card=T-${5+i%8}` : kind === "thread" ? "/threads" : "/studio"}, tokens:Math.round(REQUEST_TOKENS[i % REQUEST_TOKENS.length]! * (1 + (i % 5) * 0.037) * scale), costUsd: (0.014 + (i%7)*0.018) * scale };
 });
 return {pools, requests, requestCount:pools.reduce((sum,p)=>sum+p.requests,0), spend:PREVIEW_SPEND.map(p=>({...p,usd:p.usd*scale})), resetsAt:new Date(Date.now() + (5*24+14)*3_600_000).toISOString(), allotment};
}
const preview: UsageClient = { async me(period) { return fixture((await auth.me())?.id ?? "u_admin",period); }, async account(id,period) { return fixture(id,period); } };
async function get(id: string, period: UsagePeriod): Promise<UsageSummary> {
 const [summary, requests] = await Promise.all([fetch(`/api/usage/${id}?period=${period}`),fetch(`/api/usage/requests?period=${period}${id.startsWith("accounts/")?`&account=${encodeURIComponent(id.slice(9))}`:""}`)]);
 if (!summary.ok || !requests.ok) throw new Error("Usage could not load. Reload and try again.");
 return {...await summary.json() as UsageSummary, requests:(await requests.json() as {requests:UsageRequest[]}).requests};
}
const live: UsageClient = { me:period=>get("me",period), account:(id,period)=>get(`accounts/${encodeURIComponent(id)}`,period) };
export const usage: UsageClient = SOURCES.usage === "live" ? live : preview;
