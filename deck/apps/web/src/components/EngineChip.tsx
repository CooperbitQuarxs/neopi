import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "@/lib/store";

const HEALTHY_MS = 10_000;
const WARN_MS = 20_000;

/**
 * Topbar status chip: one glance answers "is the deck alive, and is NeoPi
 * attached". The dot is the server heartbeat (green within 10 s, amber to
 * 20 s, red after); the word is the engine. Clicking opens Engine settings,
 * where the connection is explained and the backend can be switched.
 */
export function EngineChip() {
	const heartbeat = useStore((s) => s.heartbeat);
	const backend = useStore((s) => s.backend);
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, []);

	const gap = heartbeat ? now - heartbeat.lastReceivedAtMs : Infinity;
	const tone = !heartbeat ? "bad" : gap < HEALTHY_MS ? "live" : gap < WARN_MS ? "warn" : "bad";
	const word = backend ? "NeoPi" : "No engine";
	const detail = backend ? (backend.version ?? backend.commit?.slice(0, 7) ?? backend.id ?? "") : heartbeat ? "deck only" : "connecting";
	const title = [
		`deck: ${!heartbeat ? "no heartbeat yet" : tone === "live" ? "connected" : tone === "warn" ? "reconnecting" : "disconnected"}`,
		backend ? `engine: ${backend.path}` : "engine: none attached (chat is unavailable; inbox, board and routines still work)",
	].join("\n");

	return (
		<Link to="/settings#engine" className="neo-chip" title={title} aria-label={`${word} ${detail}`}>
			<span className="neo-dot" data-tone={tone} data-pulse={tone === "live" ? "true" : undefined} />
			<span>{word}</span>
			{detail ? <span className="neo-chip-detail">{detail}</span> : null}
			<span className="neo-engine-location" title="Deck connection">{window.location.host}</span>
		</Link>
	);
}
