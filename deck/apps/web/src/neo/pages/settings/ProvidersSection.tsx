import { useCallback, useEffect, useState } from "react";
import type { EnvEntry, ProviderInfo } from "@npi-deck/protocol";
import { Card, Empty, NeoButton, NeoInput, Notice, SearchInput, SectionLabel } from "@/components/neo";
import { settings } from "../../client/settings";
import { ExposureTable } from "../UsagePage";
import { OAuthFlow } from "./OAuthFlow";

interface ProviderRow { id: string; name: string; oauth?: ProviderInfo; env?: EnvEntry }
const ENV_PROVIDER: Record<string, string> = { ANTHROPIC_API_KEY: "anthropic", OPENAI_API_KEY: "openai", OPENROUTER_API_KEY: "openrouter", GROQ_API_KEY: "groq", GOOGLE_API_KEY: "google", XAI_API_KEY: "xai" };
const configured = (provider: ProviderRow) => provider.oauth?.state === "oauth" || provider.oauth?.state === "api-key" || provider.env?.isSet === true;

export function ProvidersSection({ admin }: { admin: boolean }) {
 const [rows, setRows] = useState<ProviderRow[]>([]);
 const [notice, setNotice] = useState("");
 const [oauth, setOauth] = useState<{ id: string; name: string } | null>(null);
 const [editing, setEditing] = useState("");
 const [key, setKey] = useState("");
 const [busy, setBusy] = useState(false);
 const [loading, setLoading] = useState(true);
 const [query, setQuery] = useState("");
 const refresh = useCallback(async () => {
  try {
   const [providers, env] = await Promise.all([settings.auth.listProviders(), settings.engine.listEnv()]);
   const merged: ProviderRow[] = providers.providers.map(p => ({ id: p.id, name: p.name, oauth: p }));
   for (const entry of env.entries) {
    const id = ENV_PROVIDER[entry.key];
    if (!id) continue;
    const found = merged.find(p => p.id === id);
    if (found) found.env = entry;
    else merged.push({ id, name: { xai: "xAI", openai: "OpenAI", openrouter: "OpenRouter", groq: "Groq", google: "Google" }[id] ?? id, env: entry });
   }
   setRows(merged);
  } catch (error) { setNotice(String(error)); }
  finally { setLoading(false); }
 }, []);
 useEffect(() => { void refresh(); }, [refresh]);
 async function save(row: ProviderRow) {
  if (!row.env) return;
  setBusy(true);
  try {
   await settings.engine.patchEnv({ [row.env.key]: key });
   setEditing(""); setKey("");
   setNotice(row.env.source === "process-env" ? "Saved in the managed env file. Remove the launching process's value and restart to use it." : "Saved. Restart the server to apply this API key.");
   await refresh();
  } catch (error) { setNotice(String(error)); } finally { setBusy(false); }
 }
 async function signOut(row: ProviderRow) {
  setBusy(true);
  try {
   if (row.oauth?.state === "oauth") { await settings.auth.revoke(row.id); setNotice("Signed out."); }
   else if (row.env) {
    await settings.engine.patchEnv({ [row.env.key]: null });
    setNotice(row.env.source === "process-env" ? "Managed value removed. The launching process still supplies this key; remove it there and restart." : "Saved. Restart the server to stop using this API key.");
   }
   await refresh();
  } catch (error) { setNotice(String(error)); } finally { setBusy(false); }
 }
 const needle = query.trim().toLocaleLowerCase();
 const visible = rows.filter(provider => !needle || [provider.id, provider.name].some(value => value.toLocaleLowerCase().includes(needle))).sort((a, b) => Number(configured(b)) - Number(configured(a)));
 return <Card id="providers" title="Inference providers" description="Credentials used by the connected NeoPi runtime, separate from Deck sign-in and NeoProxy accounts.">
  <div className="neo-settings-stack">
   {notice && <Notice>{notice}</Notice>}
   <SearchInput pageSearch value={query} onChange={setQuery} placeholder="Find an inference provider" aria-label="Find an inference provider" />
   <div className="neo-settings-provider-list">
    {visible.map(provider => <div className="neo-settings-provider" key={provider.id} data-configured={configured(provider)}>
     <div className="neo-settings-provider-identity">
      <strong>{provider.name}</strong>
      <span className="neo-settings-description">{provider.oauth?.state === "oauth" ? `Signed in with OAuth${provider.oauth.count > 1 ? `, ${provider.oauth.count} accounts` : ""}` : configured(provider) ? "API key configured" : "Not configured"}</span>
      {editing === provider.id && <label className="neo-settings-field">API key<NeoInput aria-label={`API key for ${provider.name}`} type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} autoFocus /></label>}
     </div>
     <div className="neo-settings-actions">
      {editing === provider.id ? <><NeoButton size="sm" variant="primary" disabled={busy || !key.trim()} onClick={() => void save(provider)}>Save key</NeoButton><NeoButton size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(""); setKey(""); }}>Cancel</NeoButton></> : <>
       {provider.oauth && <NeoButton size="sm" disabled={busy} onClick={() => setOauth(provider)}>Sign in</NeoButton>}
       {provider.env && <NeoButton size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(provider.id); setKey(""); }}>Set API key</NeoButton>}
       {(provider.oauth?.state === "oauth" || provider.env?.isSet) && <NeoButton variant="ghost" size="sm" disabled={busy} onClick={() => void signOut(provider)}>{provider.oauth?.state === "oauth" ? "Sign out" : "Remove key"}</NeoButton>}
      </>}
     </div>
    </div>)}
    {!visible.length && <Empty title={loading ? "Loading inference providers" : rows.length ? "No matching providers" : "No inference providers available"} hint={loading ? undefined : rows.length ? "Try a provider name such as Anthropic or OpenAI." : "Check the NeoPi connection and reload this page."} />}
   </div>
   {admin && <div className="neo-settings-stack neo-settings-provider-visibility"><SectionLabel>Deck picker visibility</SectionLabel><p className="neo-settings-description">This preview catalogue controls what Deck pickers show. It does not configure credentials or change which models NeoProxy serves.</p><ExposureTable /></div>}
  </div>
  <OAuthFlow provider={oauth} onClose={() => setOauth(null)} onComplete={() => { setNotice("Saved. Provider signed in."); void refresh(); }} />
 </Card>;
}
