import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { REPORT_COLORS, scoreColor, tint } from './palette';

/**
 * Report building blocks in the style of the assessment AI report: a tagged block with a
 * headline and a one-line explanation, big coloured stat tiles, a hero banner with an
 * illustration, mastery pips and the Bloom pyramid.
 */

export const ReportBlock = ({
    tag,
    title,
    lede,
    brand,
    action,
    children,
    className,
}: {
    tag: string;
    title: string;
    lede?: string;
    brand: string;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}) => (
    <section
        className={cn(
            'flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4',
            className
        )}
    >
        <header className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
                <span
                    className="text-2xs font-semibold uppercase tracking-wider"
                    style={{ color: brand }}
                >
                    {tag}
                </span>
                <h3 className="text-base font-semibold leading-snug text-neutral-800">{title}</h3>
                {lede && <p className="text-xs text-neutral-500">{lede}</p>}
            </div>
            {action}
        </header>
        {children}
    </section>
);

export const StatTile = ({
    value,
    label,
    color = REPORT_COLORS.ink,
    icon,
}: {
    value: string | number;
    label: string;
    color?: string;
    icon?: ReactNode;
}) => (
    <div className="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-white px-3 py-3">
        <span className="text-2xl font-bold leading-none" style={{ color }}>
            {value}
        </span>
        <span className="flex items-center gap-1 text-xs text-neutral-500">
            {icon}
            {label}
        </span>
    </div>
);

export const ReportHero = ({
    brand,
    kicker,
    headline,
    subline,
    bigValue,
    bigSuffix,
    bigCaption,
    illustration,
    track,
    compact = false,
}: {
    brand: string;
    kicker: string;
    headline: string;
    subline?: string;
    bigValue: string;
    bigSuffix?: string;
    bigCaption?: string;
    illustration?: ReactNode;
    /** A thin progress track under the headline, e.g. "Better than 72% of the class". */
    track?: { value: number; left: ReactNode; right?: ReactNode } | null;
    compact?: boolean;
}) => (
    <div
        className="relative overflow-hidden rounded-2xl border"
        style={{
            borderColor: tint(brand, 0.75),
            background: `linear-gradient(120deg, ${tint(brand, 0.9)} 0%, #ffffff 70%)`,
        }}
    >
        <div className={cn('flex items-center gap-4', compact ? 'p-4' : 'p-6')}>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span
                    className="text-2xs font-semibold uppercase tracking-wider"
                    style={{ color: brand }}
                >
                    {kicker}
                </span>
                <span
                    className={cn(
                        'font-bold leading-tight text-neutral-900',
                        compact ? 'text-lg' : 'text-2xl'
                    )}
                >
                    {headline}
                </span>
                {subline && <span className="text-sm text-neutral-600">{subline}</span>}
            </div>
            <div className="flex shrink-0 flex-col items-end">
                <span
                    className={cn('font-extrabold leading-none', compact ? 'text-3xl' : 'text-5xl')}
                    style={{ color: brand }}
                >
                    {bigValue}
                    {bigSuffix && (
                        <span className="text-base font-semibold text-neutral-400">{bigSuffix}</span>
                    )}
                </span>
                {bigCaption && (
                    <span className="mt-1 text-xs font-medium text-neutral-500">{bigCaption}</span>
                )}
            </div>
            {illustration && (
                <div className={cn('hidden shrink-0 sm:block', compact ? 'w-24' : 'w-36')}>
                    {illustration}
                </div>
            )}
        </div>
        {track && (
            <div className={cn('flex flex-col gap-1.5', compact ? 'px-4 pb-4' : 'px-6 pb-5')}>
                <div className="flex justify-between gap-2 text-xs text-neutral-600">
                    <span>{track.left}</span>
                    {track.right && <span>{track.right}</span>}
                </div>
                <div className="h-2 w-full rounded-full bg-white/80 ring-1 ring-neutral-200">
                    <div
                        className="h-full rounded-full"
                        style={{
                            width: `${Math.max(2, Math.min(100, track.value))}%`,
                            background: brand,
                        }}
                    />
                </div>
            </div>
        )}
    </div>
);

