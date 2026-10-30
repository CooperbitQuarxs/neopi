import type { BridgeInfo } from "./index.ts";

export interface TelegramConversation {
	id: string;
	chatId: string;
	userId: string;
	label: string;
	threadId?: number;
	directTopicId?: number;
	lastSeenAt: string;
	mode: "task" | "capture" | "chat";
	notify: boolean;
	sessionId?: string;
	lastNotificationAt?: string;
	lastError?: string;
}

export interface TelegramPairing {
	code: string;
	expiresAt: string;
	url?: string;
}

export interface TelegramSetup {
	bridge: BridgeInfo;
	configured: boolean;
	restartRequired: boolean;
	allowedUsers: string;
	allowedGroups: string;
	requireMention: boolean;
	lockedFields: string[];
	pairedUsers: Array<{ id: string; label: string; pairedAt: string }>;
	conversations: TelegramConversation[];
	runtime: { username?: string; polledAt?: string; error?: string };
}
