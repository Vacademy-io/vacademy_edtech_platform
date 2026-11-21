import type { ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/*
 * Page header and small status pill shared by the redesigned Manage Institute and
 * Admissions screens: an icon tile, the title (with an optional count badge), one line
 * of explanation and the page's own action buttons on the right. Layout only — every
 * action is passed in by the page, so the page keeps its own handlers.
 */

export type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'neutral';

const PILL: Record<PillTone, { pill: string; dot: string }> = {
    success: { pill: 'bg-success-50 text-success-700', dot: 'bg-success-500' },
    warning: { pill: 'bg-warning-50 text-warning-700', dot: 'bg-warning-500' },
    danger: { pill: 'bg-danger-50 text-danger-700', dot: 'bg-danger-500' },
    info: { pill: 'bg-info-50 text-info-700', dot: 'bg-info-500' },
    primary: { pill: 'bg-primary-50 text-primary-600', dot: 'bg-primary-500' },
    neutral: { pill: 'bg-neutral-100 text-neutral-600', dot: 'bg-neutral-400' },
};

/** A rounded status label with a coloured dot. */
export function StatusPill({
    tone = 'neutral',
    children,
    className,
}: {
    tone?: PillTone;
    children: ReactNode;
    className?: string;
}) {
    return (
        <span
            className={cn(
                'inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-medium',
                PILL[tone].pill,
                className
            )}
        >
            <span className={cn('size-1.5 shrink-0 rounded-full', PILL[tone].dot)} />
            <span className="text-caption">{children}</span>
        </span>
    );
}

/** A grey count chip, e.g. beside a title or a section heading. */
export function CountChip({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <span
            className={cn(
                'inline-flex w-fit items-center whitespace-nowrap rounded-full bg-neutral-100 px-2.5 py-0.5 font-medium tabular-nums text-neutral-600',
                className
            )}
        >
            <span className="text-caption">{children}</span>
        </span>
    );
}

export function ScreenHeader({
    icon: HeaderIcon,
    title,
    badge,
    subtitle,
    actions,
    back,
    className,
}: {
    icon: Icon;
    title: ReactNode;
    badge?: ReactNode;
    subtitle?: ReactNode;
    actions?: ReactNode;
    /** Optional "Back to …" link rendered above the title. */
    back?: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('flex flex-col gap-2', className)}>
            {back}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
                        <HeaderIcon size={20} weight="duotone" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="font-semibold text-neutral-900">
                                <span className="text-h2">{title}</span>
                            </h1>
                            {badge}
                        </div>
                        {subtitle && (
                            <p className="text-neutral-500">
                                <span className="text-body">{subtitle}</span>
                            </p>
                        )}
                    </div>
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
        </div>
    );
}

export interface PillTab {
    key: string;
    label: string;
    count?: number | null;
}

/** Rounded segmented tabs used as quick filters (no counts fetched — labels only, or counts already loaded). */
export function PillTabs({
    tabs,
    value,
    onChange,
    className,
}: {
    tabs: PillTab[];
    value: string;
    onChange: (key: string) => void;
    className?: string;
}) {
    return (
        <div
            role="tablist"
            className={cn(
                'flex w-full flex-wrap items-center gap-1 rounded-xl border border-neutral-200 bg-white p-1 sm:w-fit',
                className
            )}
        >
            {tabs.map((tab) => {
                const on = tab.key === value;
                return (
                    <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onClick={() => onChange(tab.key)}
                        className={cn(
                            'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 font-medium transition-colors',
                            on
                                ? 'bg-primary-500 text-white'
                                : 'text-neutral-600 hover:bg-neutral-100'
                        )}
                    >
                        <span className="text-caption">{tab.label}</span>
                        {tab.count !== undefined && tab.count !== null && (
                            <span
                                className={cn(
                                    'rounded-full px-1.5 tabular-nums',
                                    on ? 'bg-white/20' : 'bg-neutral-100 text-neutral-500'
                                )}
                            >
                                <span className="text-caption">{tab.count}</span>
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
