import { ArrowRight, Clock, VideoCameraSlash } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import type { DashboardClassRow } from '../../-services/live-class-dashboard';
import { formatTimeRange } from '../../-utils/live-sesstions';
import { formatCount, platformLabelKey } from '../../-utils/dashboard-format';
import { instructorLabel, instructorNames } from './dashboard-tables';
import { Avatar } from './dashboard-highlights';

export function LiveDot() {
    return (
        <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-danger-500" />
        </span>
    );
}

/** Share of the audience that has joined, as a ring. SVG attributes, not styles. */
function JoinRing({ joined, expected }: { joined: number; expected: number }) {
    const r = 22;
    const circumference = 2 * Math.PI * r;
    const share = expected > 0 ? Math.min(1, joined / expected) : 0;
    return (
        <div className="relative size-14 shrink-0">
            <svg viewBox="0 0 56 56" className="size-14 -rotate-90" aria-hidden>
                <circle
                    cx="28"
                    cy="28"
                    r={r}
                    fill="none"
                    strokeWidth="5"
                    className="stroke-neutral-100"
                />
                <circle
                    cx="28"
                    cy="28"
                    r={r}
                    fill="none"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={`${circumference * share} ${circumference}`}
                    className="stroke-danger-500"
                />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-caption font-semibold tabular-nums text-neutral-800">
                {expected > 0 ? `${Math.round(share * 100)}%` : formatCount(joined)}
            </span>
        </div>
    );
}

/**
 * Classes in progress right now, whatever the selected range. Join counts
 * move as learners enter because the dashboard re-polls every minute.
 */
export function LiveNowPanel({
    classes,
    classesTerm,
    onOpen,
}: {
    classes: DashboardClassRow[];
    classesTerm: string;
    onOpen: (row: DashboardClassRow) => void;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');

    if (classes.length === 0) {
        return (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-card px-4 py-3 text-body text-neutral-500">
                <VideoCameraSlash size={20} className="shrink-0 text-neutral-400" />
                {t('liveNow.none', { term: classesTerm.toLowerCase() })}
            </div>
        );
    }

    return (
        <section
            className="flex flex-col gap-3 rounded-xl border border-danger-100 bg-gradient-to-br from-danger-50 via-white to-white p-4 sm:p-5"
            aria-label={t('liveNow.title')}
        >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="flex items-center gap-2">
                    <LiveDot />
                    <h2 className="whitespace-nowrap text-subtitle font-semibold text-neutral-900">
                        {t('liveNow.title')}
                    </h2>
                    <span className="rounded-full bg-danger-500 px-2 py-0.5 text-caption font-semibold text-white">
                        {classes.length}
                    </span>
                </div>
                <span className="text-caption text-neutral-500">{t('liveNow.autoRefresh')}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {classes.map((row) => {
                    const first = row.instructors[0];
                    return (
                        <Card
                            key={row.schedule_id}
                            className="flex flex-col gap-3 rounded-xl border-neutral-200 bg-card p-4 shadow-sm"
                        >
                            <div className="flex items-start gap-3">
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <p
                                        className="truncate text-body font-semibold text-neutral-900"
                                        title={row.title ?? ''}
                                    >
                                        {row.title || t('table.untitled')}
                                    </p>
                                    <p className="flex items-center gap-1.5 text-caption text-neutral-500">
                                        <Clock size={13} className="shrink-0" />
                                        {formatTimeRange(row.start_time, row.end_time)} ·{' '}
                                        {t(`platforms.names.${platformLabelKey(row.platform)}`)}
                                    </p>
                                    {first && (
                                        <span className="mt-1 flex min-w-0 items-center gap-2">
                                            <Avatar
                                                id={first.user_id}
                                                name={instructorLabel(first)}
                                                className="size-6 text-caption"
                                            />
                                            <span
                                                className="truncate text-caption text-neutral-700"
                                                title={instructorNames(row.instructors)}
                                            >
                                                {instructorNames(row.instructors)}
                                            </span>
                                        </span>
                                    )}
                                </div>
                                <JoinRing joined={row.joined} expected={row.expected} />
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-caption text-neutral-600">
                                    {row.expected > 0
                                        ? t('liveNow.joinedOf', {
                                              joined: formatCount(row.joined),
                                              expected: formatCount(row.expected),
                                          })
                                        : t('liveNow.joinedCount', { n: formatCount(row.joined) })}
                                </span>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    className="gap-1.5 sm:min-w-0"
                                    onClick={() => onOpen(row)}
                                >
                                    {t('liveNow.open')}
                                    <ArrowRight size={14} />
                                </MyButton>
                            </div>
                        </Card>
                    );
                })}
            </div>
        </section>
    );
}
