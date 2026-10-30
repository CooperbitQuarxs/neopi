import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { isRouteErrorResponse, useLocation, useRouteError } from "react-router-dom";
import { BrandLockup } from "@/components/BrandLockup";
import { NeoButton, NeoLinkButton } from "@/components/neo";
import "./route-error.css";

/** Kept independent of page data so a failed shell can still offer a way out. */
export function RouteErrorPage({ notFound = false }: { notFound?: boolean }) {
	const error = useRouteError();
	const location = useLocation();
	const missing = notFound || (isRouteErrorResponse(error) && error.status === 404);
	return (
		<div className="neo-route-recovery">
			<header><BrandLockup page={missing ? "Page not found" : "Page error"} /></header>
			<main className="neo-route-recovery-panel" aria-labelledby="route-error-title">
				<TriangleAlert size={28} aria-hidden="true" />
				<h1 id="route-error-title">{missing ? "This page does not exist" : "This page could not open"}</h1>
				<p>{missing ? "The link may be out of date. Open the Inbox, or go back to where you were." : "Reload to try again, or open another part of the deck."}</p>
				<code>{location.pathname}</code>
				<div className="neo-route-recovery-actions">
					<NeoLinkButton to="/inbox" variant="primary">Open Inbox</NeoLinkButton>
					{!missing && <NeoButton onClick={() => window.location.reload()}><RefreshCw size={14} />Reload page</NeoButton>}
					<NeoButton variant="ghost" onClick={() => window.history.back()}><ArrowLeft size={14} />Go back</NeoButton>
				</div>
				{!missing && <details><summary>Error details</summary><pre>{error instanceof Error ? error.message : isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : "An unexpected page error occurred."}</pre></details>}
			</main>
		</div>
	);
}
