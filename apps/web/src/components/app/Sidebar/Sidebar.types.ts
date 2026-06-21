import type { Project } from '@/lib/bridge';
import type { AppView, NavItem } from '../AppShell/AppShell.types';

export interface SidebarProps {
  projects: Project[];
  active: Project | null;
  view: AppView;
  nav: NavItem[];
  collapsed: boolean;
  switcherOpen: boolean;
  runningCount: number;
  version: string;
  onToggleCollapsed: () => void;
  onToggleSwitcher: () => void;
  onNavigate: (view: AppView) => void;
  onPickProject: (id: string) => void;
  onNewProject: () => void;
}
