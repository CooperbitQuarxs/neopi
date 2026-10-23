/**
 * Accounts and the signed-in session. Contract (backend-contracts.md §1):
 *   POST /api/auth/login  { handle, password } → { account, token }
 *   GET  /api/auth/me                          → { account } | 401
 *   POST /api/auth/logout
 * The preview adapter keeps the session in localStorage and knows three
 * office accounts; any of them signs in with the password `deck`.
 */
import { useSyncExternalStore } from "react";
import { PREVIEW_ACCOUNTS, type Account } from "./preview-data";
import { SOURCES } from "./source";

export type { Account };

export interface AuthClient {
	login(handle: string, password: string): Promise<Account>;
	me(): Promise<Account | null>;
	logout(): Promise<void>;
}
/** Shared mutable preview directory. Account settings and sign-in use the same records. */
export const previewAccountRecords: Account[] = PREVIEW_ACCOUNTS.map(account => ({ ...account }));
export const previewPasswords = new Map(PREVIEW_ACCOUNTS.map(account => [account.id, "deck"]));

/** Refresh the signed-in account after an in-memory account edit. */
export function publishPreviewAccount(account: Account): void {
	if (cached?.id !== account.id) return;
	cached = account;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
	emit();
}

const STORAGE_KEY = "neodeck.session";
const listeners = new Set<() => void>();
let cached: Account | null | undefined;

function emit(): void {
	for (const fn of listeners) fn();
}

function readStored(): Account | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as Account) : null;
	} catch {
		return null;
	}
}

const previewAuth: AuthClient = {
	async login(handle, password) {
		await new Promise((r) => setTimeout(r, 350));
		const account = previewAccountRecords.find((a) => a.handle === handle.trim().toLowerCase());
		if (!account || password !== previewPasswords.get(account.id)) throw new Error("That handle and password do not match an account on this deck.");
		localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
		cached = account;
		emit();
		return account;
	},
	async me() {
		if (cached === undefined) cached = readStored();
		return cached;
	},
	async logout() {
		localStorage.removeItem(STORAGE_KEY);
		cached = null;
		emit();
	},
};

const liveAuth: AuthClient = {
	async login(handle, password) {
		const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle, password }) });
		if (!res.ok) throw new Error(res.status === 401 ? "That handle and password do not match an account on this deck." : `Sign-in failed (${res.status}).`);
		const body = (await res.json()) as { account: Account };
		cached = body.account;
		emit();
		return body.account;
	},
	async me() {
		const res = await fetch("/api/auth/me");
		cached = res.ok ? ((await res.json()) as { account: Account }).account : null;
		return cached;
	},
	async logout() {
		await fetch("/api/auth/logout", { method: "POST" });
		cached = null;
		emit();
	},
};

export const auth: AuthClient = SOURCES.auth === "live" ? liveAuth : previewAuth;

/** The signed-in account, `null` when signed out, `undefined` until checked. */
export function useAccount(): Account | null | undefined {
	return useSyncExternalStore(
		(fn) => {
			listeners.add(fn);
			if (cached === undefined) void auth.me().then(emit);
			return () => listeners.delete(fn);
		},
		() => cached,
		() => cached,
	);
}
