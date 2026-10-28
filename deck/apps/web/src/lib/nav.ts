import {
	BookOpen,
	Clock,
	Eye,
	GitBranch,
	Home,
	Inbox,
	KanbanSquare,
	type LucideIcon,
	MessagesSquare,
	Network,
	Plug,
	Send,
	Settings,
	Sparkles,
	Store,
	Users,
	Workflow,
	Zap,
} from "lucide-react";

/**
 * The deck's information architecture. Order here is order on screen.
 *
 * Six groups, read top to bottom as "what do I do here":
 *   Work      — the front door: home, inbox, the board, conversations.
 *   Automate  — things that run without you.
 *   Agents    — the roster you talk to and compose.
 *   Library   — what the team knows and can do.
 *   Connect   — the engine and the outside world.
 *   Office    — people and this instance.
 *
 * `planned` marks an area that has a real page explaining what it will be
 * and that it is not built yet (see docs/vision in neocore). Hotkeys are
 * `g` then the letter, as in NeoPi's `/stats`.
 */
export interface NavItem {
	to: string;
	label: string;
	icon: LucideIcon;
	hotkey: string;
	planned?: boolean;
	/** Match exactly (for `/`) instead of by prefix. */
	end?: boolean;
	/** Extra paths that count as this item being active. */
	aliases?: readonly string[];
}

export interface NavGroup {
	heading: string;
	items: readonly NavItem[];
}

export const NAV: readonly NavGroup[] = [
	{
		heading: "Work",
		items: [
			{ to: "/legacy", label: "Home", icon: Home, hotkey: "h", end: true },
			{ to: "/legacy/inbox", label: "Inbox", icon: Inbox, hotkey: "i" },
			{ to: "/legacy/tasks", label: "Board", icon: KanbanSquare, hotkey: "b" },
			{ to: "/legacy/threads", label: "Threads", icon: MessagesSquare, hotkey: "t", aliases: ["/legacy/chat"] },
		],
	},
	{
		heading: "Automate",
		items: [
			{ to: "/legacy/routines", label: "Routines", icon: Clock, hotkey: "r" },
			{ to: "/legacy/flows", label: "Flows", icon: Workflow, hotkey: "f", planned: true },
		],
	},
	{
		heading: "Agents",
		items: [
			{ to: "/legacy/advisors", label: "Advisors", icon: Eye, hotkey: "a" },
			{ to: "/legacy/mixtures", label: "Mixtures", icon: Network, hotkey: "x" },
		],
	},
	{
		heading: "Library",
		items: [
			{ to: "/legacy/kb", label: "Knowledge", icon: BookOpen, hotkey: "k" },
			{ to: "/legacy/skills", label: "Skills", icon: Sparkles, hotkey: "s" },
			{ to: "/legacy/marketplace", label: "Marketplace", icon: Store, hotkey: "m" },
		],
	},
	{
		heading: "Connect",
		items: [
			{ to: "/legacy/neopi", label: "NeoPi", icon: Zap, hotkey: "n" },
			{ to: "/legacy/github", label: "GitHub", icon: GitBranch, hotkey: "g", planned: true },
			{ to: "/legacy/telegram", label: "Telegram", icon: Send, hotkey: "e" },
			{ to: "/legacy/integrations", label: "MCP servers", icon: Plug, hotkey: "c" },
		],
	},
	{
		heading: "Office",
		items: [
			{ to: "/legacy/people", label: "People", icon: Users, hotkey: "p", planned: true },
			{ to: "/legacy/settings", label: "Settings", icon: Settings, hotkey: "," },
		],
	},
];

export const NAV_ITEMS: readonly NavItem[] = NAV.flatMap((group) => group.items);

export function navItemForPath(pathname: string): NavItem | undefined {
	let best: NavItem | undefined;
	for (const item of NAV_ITEMS) {
		const paths = [item.to, ...(item.aliases ?? [])];
		for (const p of paths) {
			const match = item.end ? pathname === p : pathname === p || pathname.startsWith(`${p}/`);
			if (match && (!best || p.length > best.to.length)) best = item;
		}
	}
	return best;
}
