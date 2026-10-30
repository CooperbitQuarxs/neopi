import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Drawer, NeoBadge, NeoButton, SectionLabel } from "@/components/neo";
import { settings } from "../../client/settings";
import { PreviewChip } from "../../components/PreviewChip";
import { IntegrationNotice, integrationError, useIntegrationNotice } from "./IntegrationNotice";
import { McpIntegrationCard } from "./McpIntegrationCard";
import { TelegramIntegration } from "./TelegramIntegration";
import "./Integrations.css";

export function IntegrationsSection() {
	return <section id="integrations" className="neo-settings-stack">
		<SectionLabel>Integrations</SectionLabel>
		<TelegramIntegration />
		<div className="neo-grid neo-grid-3 neo-settings-integrations-grid">
			<GitHubCard />
			<McpIntegrationCard />
		</div>
	</section>;
}


function GitHubCard() {
	const [connected, setConnected] = useState<boolean | null>(null);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const { notice, report } = useIntegrationNotice();
	const refresh = useCallback(async () => {
		try { setConnected((await settings.github.status()).connected); }
		catch (error) { report(integrationError(error), true); }
	}, [report]);
	useEffect(() => { void refresh(); }, [refresh]);
	async function connect() {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			setConnected((await settings.github.connect()).connected);
			report("GitHub connection updated in preview.");
		} catch (error) { report(integrationError(error), true); }
		finally { busyRef.current = false; setBusy(false); }
	}
	return <>
		<Card title="GitHub app" description="Repositories, issues and pull requests." actions={<PreviewChip domains={["github"]} />}>
			<div className="neo-settings-stack">
				{!open && <IntegrationNotice notice={notice} />}
				<NeoBadge>{connected === null ? "Checking connection" : connected ? "Connected" : "Not connected"}</NeoBadge>
				<p className="neo-settings-description">Choose the repositories the office can access.</p>
				<div className="neo-settings-actions"><NeoButton size="sm" onClick={() => setOpen(true)}>{connected ? "View connection" : "Connect"}</NeoButton>{connected === null && <NeoButton size="sm" variant="ghost" onClick={() => void refresh()}>Refresh</NeoButton>}</div>
			</div>
		</Card>
		<Drawer open={open} onClose={() => setOpen(false)} title="Connect GitHub" subtitle={<PreviewChip domains={["github"]} />} footer={<NeoButton variant="primary" disabled={busy || connected === true} onClick={() => void connect()}>{busy ? "Connecting..." : connected ? "Connected in preview" : "Connect in preview"}</NeoButton>}>
			<div className="neo-settings-stack">
				<IntegrationNotice notice={notice} />
				<p>Install the NeoDeck GitHub app on your account or organization, then choose the repositories it may access.</p>
				<p className="neo-settings-description">The live installation flow will open GitHub for approval and return here with the connection status. This preview changes only the in-memory connection. It does not install an app or grant repository access.</p>
				{connected && <NeoBadge>Connected in preview</NeoBadge>}
			</div>
		</Drawer>
	</>;
}
