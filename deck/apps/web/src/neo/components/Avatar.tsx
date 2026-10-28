import type { Account } from "../client/preview-data";

/** Initial on a hue-tinted disc; the hue is the account's, so the same person looks the same everywhere. */
export function Avatar({ account, size = 20 }: { account: Pick<Account, "name" | "hue">; size?: number }) {
	return (
		<span
			className="neo-avatar"
			style={{ width: size, height: size, fontSize: Math.round(size * 0.5), background: `oklch(0.42 0.11 ${account.hue})`, color: `oklch(0.92 0.06 ${account.hue})` }}
			aria-hidden="true"
		>
			{account.name.slice(0, 1).toUpperCase()}
		</span>
	);
}
