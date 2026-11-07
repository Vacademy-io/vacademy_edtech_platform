import type { ReactNode } from 'react';
import { Info, TrendDown, TrendUp } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** A titled dashboard panel with an optional explanation, subtitle and header action. */
export function SectionCard({
    title,
    info,
    subtitle,
    action,
    children,
    className,
    bodyClassName,
}: {
    title: string;
    info?: string;
    subtitle?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
    bodyClassName?: string;
}) {
    return (
        <Card className={cn('flex flex-col rounded-xl border-neutral-200 shadow-sm', className)}>
            <div className="flex items-start justify-between gap-3 px-5 pt-4">
                <div className="min-w-0">
                    <h3 className="flex items-center gap-1.5 text-subtitle font-semibold text-neutral-800">
                        {title}
                        {info && <InfoTip text={info} />}
                    </h3>
                    {subtitle && <p className="mt-0.5 text-caption text-neutral-500">{subtitle}</p>}
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </div>
            <div className={cn('flex-1 px-5 pb-5 pt-3', bodyClassName)}>{children}</div>
        </Card>
    );
}

export function InfoTip({ text }: { text: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="inline-flex cursor-help text-neutral-400" aria-label={text}>
                    <Info size={15} />
                </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-caption">{text}</TooltipContent>
        </Tooltip>
    );
}

/**
 * ▲ / ▼ against the comparison period. `goodWhenUp` flips the colour for figures where a fall is
 * the good news (overdue money).
 */
export function DeltaPill({
    change,
    goodWhenUp = true,
}: {
    change: number | null;
    goodWhenUp?: boolean;
}) {
    if (change === null) return null;
    const up = change >= 0;
    const good = up === goodWhenUp;
    const Icon = up ? TrendUp : TrendDown;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-caption font-semibold',
                good ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-600'
            )}
        >
            <Icon size={12} weight="bold" />
            {Math.abs(change) >= 100 ? Math.round(Math.abs(change)) : Math.abs(change).toFixed(1)}%
        </span>
    );
}

/** A small labelled figure with an optional delta, for the hero card's supporting numbers. */
export function MiniStat({
    icon,
    label,
    value,
    delta,
    info,
}: {
    icon: ReactNode;
    label: string;
    value: string;
    delta?: ReactNode;
    info?: string;
}) {
    return (
        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-neutral-100 bg-neutral-50 p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-primary-500 shadow-sm">
                {icon}
            </span>
            <div className="min-w-0">
                <div className="flex items-center gap-1 text-caption text-neutral-500">
                    <span className="truncate">{label}</span>
                    {info && <InfoTip text={info} />}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-h3 font-bold tabular-nums text-neutral-900">{value}</span>
                    {delta}
                </div>
            </div>
        </div>
    );
}

/**
 * Ranked horizontal bars: the label and value on one line, the proportional bar under it, so a
 * long label never has to be cut short.
 */
export function BarList({
    rows,
    formatValue,
    barClassName = 'bg-primary-500',
    emptyText,
}: {
    rows: { key: string; label: string; value: number; detail?: string; barClassName?: string }[];
    formatValue: (v: number) => string;
    barClassName?: string;
    emptyText: string;
}) {
    const max = Math.max(0, ...rows.map((r) => r.value));
    const total = rows.reduce((s, r) => s + r.value, 0);
    if (rows.length === 0 || total <= 0) {
        return <p className="py-8 text-center text-caption text-neutral-500">{emptyText}</p>;
    }
    return (
        <ul className="space-y-4">
            {rows.map((r) => (
                <li key={r.key}>
                    <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-body font-medium text-neutral-700">
                            {r.label}
                        </span>
                        <span className="shrink-0 tabular-nums">
                            <span className="text-body font-semibold text-neutral-900">
                                {formatValue(r.value)}
                            </span>
                            <span className="ml-1.5 text-caption text-neutral-400">
                                {Math.round((r.value / total) * 100)}%
                            </span>
                        </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-100">
                        {/* Width is the row's share of the largest — data, so inline style. */}
                        <div
                            className={cn('h-full rounded-full', r.barClassName ?? barClassName)}
                            style={{
                                width: `${max > 0 ? Math.max(2, (r.value / max) * 100) : 0}%`,
                            }}
                        />
                    </div>
                    {r.detail && (
                        <div className="mt-1 text-caption text-neutral-400">{r.detail}</div>
                    )}
                </li>
            ))}
        </ul>
    );
}

/**
 * One bar split into segments (collected / overdue / still to come …). Each segment's width is
 * its share of the whole — data, so inline style.
 */
export function SegmentBar({
    segments,
    className,
}: {
    segments: { key: string; value: number; className: string }[];
    className?: string;
}) {
    const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
    return (
        <div className={cn('flex h-2.5 overflow-hidden rounded-full bg-neutral-100', className)}>
            {total > 0 &&
                segments
                    .filter((s) => s.value > 0)
                    .map((s) => (
                        <div
                            key={s.key}
                            className={cn(
                                'h-full first:rounded-l-full last:rounded-r-full',
                                s.className
                            )}
                            style={{ width: `${(s.value / total) * 100}%` }}
                        />
                    ))}
        </div>
    );
}