const MASTERY_STEPS: Record<string, number> = {
    beginner: 1,
    developing: 2,
    proficient: 3,
    expert: 4,
};

/** Four pips for Beginner, Developing, Proficient, Expert. */
export const MasteryPips = ({ level, brand }: { level?: string | null; brand: string }) => {
    const n = MASTERY_STEPS[(level ?? '').trim().toLowerCase()] ?? 0;
    if (n === 0) return null;
    return (
        <span className="inline-flex items-center gap-0.5" title={level ?? undefined}>
            {[1, 2, 3, 4].map((i) => (
                <span
                    key={i}
                    className="h-1.5 w-2.5 rounded-sm"
                    style={{ background: i <= n ? brand : REPORT_COLORS.line }}
                />
            ))}
        </span>
    );
};

export interface TopicRow {
    topic: string;
    accuracy: number | null;
    correct: number;
    questions: number;
    mastery_level?: string | null;
}

/** One column of topics (strengths or needs work) with accuracy bars and mastery pips. */
export const TopicColumn = ({
    title,
    icon,
    rows,
    brand,
    empty,
    max = 6,
}: {
    title: string;
    icon?: ReactNode;
    rows: TopicRow[];
    brand: string;
    empty: string;
    max?: number;
}) => (
    <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700">
            {icon}
            {title}
            <span className="text-xs font-normal text-neutral-400">({rows.length})</span>
        </span>
        {rows.length === 0 ? (
            <p className="text-xs text-neutral-400">{empty}</p>
        ) : (
            rows.slice(0, max).map((t) => (
                <div key={t.topic} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium text-neutral-700" title={t.topic}>
                            {t.topic}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-neutral-500">
                            {t.correct}/{t.questions}
                            <MasteryPips level={t.mastery_level} brand={brand} />
                        </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-neutral-100">
                        <div
                            className="h-full rounded-full"
                            style={{
                                width: `${Math.max(3, Math.min(100, t.accuracy ?? 0))}%`,
                                background: scoreColor(t.accuracy),
                            }}
                        />
                    </div>
                </div>
            ))
        )}
    </div>
);

const BLOOM_ORDER = [
    ['create', 'Create', 'designing something new'],
    ['evaluate', 'Evaluate', 'judging and justifying'],
    ['analyze', 'Analyse', 'reading data and set-ups'],
    ['apply', 'Apply', 'solving with methods'],
    ['understand', 'Understand', 'explaining ideas'],
    ['remember', 'Remember', 'recalling facts'],
] as const;

export interface BloomInput {
    level: string;
    total?: number | null;
    correct?: number | null;
    accuracy?: number | null;
}

/** Bloom levels as a pyramid, remembering at the wide base and creating at the tip. */
export const BloomPyramid = ({ levels }: { levels: BloomInput[] }) => {
    const byKey = new Map(
        levels.map((l) => [l.level.trim().toLowerCase().replace('analyse', 'analyze'), l])
    );
    return (
        <div className="flex flex-col items-center gap-1">
            {BLOOM_ORDER.map(([key, name, hint], i) => {
                const l = byKey.get(key);
                const tested = !!l && (l.total ?? 0) > 0;
                const acc =
                    l?.accuracy ??
                    (tested && l?.correct != null ? ((l.correct ?? 0) / (l.total ?? 1)) * 100 : null);
                return (
                    <div
                        key={key}
                        className="flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-xs"
                        style={{
                            width: `${46 + i * 10.8}%`,
                            background: tested ? scoreColor(acc) : REPORT_COLORS.line,
                            color: tested ? '#fff' : REPORT_COLORS.muted,
                        }}
                        title={hint}
                    >
                        <span className="font-semibold">{name}</span>
                        <span className="font-medium">
                            {tested
                                ? `${l?.correct ?? 0}/${l?.total} · ${Math.round(acc ?? 0)}%`
                                : 'not tested'}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};
