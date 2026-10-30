import { memo, type AnchorHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "./utils";
import { CopyButton } from "./CopyButton";

interface Props {
	children: string;
	className?: string;
	streaming?: boolean;
	relativeLinks?: "unavailable";
}

export const Markdown = memo(function Markdown({ children, className, streaming, relativeLinks }: Props) {
	return (
		<div className={cn("markdown text-sm", streaming && "cursor-blink", className)}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
				components={{ pre: CopyablePre, a: relativeLinks === "unavailable" ? DocumentAnchor : ExternalAnchor }}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
});

/**
 * Override for the markdown `<pre>` block.
 *
 * react-markdown passes the original `<code>` element as `children`; we keep
 * it intact so `rehype-highlight`'s class tagging survives, and just add a
 * `group relative` wrapper plus the overlaid `<CopyButton>`. The wrapper has
 * no padding/border so the `.markdown pre` margin still collapses correctly
 * with surrounding paragraphs and lists.
 */
function CopyablePre({ children, ...rest }: HTMLAttributes<HTMLPreElement> & { children?: ReactNode }) {
	return (
		<div className="group relative">
			<pre {...rest}>{children}</pre>
			<CopyButton />
		</div>
	);
}

function DocumentAnchor(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
	const href = props.href ?? "";
	if (!/^(https?:|mailto:|#)/i.test(href)) {
		return <span className="underline decoration-dotted" title={`Local reference: ${href}. Open this file in the skill's source directory; browser file reading is unavailable.`}>{props.children} <span className="text-muted-foreground text-xs">[local file]</span></span>;
	}
	return <ExternalAnchor {...props} />;
}

/**
 * Open external URLs in a new tab so clicking a link inside chat / inspector
 * markdown doesn't blow away the deck session. In-app links (relative paths,
 * anchors, custom schemes the surrounding view handles) fall through with
 * default behavior.
 */
function ExternalAnchor({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
	const external = typeof href === "string" && /^(https?:|mailto:)/i.test(href);
	return (
		<a
			{...rest}
			href={href}
			{...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
		>
			{children}
		</a>
	);
}
