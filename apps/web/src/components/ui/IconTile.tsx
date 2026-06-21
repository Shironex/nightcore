import type { ReactNode } from 'react';

type IconTileSize = 'sm' | 'md' | 'lg';

interface IconTileProps {
  children: ReactNode;
  /** sm ≈ switcher/dialog (22–34px), md ≈ settings card header (42px), lg ≈ page header (54px). */
  size?: IconTileSize;
  className?: string;
}

const SIZES: Record<IconTileSize, string> = {
  sm: 'h-[34px] w-[34px] rounded-[9px]',
  md: 'h-[42px] w-[42px] rounded-xl',
  lg: 'h-[54px] w-[54px] rounded-[15px]',
};

/** A rounded-square icon tile — `bg-primary/15 text-primary` holding a lucide
 *  icon. The design's treatment for settings card headers, the project icon, and
 *  dialog headers. The icon inside inherits `currentColor` (primary). */
export function IconTile({ children, size = 'md', className }: IconTileProps) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center bg-primary/15 text-primary ${SIZES[size]} ${className ?? ''}`}
    >
      {children}
    </span>
  );
}
