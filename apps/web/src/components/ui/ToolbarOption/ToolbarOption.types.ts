/** Prop types for the ToolbarOption primitive. */
import type { ReactNode } from 'react';

/** Props for a toolbar feature pill: icon, label, inline switch, and optional
 *  settings popover. */
export interface ToolbarOptionProps {
  /** Visible label beside the icon. */
  label: string;
  /** Whether the feature is on. */
  on: boolean;
  /** Toggle the feature on/off. */
  onToggle: () => void;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Optional trailing badge (e.g. a count). */
  badge?: ReactNode;
  /** Tooltip on the main toggle section. */
  title?: string;
  /** Accessible name for the settings trigger; defaults to "{label} options". */
  settingsLabel?: string;
  /** Icon for the settings trigger; defaults to a gear. */
  settingsIcon?: ReactNode;
  /** Popover body; omit to hide the settings trigger. */
  settings?: ReactNode;
  className?: string;
}
