import { beforeAll, expect, it } from "bun:test";
import { initTheme } from "../src/theme/theme";
import { LogoutAccountSelectorComponent } from "../src/overlays/logout-account-selector";
import { ResetUsageSelectorComponent, type ResetUsageAccount } from "../src/overlays/reset-usage-selector";

beforeAll(async () => { await initTheme(); });

it("logout searches literally and restores bounds without Space logging out", () => {
	const picked: number[] = [];
	let cancelled = false;
	const accounts = Array.from({ length: 20 }, (_, credentialId) => ({ credentialId, provider: "test", label: `account ${credentialId}`, detail: "", type: "oauth" as const, active: credentialId === 0 }));
	const make = () => new LogoutAccountSelectorComponent("Test", accounts, account => picked.push(account.credentialId), () => { cancelled = true; });
	const selector = make();
	selector.handleInput("G");
	selector.handleInput("\x05");
	selector.handleInput(" ");
	expect(picked).toEqual([]);
	selector.handleInput("\r");
	expect(picked).toEqual([19]);
	selector.handleInput("/");
	selector.handleInput("account 1");
	selector.handleInput("\x1b");
	expect(cancelled).toBe(false);
	const snapshot = selector.navigationSnapshot();
	const restored = make();
	restored.restoreNavigation(snapshot);
	expect(restored.navigationSnapshot()).toEqual(snapshot);
});

it("reset requires explicit double Enter even after history restoration", () => {
	const picked: ResetUsageAccount[] = [];
	const accounts: ResetUsageAccount[] = Array.from({ length: 20 }, (_, credentialId) => ({ label: `account ${credentialId}`, provider: "test", providerLabel: "Test", availableCount: 1, redeemableCount: 1, target: { provider: "test", credentialId }, active: credentialId === 0 }));
	const make = () => new ResetUsageSelectorComponent(accounts, account => picked.push(account), () => {});
	const selector = make();
	selector.handleInput("G");
	selector.handleInput(" ");
	expect(picked).toEqual([]);
	selector.handleInput("\r");
	const snapshot = selector.navigationSnapshot();
	const restored = make();
	restored.restoreNavigation(snapshot);
	restored.handleInput("\r");
	expect(picked).toEqual([]);
	restored.handleInput("\r");
	expect(picked[0]?.target.credentialId).toBe(19);
});
