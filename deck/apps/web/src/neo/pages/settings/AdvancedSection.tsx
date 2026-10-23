import { useEffect, useState } from "react";
import { Card, NeoBadge, Tabs } from "@/components/neo";
import { useStore } from "@/lib/store";
import { AdvancedDeck } from "./AdvancedDeck";
import { AdvancedEnvironment } from "./AdvancedEnvironment";
import { ConfigSection } from "./ConfigSection";
import "./AdvancedSection.css";

type AdvancedTab = "environment" | "neopi" | "deck";
export function AdvancedSection({ admin }: { admin: boolean }) {
	return admin ? <AdvancedAdmin /> : <Card id="advanced" title="Advanced"><p className="neo-settings-description">Advanced settings are for admins.</p></Card>;
}
function AdvancedAdmin() {
	const [tab, setTab] = useState<AdvancedTab>("environment");
	const [revision, setRevision] = useState(0);
	const generation = useStore(store => store.workerGeneration);
	useEffect(() => { setRevision(current => current + 1); }, [generation]);
	useEffect(() => {
		const refresh = () => { if (window.location.hash === "#advanced") setRevision(current => current + 1); };
		const clicked = (event: MouseEvent) => {
			if (!(event.target instanceof Element)) return;
			const link = event.target.closest("a");
			if (link?.hash === "#advanced") setRevision(current => current + 1);
		};
		window.addEventListener("hashchange", refresh);
		document.addEventListener("click", clicked);
		return () => { window.removeEventListener("hashchange", refresh); document.removeEventListener("click", clicked); };
	}, []);
	return <Card id="advanced" title="Advanced" description="Environment, every NeoPi setting and the deck's runtime facts." actions={<NeoBadge>admin</NeoBadge>}>
		<div className="neo-settings-stack">
			<Tabs label="Advanced settings" value={tab} onChange={next => { setTab(next); setRevision(current => current + 1); }} options={[{ value: "environment", label: "Environment" }, { value: "neopi", label: "NeoPi config" }, { value: "deck", label: "Deck config" }]} />
			<div role="tabpanel" aria-label={tab === "environment" ? "Environment" : tab === "neopi" ? "NeoPi config" : "Deck config"}>
				{tab === "environment" ? <AdvancedEnvironment /> : tab === "neopi" ? <ConfigSection revision={revision} /> : <AdvancedDeck />}
			</div>
		</div>
	</Card>;
}
