import { authApi } from "@/lib/auth-api";
import { bridgesApi } from "@/lib/bridges-api";
import { mcpServersApi } from "@/lib/mcp-servers-api";
import { modelsConfigApi } from "@/lib/models-config-api";
import { npiConfigApi } from "@/lib/npi-config-api";
import { settingsApi } from "@/lib/settings-api";
import type { Account } from "./preview-data";
import { previewAccountRecords, previewPasswords, publishPreviewAccount } from "./auth";
import { SOURCES } from "./source";
/** An account grant scales every virtual-model budget by its allotment. */
export interface ManagedAccount extends Account { allotment: number; lastSeen: string }
/** Account fields sent by the add/edit drawer. Passwords never appear in account responses. */
export interface AccountInput { handle: string; name: string; role: "admin" | "member"; roles: string[]; allotment: number; password?: string }
/** Browser dictation preference; the transcribe adapter remains separate. */
export interface DictationSettings { engine: "xai" | "parakeet" | "off"; language: string }
/** Runtime health from the deck's existing health endpoint. */
export interface DeckHealth { ok: boolean; pid: number; defaultCwd: string; extraWorkspaces: string[]; serverStartedAt: string; version: string; buildSha: string | null; uptimeSecs: number }
export interface AccountsClient { list():Promise<ManagedAccount[]>; save(id:string|null,input:AccountInput):Promise<ManagedAccount[]>; password(id:string,password:string):Promise<void> }
async function request<T>(path:string,method="GET",body?:unknown):Promise<T>{const response=await fetch(path,{method,...(body===undefined?{}:{headers:{"content-type":"application/json"},body:JSON.stringify(body)})});if(!response.ok){const text=await response.text();throw new Error(text||`HTTP ${response.status}`);}return await response.json() as T;}
let rows:ManagedAccount[]=previewAccountRecords.map((a,i)=>({...a,allotment:1,lastSeen:new Date(Date.now()-i*48*60_000).toISOString()}));
const previewAccounts: AccountsClient = {
 async list() { return rows.map(account => ({ ...account, roles: [...account.roles] })); },
 async save(id, input) {
  const handle = input.handle.trim().toLowerCase();
  if (!input.name.trim() || !handle) throw new Error("Enter a name and handle.");
  if (rows.some(account => account.handle === handle && account.id !== id)) throw new Error("That handle is already in use.");
  if (!id && !input.password) throw new Error("Enter an initial password.");
  const old = rows.find(account => account.id === id);
  const next: ManagedAccount = { id: id ?? `u_${crypto.randomUUID()}`, name: input.name.trim(), handle, role: input.role, roles: input.roles, hue: old?.hue ?? 220, allotment: input.allotment, lastSeen: old?.lastSeen ?? new Date().toISOString() };
  rows = id ? rows.map(account => account.id === id ? next : account) : [...rows, next];
  const index = previewAccountRecords.findIndex(account => account.id === next.id);
  if (index < 0) previewAccountRecords.push(next);
  else previewAccountRecords[index] = next;
  if (input.password) previewPasswords.set(next.id, input.password);
  publishPreviewAccount(next);
  return this.list();
 },
 async password(id, password) {
  if (!password.trim()) throw new Error("Enter a new password.");
  previewPasswords.set(id, password);
 },
};
const liveAccounts:AccountsClient={async list(){return(await request<{accounts:ManagedAccount[]}>("/api/accounts")).accounts;},async save(id,input){await request(id?`/api/accounts/${encodeURIComponent(id)}`:"/api/accounts",id?"PATCH":"POST",input);return this.list();},async password(id,password){await request(`/api/accounts/${encodeURIComponent(id)}/password`,"POST",{password});}};
let dictationPreference:DictationSettings={engine:"xai",language:"auto"};let connected=false;
export const settings={
 engine:settingsApi,config:npiConfigApi,models:modelsConfigApi,mcp:mcpServersApi,bridges:bridgesApi,auth:authApi,
 accounts:SOURCES.accounts==="live"?liveAccounts:previewAccounts,
 dictation:{async get():Promise<DictationSettings>{return SOURCES.dictation==="live"?request("/api/settings/dictation"):{...dictationPreference};},async put(value:DictationSettings):Promise<DictationSettings>{if(SOURCES.dictation==="live")return request("/api/settings/dictation","PUT",value);dictationPreference={...value};return {...dictationPreference};}},
 github:{async status(){return {connected};},async connect(){connected=true;return {connected};}},
 state:()=>request<Record<string,unknown>>("/api/state"),health:()=>request<DeckHealth>("/api/health"),
};
