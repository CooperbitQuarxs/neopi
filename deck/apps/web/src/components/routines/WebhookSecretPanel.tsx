/**
 * Settings-tab panel for a routine's webhook: rotate the secret (shown once),
 * and, for a registration from before signed deliveries, a deprecation
 * warning while it still accepts the bare secret as its signature, with the
 * switch that stops accepting it. The server never sends the stored secret or
 * its hash here; the only plaintext is the one a rotation returns.
 */
import { useEffect, useState } from "react";
import { Copy, RefreshCcw } from "lucide-react";

import type { RoutineWebhookStatus } from "@npi-deck/protocol";

import { routinesApi } from "@/lib/routines-api";

export function WebhookSecretPanel({
	routineId,
	refreshKey,
	onError,
}: {
	routineId: string;
	/** Changes when the routine is saved, which can add, move or remove the webhook. */
	refreshKey: string;
	onError: (msg: string) => void;
}) {
	const [status, setStatus] = useState<RoutineWebhookStatus | null>(null);
	const [secret, setSecret] = useState<string | undefined>();
	const [busy, setBusy] = useState(false);
	const [confirmingRefusal, setConfirmingRefusal] = useState(false);

	useEffect(() => {
		let live = true;
		setSecret(undefined);
		setConfirmingRefusal(false);
		void routinesApi.webhookStatus(routineId).then((s) => {
			if (live) setStatus(s);
		}, (e: unknown) => {
			if (live) onError(String(e));
		});
		return () => { live = false; };
	}, [routineId, refreshKey, onError]);

	async function rotate(): Promise<void> {
		setBusy(true);
		try {
			const res = await routinesApi.rotateWebhookSecret(routineId);
			setSecret(res.secret);
			setStatus(await routinesApi.webhookStatus(routineId));
		} catch (e) {
			onError(String(e));
		} finally {
			setBusy(false);
		}
	}

	async function refuseBareSecret(): Promise<void> {
		setBusy(true);
		try {
			setStatus(await routinesApi.refuseWebhookBareSecret(routineId));
			setConfirmingRefusal(false);
		} catch (e) {
			onError(String(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="space-y-3 border-t border-[var(--neo-line-1)] pt-4">
			<div>
				<h3 className="text-[13px] font-medium text-ink">Webhook secret</h3>
			</div>
			{status ? (
				<div className="text-[12px] leading-relaxed text-ink-3">
					Senders sign each delivery: <code>X-Routine-Timestamp: &lt;unix seconds&gt;</code> and{" "}
					<code>X-Routine-Signature: sha256=&lt;hex HMAC-SHA256(secret, "&lt;timestamp&gt;.&lt;raw body&gt;")&gt;</code>.
					Deliveries more than five minutes from the deck's clock are refused.
				</div>
			) : null}
			{status?.acceptsBareSecret ? (
				<div
					role="alert"
					data-testid="webhook-bare-secret-warning"
					className="space-y-1.5 rounded-[var(--r-control)] border border-warn/30 bg-[var(--neo-warn-soft)] px-3 py-2 text-[12px] leading-relaxed text-warn"
				>
					<div>
						Deprecated: this webhook still accepts the bare secret as <code>X-Routine-Signature</code>. Anyone who
						sees one such delivery can replay it with any body, at any time.
					</div>
					<div>
						Last bare-secret delivery:{" "}
						{status.lastBareSecretAt ? new Date(status.lastBareSecretAt).toLocaleString() : "none since the upgrade"}.
					</div>
					{status.signingKeyStored ? (
						<div>Switch the sender to signed deliveries with the same secret, then stop accepting the bare secret.</div>
					) : (
						<div>
							The deck learns the secret from its next bare-secret delivery; until then only a rotated secret can sign.
						</div>
					)}
					{confirmingRefusal ? (
						<div className="space-y-1">
							<div>
								This cannot be undone: once refused, the bare secret is never accepted again, and a sender still
								using it gets <code>401</code>.
							</div>
							<div className="flex gap-1">
								<button
									type="button"
									disabled={busy}
									onClick={() => void refuseBareSecret()}
									className="neo-btn" data-size="sm"
								>
									Stop accepting it permanently
								</button>
								<button
									type="button"
									disabled={busy}
									onClick={() => setConfirmingRefusal(false)}
									className="neo-btn" data-size="sm"
								>
									Cancel
								</button>
							</div>
						</div>
					) : (
						<button
							type="button"
							disabled={busy}
							onClick={() => setConfirmingRefusal(true)}
							className="neo-btn" data-size="sm"
						>
							Stop accepting the bare secret
						</button>
					)}
				</div>
			) : null}
			<button type="button" disabled={busy} onClick={() => void rotate()} className="neo-btn" data-size="sm">
				<RefreshCcw className="h-3 w-3" />
				Rotate secret
			</button>
			{secret ? (
				<div className="space-y-1">
					<div className="text-[12px] text-warn">Copy it now; the secret is shown once.</div>
					<div className="flex items-center gap-1">
						<code className="neo-input neo-mono flex flex-1 items-center truncate">
							{secret}
						</code>
						<button
							type="button"
							onClick={() => {
								void navigator.clipboard.writeText(secret);
							}}
							className="neo-btn" data-variant="ghost" data-size="sm" data-icon="true"
							aria-label="Copy"
						>
							<Copy className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			) : null}
		</section>
	);
}
