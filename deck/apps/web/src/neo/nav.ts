import { BookOpen, Bot, Gauge, GitBranch, Inbox, KanbanSquare, type LucideIcon, MessagesSquare, Settings, SlidersHorizontal, Sparkles, Workflow } from "lucide-react";

/**
 * The deck's places, grouped by what a person does there, read top to
 * bottom: the office's work, the agents that do it, what the office knows,
 * and the engine underneath. See docs/design/neodeck-architecture.md §2.
 * Hotkeys are `G` then the letter, as in NeoPi's `/stats`.
 */
export interface NavItem {
	to: string;
	label: string;
	icon: LucideIcon;
	hotkey: string;
	/** One line under the title on the page itself. */
	blurb: string;
}

export interface NavGroup {
	heading: string;
	items: readonly NavItem[];
}

export const NAV: readonly NavGroup[] = [
	{
		heading: "Office",
		items: [
			{ to: "/inbox", label: "Inbox", icon: Inbox, hotkey: "i", blurb: "Everything that lands on the office, before it becomes work." },
			{ to: "/board", label: "Board", icon: KanbanSquare, hotkey: "b", blurb: "One board, every project. Cards carry their own evidence." },
			{ to: "/threads", label: "Threads", icon: MessagesSquare, hotkey: "t", blurb: "Talk to agents. Several can share one thread." },
		],
	},
	{
		heading: "Agents",
		items: [
			{ to: "/agents", label: "Agents", icon: Bot, hotkey: "a", blurb: "Everyone alive on the deck, the templates they came from, and what the judge saw." },
			{ to: "/studio", label: "Studio", icon: Workflow, hotkey: "u", blurb: "Graphs you build: flows, pipelines, routers, classifiers, and the map." },
		],
	},
	{
		heading: "Library",
		items: [
			{ to: "/knowledge", label: "Knowledge", icon: BookOpen, hotkey: "k", blurb: "What the office knows, as notes and as a map." },
			{ to: "/skills", label: "Skills", icon: Sparkles, hotkey: "s", blurb: "What agents can do here, and what they could install." },
		],
	},
	{
		heading: "Engine",
		items: [
			{ to: "/github", label: "GitHub", icon: GitBranch, hotkey: "g", blurb: "Repositories, issues and pull requests; the wheel that turns ideas into merges." },
			{ to: "/usage", label: "Usage", icon: Gauge, hotkey: "y", blurb: "Your share of the pools, and what you spent." },
			{ to: "/models", label: "Models", icon: SlidersHorizontal, hotkey: "m", blurb: "Model roles, effort rules and inference providers." },
			{ to: "/settings", label: "Settings", icon: Settings, hotkey: ",", blurb: "The engine, accounts, integrations and appearance." },
		],
	},
];

export const NAV_ITEMS: readonly NavItem[] = NAV.flatMap((group) => group.items);

export function navItemForPath(pathname: string): NavItem | undefined {
	let best: NavItem | undefined;
	for (const item of NAV_ITEMS) {
		if ((pathname === item.to || pathname.startsWith(`${item.to}/`)) && (!best || item.to.length > best.to.length)) best = item;
	}
	return best;
}
