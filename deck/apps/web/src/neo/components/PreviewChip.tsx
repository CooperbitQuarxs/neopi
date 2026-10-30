import { type Domain, isPreview } from "../client/source";

/**
 * The quiet marker a page carries when its data comes from a preview
 * adapter: the surface is real and interactive, the backend behind it is
 * not wired yet. Renders nothing once the domain goes live.
 */
export function PreviewChip({ domains, what }: { domains: Domain[]; what?: string }) {
	if (!isPreview(...domains)) return null;
	return (
		<span className="neo-preview" title={`${what ?? "This data"} comes from the preview adapter until its backend lands. See docs/design/backend-contracts.md.`}>
			preview data
		</span>
	);
}
