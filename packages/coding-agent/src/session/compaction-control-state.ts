import type { Settings } from "../config/settings";

/** Ownership of ad-hoc changes, separate from CLI and subagent runtime settings. */
export const sessionCompactionControlKeys = new WeakMap<Settings, Set<string>>();
