import type { Icon } from '@phosphor-icons/react';
import { Lightbulb, Siren, Trophy, WarningCircle } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
    CrmLink,
    DeltaChip,
    Sparkline,
    type Tint,
} from '@/routes/dashboard/-components/crm/crm-cards';

/*
 * Building blocks for the enhanced header on CRM pages: a stat strip, quick-view
 * count cards and an insight row. They sit ABOVE a page's existing table and never
 * change it. Same tokens and look as the CRM Dashboard.
 */

const ICON_TINT: Record<Tint, string> = {
    primary: 'bg-primary-50 text-primary-500',
    info: 'bg-info-50 text-info-600',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-50 text-warning-600',
    danger: 'bg-danger-50 text-danger-600',
};

const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-IN');

export interface StatItem {
    key: string;
    label: string;
    value: string | number | null | undefined;
    detail?: string;
    icon: Icon;
    tint?: Tint;
    delta?: number | null;
    lowerIsBetter?: boolean;
    spark?: number[];
    href?: string;
    loading?: boolean;
}

function StatBody({ s, deltaTitle }: { s: StatItem; deltaTitle?: string }) {
    const tint = s.tint ?? 'primary';
    return (
        <Card className="flex h-full min-w-0 flex-col gap-2 rounded-xl border-neutral-200 p-4 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-center gap-2 text-neutral-600">
                <span
                    className={cn(
                        'flex size-8 items-center justify-center rounded-lg',
                        ICON_TINT[tint]
                    )}
                >
                    <s.icon size={16} weight="duotone" />
                </span>
                <span className="truncate font-medium">
                    <span className="text-caption">{s.label}</span>
                </span>
            </div>
            <div className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                    {s.loading ? (
                        <Skeleton className="h-8 w-20" />
                    ) : (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold tabular-nums text-neutral-900">
                                <span className="text-h2">
                                    {typeof s.value === 'number' ? fmt(s.value) : s.value ?? '—'}
                                </span>
                            </span>
                            {s.delta !== undefined && (
                                <DeltaChip
                                    value={s.delta ?? null}
                                    lowerIsBetter={s.lowerIsBetter}
                                    title={deltaTitle ?? ''}
                                />
                            )}
                        </div>
                    )}
                    {s.detail && (
                        <p className="mt-1 line-clamp-2 text-neutral-500">
                            <span className="text-caption">{s.detail}</span>
                        </p>
                    )}
                </div>
                {s.spark && <Sparkline values={s.spark} tint={tint} id={s.key} />}
            </div>
        </Card>
    );
}

/** A row of 2–6 stat cards; each links to the list it counts when `href` is set. */
export function StatStrip({ items, deltaTitle }: { items: StatItem[]; deltaTitle?: string }) {
    if (items.length === 0) return null;
    return (
        <div
            className={cn(
                'grid grid-cols-1 gap-4 sm:grid-cols-2',
                items.length >= 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3'
            )}
        >
            {items.map((s) =>
                s.href ? (
                    <CrmLink key={s.key} href={s.href} className="block h-full">
                        <StatBody s={s} deltaTitle={deltaTitle} />
                    </CrmLink>
                ) : (
                    <StatBody key={s.key} s={s} deltaTitle={deltaTitle} />
                )
            )}
        </div>
    );
}

export interface QuickView {
    key: string;
    label: string;
    count: number | null | undefined;
    tone?: 'neutral' | 'danger' | 'warning' | 'success' | 'info';
    active?: boolean;
    /** Either navigate (href) or set a filter on the page (onSelect). */
    href?: string;
    onSelect?: () => void;
}

const QV_TONE: Record<NonNullable<QuickView['tone']>, string> = {
    neutral: 'text-neutral-900',
    danger: 'text-danger-600',
    warning: 'text-warning-700',
    success: 'text-success-700',
    info: 'text-info-600',
};

/** Clickable count cards that act as quick filters for the table below. */
export function QuickViews({ views, caption }: { views: QuickView[]; caption?: string }) {
    if (views.length === 0) return null;
    const body = (v: QuickView) => (
        <span
            className={cn(
                'flex min-w-0 flex-col gap-0.5 rounded-xl border bg-white px-4 py-3 text-left transition-shadow hover:shadow-md',
                v.active ? 'border-primary-400 ring-1 ring-primary-200' : 'border-neutral-200'
            )}
        >
            <span className="truncate text-neutral-500">
                <span className="text-caption">{v.label}</span>
            </span>
            <span className={cn('font-bold tabular-nums', QV_TONE[v.tone ?? 'neutral'])}>
                <span className="text-h3">{fmt(v.count)}</span>
            </span>
        </span>
    );
    return (
        <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {views.map((v) =>
                    v.href ? (
                        <CrmLink key={v.key} href={v.href} className="block">
                            {body(v)}
                        </CrmLink>
                    ) : v.onSelect ? (
                        <button key={v.key} type="button" onClick={v.onSelect} className="block">
                            {body(v)}
                        </button>
                    ) : (
                        <div key={v.key}>{body(v)}</div>
                    )
                )}
            </div>
            {caption && (
                <p className="text-neutral-500">
                    <span className="text-caption">{caption}</span>
                </p>
            )}
        </div>
    );
}

export interface Insight {
    key: string;
    tone: 'success' | 'danger' | 'warning' | 'info';
    title: string;
    text: string;
    href?: string;
}

const INS_TONE: Record<Insight['tone'], string> = {
    success: 'border-success-100 bg-success-50',
    danger: 'border-danger-100 bg-danger-50',
    warning: 'border-warning-100 bg-warning-50',
    info: 'border-info-100 bg-info-50',
};
const INS_ICON: Record<Insight['tone'], Icon> = {
    success: Trophy,
    danger: Siren,
    warning: WarningCircle,
    info: Lightbulb,
};

/** Up to four plain-language highlights, each linking to what it is about. */
export function InsightStrip({ insights }: { insights: Insight[] }) {
    if (insights.length === 0) return null;
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {insights.slice(0, 4).map((x) => {
                const I = INS_ICON[x.tone];
                const inner = (
                    <span
                        className={cn('flex h-full gap-3 rounded-xl border p-4', INS_TONE[x.tone])}
                    >
                        <span
                            className={cn(
                                'flex size-8 shrink-0 items-center justify-center rounded-lg bg-white',
                                ICON_TINT[x.tone]
                            )}
                        >
                            <I size={16} weight="duotone" />
                        </span>
                        <span className="min-w-0">
                            <span className="block font-semibold text-neutral-900">
                                <span className="text-body">{x.title}</span>
                            </span>
                            <span className="mt-0.5 block text-neutral-600">
                                <span className="text-caption">{x.text}</span>
                            </span>
                        </span>
                    </span>
                );
                return x.href ? (
                    <CrmLink key={x.key} href={x.href} className="block h-full">
                        {inner}
                    </CrmLink>
                ) : (
                    <div key={x.key}>{inner}</div>
                );
            })}
        </div>
    );
}

/** Wraps an enhanced header so it is spaced like the rest of the page. */
export function EnhancedHeader({ children }: { children: React.ReactNode }) {
    return <div className="mb-4 flex flex-col gap-4">{children}</div>;
}
