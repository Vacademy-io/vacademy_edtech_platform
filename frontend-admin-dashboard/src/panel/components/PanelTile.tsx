/**
 * Large launch tile for the Home grid (a real <button>; ≥ h-48, 240 px on a
 * 1920-wide panel). No hover-only affordance: pressed state is `active:`.
 */
import type { ReactNode } from 'react';
import { LockSimple, type Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export interface PanelTileProps {
    icon: Icon;
    label: string;
    description?: string;
    onClick: () => void;
    disabled?: boolean;
    /** Shows a lock and this text (e.g. "Sign in to use"); the tile stays tappable. */
    lockedLabel?: string;
    /** Extra content under the label (a status chip, a count). */
    children?: ReactNode;
    className?: string;
}

export function PanelTile({
    icon: IconComponent,
    label,
    description,
    onClick,
    disabled,
    lockedLabel,
    children,
    className,
}: PanelTileProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'relative flex min-h-48 w-full flex-col items-start justify-between rounded-lg border border-border bg-card p-6 text-left shadow-sm transition-colors',
                'active:border-primary-500 active:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50',
                'focus:outline-none focus:ring-2 focus:ring-primary-300',
                className
            )}
        >
            <IconComponent
                size={64}
                weight="duotone"
                className={cn(lockedLabel ? 'text-neutral-400' : 'text-primary-500')}
                aria-hidden
            />
            <div className="w-full space-y-1 pt-4">
                <span className="block text-h2 font-semibold text-neutral-800">{label}</span>
                {description && (
                    <span className="block text-subtitle text-neutral-500">{description}</span>
                )}
                {lockedLabel && (
                    <span className="flex items-center space-x-2 text-subtitle text-neutral-500">
                        <LockSimple size={20} aria-hidden />
                        <span>{lockedLabel}</span>
                    </span>
                )}
                {children}
            </div>
        </button>
    );
}
