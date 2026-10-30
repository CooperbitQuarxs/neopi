import { useEffect, useRef } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useNavigate, type RouteObject } from "react-router-dom";
import { ChatView } from "./views/ChatView";
import { TasksView } from "./views/TasksView";
import { RoutinesView } from "./views/RoutinesView";
import { RunDetailView } from "./views/RunDetailView";
import { InboxView } from "./views/InboxView";
import { MarketplaceView } from "./views/MarketplaceView";
import { KbView } from "./views/KbView";
import { SkillsView } from "./views/SkillsView";
import { SettingsView } from "./views/SettingsView";
import { IntegrationsView } from "./views/IntegrationsView";
import { OnboardingView } from "./views/OnboardingView";
import { AdvisorsView } from "./views/AdvisorsView";
import { MixturesView } from "./views/MixturesView";
import { HomeView } from "./views/HomeView";
import { FlowsView, GitHubView, NeoPiView, PeopleView, TelegramView } from "./views/PlannedViews";
import { onboardingApi } from "./lib/onboarding-api";
import { Shell, useDeckBootstrap } from "./neo/Shell";
import { useAccount } from "./neo/client/auth";
import { LoginPage } from "./neo/pages/LoginPage";
import { InboxPage } from "./neo/pages/InboxPage";
import { BoardPage } from "./neo/pages/BoardPage";
import { ThreadsPage } from "./neo/pages/ThreadsPage";
import { AgentsPage } from "./neo/pages/AgentsPage";
import { StudioPage } from "./neo/pages/StudioPage";
import { KnowledgePage } from "./neo/pages/KnowledgePage";
import { SkillsPage } from "./neo/pages/SkillsPage";
import { GitHubPage } from "./neo/pages/GitHubPage";
import { UsagePage } from "./neo/pages/UsagePage";
import { SettingsPage } from "./neo/pages/SettingsPage";
import { ModelsPage } from "./neo/pages/ModelsPage";
import { NAV_ITEMS } from "./neo/nav";
import { RouteErrorPage } from "./neo/pages/RouteErrorPage";

/**
 * First-paint redirect: if the server reports `needsOnboarding`, route
 * brand-new users to the wizard, and everyone else to Inbox. Only triggers
 * once per page load and only when the user lands on `/` — typing any
 * other URL bypasses the gate (the wizard is escapable, and we don't
 * want to re-trap users who already saw it).
 */
function OnboardingGate() {
	const navigate = useNavigate();
	const location = useLocation();
	const checked = useRef(false);
	const currentPath = useRef(location.pathname);
	currentPath.current = location.pathname;
	useEffect(() => {
		if (checked.current) return;
		checked.current = true;
		if (location.pathname !== "/legacy") return; // user explicitly navigated; respect that
		void onboardingApi
			.state()
			.then((state) => {
				if (currentPath.current !== "/legacy") return;
				if (state.needsOnboarding) navigate("/legacy/onboarding", { replace: true });
			})
			.catch(() => {
				// State endpoint failed — don't block the app. Onboarding can be
				// re-run from Settings if the gate misfires; `/` is Home either way.
			});
	}, [location.pathname, navigate]);
	return <Outlet />;
}

/** The new deck sits behind the login gate; the store boots once inside it. */
function RequireAuth() {
	const account = useAccount();
	const location = useLocation();
	if (account === undefined) return null;
	if (account === null) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
	return <Booted />;
}

function Booted() {
	useDeckBootstrap();
	return <Shell />;
}

/** One component per place; the route is `${to}/*` so a place owns its own sub-paths. */
const PLACE_PAGES: Record<string, JSX.Element> = {
	"/inbox": <InboxPage />,
	"/board": <BoardPage />,
	"/threads": <ThreadsPage />,
	"/agents": <AgentsPage />,
	"/studio": <StudioPage />,
	"/knowledge": <KnowledgePage />,
	"/skills": <SkillsPage />,
	"/github": <GitHubPage />,
	"/usage": <UsagePage />,
	"/settings": <SettingsPage />,
	"/models": <ModelsPage />,
};

/** Guard every leaf and layout, including failures above the authenticated shell. */
function withRouteErrors(routes: RouteObject[]): RouteObject[] {
	for (const route of routes) {
		route.errorElement = <RouteErrorPage />;
		if (route.children) withRouteErrors(route.children);
	}
	return routes;
}

const router = createBrowserRouter(withRouteErrors([
	{ path: "/login", element: <LoginPage /> },
	{
		element: <RequireAuth />,
		children: [
			{ path: "/", element: <Navigate to="/inbox" replace /> },
			...NAV_ITEMS.map((item) => ({ path: `${item.to}/*`, element: PLACE_PAGES[item.to] })),
			{ path: "/chat", element: <Navigate to="/threads" replace /> },
			{ path: "/tasks", element: <Navigate to="/board" replace /> },
			{ path: "/kb", element: <Navigate to="/knowledge" replace /> },
			{ path: "/routines", element: <Navigate to="/studio" replace /> },
		],
	},
	{
		element: <OnboardingGate />,
		children: [
			{ path: "/legacy", element: <HomeView /> },
			{ path: "/legacy/threads", element: <ChatView /> },
			{ path: "/legacy/chat", element: <ChatView /> },
			{ path: "/legacy/flows", element: <FlowsView /> },
			{ path: "/legacy/github", element: <GitHubView /> },
			{ path: "/legacy/telegram", element: <TelegramView /> },
			{ path: "/legacy/neopi", element: <NeoPiView /> },
			{ path: "/legacy/people", element: <PeopleView /> },
			{ path: "/legacy/tasks", element: <TasksView /> },
			{ path: "/legacy/routines", element: <RoutinesView /> },
			{ path: "/legacy/routines/:id/runs/:runId", element: <RunDetailView /> },
			{ path: "/legacy/inbox", element: <InboxView /> },
			{ path: "/legacy/marketplace", element: <MarketplaceView /> },
			{ path: "/legacy/skills", element: <SkillsView /> },
			{ path: "/legacy/kb", element: <KbView /> },
			{ path: "/legacy/integrations", element: <IntegrationsView /> },
			{ path: "/legacy/advisors", element: <AdvisorsView /> },
			{ path: "/legacy/mixtures", element: <MixturesView /> },
			{ path: "/legacy/settings", element: <SettingsView /> },
			{ path: "/legacy/onboarding", element: <OnboardingView /> },
		],
	},
	{ path: "*", element: <RouteErrorPage notFound /> },
]));

export function AppRouter() {
	return <RouterProvider router={router} />;
}
