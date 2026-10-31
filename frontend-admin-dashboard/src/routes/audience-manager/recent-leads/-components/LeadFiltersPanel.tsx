import type { ReactNode } from 'react';
import { Funnel, X, type Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * The Recent Leads filters, grouped by what they answer (pipeline, owner, activity,
 * campaign links, the institute's own fields). Columns side by side on wide screens,
 * stacked sections below that. Only layout lives here; every filter control and its
 * state stay with the page.
 */
export function LeadFiltersPanel({
    title,
    activeLabel,
    activeCount,
    closeLabel,
    onClose,
    actions,
    children,
}: {
    title: string;
    /** e.g. "3 active"; shown only when activeCount > 0. */
    activeLabel: string;
    activeCount: number;
    closeLabel: string;
    onClose: () => void;
    /** Right side of the header: Manage filters, Clear all. */
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-4 py-2.5">
                <div className="flex items-center gap-2">
                    <Funnel size={16} className="text-primary-500" />
                    <span className="font-semibold text-neutral-900">
                        <span className="text-body">{title}</span>
                    </span>
                    {activeCount > 0 && (
                        <span className="rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-600">
                            <span className="text-caption">{activeLabel}</span>
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {actions}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={closeLabel}
                        title={closeLabel}
                        className="flex size-7 cursor-pointer items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>
            <div className="flex flex-col divide-y divide-neutral-100 xl:flex-row xl:divide-x xl:divide-y-0">
                {children}
            </div>
        </div>
    );
}

/** One group of filters with its heading and how many of them are applied. */
export function LeadFilterSection({
    title,
    icon: SectionIcon,
    activeCount,
    children,
}: {
    title: string;
    icon: Icon;
    activeCount: number;
    children: ReactNode;
}) {
    return (
        <section
            aria-label={title}
            className={cn(
                'flex min-w-0 flex-1 flex-col gap-2.5 p-4 transition-colors',
                activeCount > 0 && 'bg-primary-50/40'
            )}
        >
            <div className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                    <SectionIcon size={14} weight="duotone" />
                </span>
                <span className="truncate font-semibold uppercase tracking-wide text-neutral-500">
                    <span className="text-caption">{title}</span>
                </span>
                {activeCount > 0 && (
                    <span className="ml-auto rounded-full bg-primary-500 px-1.5 font-semibold tabular-nums text-white">
                        <span className="text-caption">{activeCount}</span>
                    </span>
                )}
            </div>
            {/* Two across while sections are stacked, one under the other in columns. */}
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 [&>*]:w-full [&>*]:min-w-0 [&_[role=combobox]]:w-full">
                {children}
            </div>
        </section>
    );
}
