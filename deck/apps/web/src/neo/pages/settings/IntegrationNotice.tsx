import { useCallback, useEffect, useState } from "react";
import { Notice } from "@/components/neo";

interface IntegrationMessage {
	text: string;
	error: boolean;
}

export function useIntegrationNotice() {
	const [notice, setNotice] = useState<IntegrationMessage | null>(null);
	useEffect(() => {
		if (!notice) return;
		const timer = window.setTimeout(() => setNotice(null), 4000);
		return () => window.clearTimeout(timer);
	}, [notice]);
	const report = useCallback((text: string, error = false) => setNotice({ text, error }), []);
	return { notice, report };
}

export function IntegrationNotice({ notice }: { notice: IntegrationMessage | null }) {
	return notice ? <div role={notice.error ? "alert" : undefined}><Notice tone={notice.error ? "warn" : "ok"}>{notice.text}</Notice></div> : null;
}

export function integrationError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
