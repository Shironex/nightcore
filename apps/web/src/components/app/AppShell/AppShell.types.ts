/** The top-level surfaces the shell routes between. New Project and the
 *  Logs/TaskDetail drawer are overlays, not routes. */
export type AppView =
  | 'board'
  | 'worktrees'
  | 'understand'
  | 'insight'
  | 'scorecard'
  | 'harness'
  // The Harden / Enforce destinations (Phase-1 view rethink, PR 2): two view
  // filters over the ONE HarnessView run/store. Added additively alongside the
  // unified `harness` route, which PR 3 removes when the nav regroups.
  | 'harden'
  | 'enforce'
  | 'prreview'
  | 'issuetriage'
  | 'projects'
  | 'settings';

import type { ReactNode } from 'react';

/** Sidebar nav section ids — main groups plus footer-placed settings. */
export type NavGroupId = 'project' | 'tools' | 'settings';

/** A nav entry in the sidebar workspace section. */
export interface NavItem {
  view: AppView;
  label: string;
  /** Single-letter keyboard hint shown as a Kbd chip. */
  hint: string;
  icon: ReactNode;
  group: NavGroupId;
}
