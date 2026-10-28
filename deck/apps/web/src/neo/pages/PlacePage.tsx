import { Card, Empty, Page, PageHeader } from "@/components/neo";
import type { NavItem } from "../nav";

/** A place whose page is designed but not yet built: the header is final, the body says so plainly. */
export function PlacePage({ item }: { item: NavItem }) {
	return (
		<div className="h-full overflow-y-auto">
			<Page>
				<PageHeader title={item.label} description={item.blurb} />
				<Card index={1}>
					<Empty icon={item.icon} title={`${item.label} is being built`} hint="The layout is decided in docs/design/neodeck-architecture.md; this page lands in its own pull request." />
				</Card>
			</Page>
		</div>
	);
}
