import { useCallback, useEffect, useState } from "react";
import { Notice } from "@/components/neo";

export interface AdvancedMessage { text: string; tone: "ok" | "warn"; }
export function useAdvancedNotice() {
	const [message, setMessage] = useState<AdvancedMessage | null>(null);
	useEffect(() => {
		if (!message) return;
		const timer = window.setTimeout(() => setMessage(null), 4000);
		return () => window.clearTimeout(timer);
	}, [message]);
	const notify = useCallback((text: string, tone: "ok" | "warn" = "ok") => setMessage({ text, tone }), []);
	return { message, notify };
}
export function AdvancedNotice({ message }: { message: AdvancedMessage | null }) {
	return message ? <Notice tone={message.tone}>{message.text}</Notice> : null;
}
export const advancedError = (error: unknown): string => error instanceof Error ? error.message : String(error);
