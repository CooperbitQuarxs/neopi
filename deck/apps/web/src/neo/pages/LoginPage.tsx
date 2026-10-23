/**
 * `/login`: the office door. One card, two fields, nothing floating. The
 * preview adapter accepts the three office accounts with the password
 * `deck` and says so under the form; a live backend removes that line.
 */
import { type FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { NeoMark } from "@/components/BrandLockup";
import { NeoButton, NeoInput } from "@/components/neo";
import { auth, useAccount } from "../client/auth";
import { PREVIEW_ACCOUNTS } from "../client/preview-data";
import { isPreview } from "../client/source";

export function LoginPage() {
	const account = useAccount();
	const navigate = useNavigate();
	const location = useLocation();
	const [handle, setHandle] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const from = (location.state as { from?: string } | null)?.from ?? "/inbox";

	useEffect(() => {
		if (account) navigate(from, { replace: true });
	}, [account, from, navigate]);

	async function submit(e: FormEvent): Promise<void> {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await auth.login(handle, password);
			navigate(from, { replace: true });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="neo-login">
			<div className="neo-ambient" />
			<form className="neo-login-card neo-rise" onSubmit={(e) => void submit(e)}>
				<div className="neo-login-lockup">
					<NeoMark size={28} />
					<span className="neo-login-brand">
						NeoPi <span className="neo-brand-slash">/</span> <span className="neo-brand-title">deck</span>
					</span>
				</div>
				<h1 className="neo-login-title">Sign in to the office</h1>
				<p className="neo-login-lede">Your threads, your inbox, your share of the engine.</p>

				<label className="neo-field">
					<span className="neo-field-label">Handle</span>
					<NeoInput autoComplete="username" autoFocus value={handle} onChange={(e) => setHandle(e.target.value)} mono spellCheck={false} />
				</label>
				<label className="neo-field">
					<span className="neo-field-label">Password</span>
					<NeoInput type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
				</label>
				{error ? (
					<p className="neo-field-error" role="alert">
						{error}
					</p>
				) : null}
				<NeoButton type="submit" variant="primary" className="neo-login-submit" disabled={busy || handle.trim() === "" || password === ""}>
					{busy ? "Signing in…" : "Sign in"}
				</NeoButton>

				{isPreview("auth") ? (
					<p className="neo-login-preview">
						<span className="neo-preview">preview data</span>
						Accounts on this deck: {PREVIEW_ACCOUNTS.map((a) => a.handle).join(", ")}. The password is <code className="neo-mono">deck</code>.
					</p>
				) : null}
			</form>
		</div>
	);
}
