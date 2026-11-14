import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, subDays } from 'date-fns';
import {
    Books,
    Brain,
    ChartLineUp,
    ChartPieSlice,
    ClockCountdown,
    Timer,
    VideoCamera,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyInput } from '@/components/design-system/input';
import { InputChips } from '@/components/design-system/chips';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Skeleton } from '@/components/ui/skeleton';
import {
    getLearnerLiveSessionsQuery,
    type LearnerAttendanceStatus,
    type LearnerLiveClass,
} from '@/services/learner-live-sessions';
import {
    formatMeetingDate,
    formatTimeRange,
} from '@/routes/study-library/live-session/-utils/live-sesstions';
import { cn } from '@/lib/utils';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    ProfileEmpty,
    ProfileError,
    ProfileHeroStat,
    ProfileSectionCard,
    type Tone,
} from '../profile-ui';
import { ALL_BATCHES, BatchPicker } from '../BatchPicker';
import { JoinLinkCard } from './join-link-card';
import { AttendanceStreakCalendar } from './attendance-streak-calendar';
import {
    AttendanceDonut,
    ClassTrendChart,
    STATUS_META,
    SubjectBreakdown,
    type TrendMetric,
} from './live-session-charts';
import { formatMinutes, fromYmd, toYmd } from './live-session-helpers';

// ── Date filter ───────────────────────────────────────────────────────────────

const PRESETS = ['Last 7 days', 'Last 30 days', 'Last 90 days', 'This month', 'Custom range'] as const;
type Preset = (typeof PRESETS)[number];
const DEFAULT_PRESET: Preset = 'Last 30 days';

const presetRange = (preset: Exclude<Preset, 'Custom range'>): { start: string; end: string } => {
    const today = new Date();
    const end = toYmd(today);
    switch (preset) {
        case 'Last 7 days':
            return { start: toYmd(subDays(today, 6)), end };
        case 'Last 90 days':
            return { start: toYmd(subDays(today, 89)), end };
        case 'This month':
            return { start: toYmd(startOfMonth(today)), end };
        case 'Last 30 days':
        default:
            return { start: toYmd(subDays(today, 29)), end };
    }
};

// ── Presentation ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;
const NO_SUBJECT = 'No subject';

const ATTENDANCE_CHIP: Record<LearnerAttendanceStatus, { text: string; status: StatusType }> = {
    PRESENT: { text: 'Present', status: 'SUCCESS' },
    ABSENT: { text: 'Absent', status: 'DANGER' },
    UNMARKED: { text: 'Not marked', status: 'WARNING' },
};

const scoreTone = (score: number | null | undefined): Tone =>
    score == null ? 'neutral' : score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger';

const SCORE_TEXT: Record<Tone, string> = {
    neutral: 'text-muted-foreground',
    primary: 'text-primary-600',
    success: 'text-success-600',
    warning: 'text-warning-600',
    danger: 'text-danger-600',
    info: 'text-info-600',
};

const classKey = (c: LearnerLiveClass) => `${c.schedule_id}:${c.session_id}`;

const ClassRow = ({ c, selected }: { c: LearnerLiveClass; selected: boolean }) => {
    const chip = ATTENDANCE_CHIP[c.attendance_status] ?? ATTENDANCE_CHIP.UNMARKED;
    const when = [formatMeetingDate(c.meeting_date), formatTimeRange(c.start_time, c.last_entry_time)]
        .filter(Boolean)
        .join(' · ');
    const attended =
        c.duration_minutes != null
            ? c.meeting_duration_minutes
                ? `${formatMinutes(c.duration_minutes)} of ${formatMinutes(c.meeting_duration_minutes)}`
                : formatMinutes(c.duration_minutes)
            : null;
    return (
        <li
            data-class-key={classKey(c)}
            className={cn(
                'flex flex-col gap-1 rounded-md px-1.5 py-2 transition-colors',
                selected && 'bg-primary-50 ring-1 ring-primary-200'
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="truncate text-caption font-medium text-card-foreground">
                        {c.title || 'Live class'}
                    </p>
                    <p className="truncate text-2xs text-muted-foreground">
                        {[c.subject, when].filter(Boolean).join(' · ')}
                    </p>
                </div>
                <StatusChip text={chip.text} textSize="text-caption" status={chip.status} />
            </div>
            {(attended || c.concentration_score != null || c.status_type === 'OFFLINE') && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
                    {attended && (
                        <span className="inline-flex items-center gap-1">
                            <Timer className="size-3" />
                            {attended}
                        </span>
                    )}
                    {c.concentration_score != null && (
                        <span className="inline-flex items-center gap-1">
                            <Brain className="size-3" />
                            Concentration{' '}
                            <span className={cn('font-semibold', SCORE_TEXT[scoreTone(c.concentration_score)])}>
                                {c.concentration_score}/100
                            </span>
                        </span>
                    )}
                    {c.status_type === 'OFFLINE' && <span>Marked offline</span>}
                </div>
            )}
        </li>
    );
};

/** A removable chip for one active list filter. */
const FilterChip = ({ label, onClear }: { label: string; onClear: () => void }) => (
    <button
        type="button"
        onClick={onClear}
        aria-label={`Remove filter: ${label}`}
        className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
        <InputChips label={label} trailingIcon={X} selected className="h-6 px-2 text-caption" />
    </button>
);

// ── Tab ───────────────────────────────────────────────────────────────────────

/**
 * "Live Sessions" tab on the learner side-view.
 *
 * Top to bottom: batch picker (2+ batches) → next class with its join / short / meeting links →
 * attendance streak calendar → the class-history section for the chosen date range: concentration
 * and duration badges, an attendance donut, a per-class trend chart, attendance by subject and the
 * class list.
 *
 * Everything below the range picker is linked: a donut slice, a subject bar or a calendar day
 * filters the list (shown as removable chips); a point on the trend chart highlights and scrolls
 * to that class; the two badges switch the trend chart's measure.
 *
 * Covers classes from every batch the learner is or was in, plus ones they were added to
 * individually; a class counts from the day they enrolled in its batch.
 */
export const StudentLiveSessions = ({
    userId,
    packageSessionIds = [],
}: {
    userId: string;
    /** The learner's batches, latest enrollment first. */
    packageSessionIds?: string[];
}) => {
    const [batch, setBatch] = useState<string>(ALL_BATCHES);
    const batchId = batch === ALL_BATCHES ? undefined : batch;

    const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET);
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    /** A single day picked on the streak calendar — overrides the preset until cleared. */
    const [day, setDay] = useState<string | null>(null);

    const [statusFilter, setStatusFilter] = useState<LearnerAttendanceStatus | null>(null);
    const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [metric, setMetric] = useState<TrendMetric>('concentration');
    const [visible, setVisible] = useState(PAGE_SIZE);
    const listRef = useRef<HTMLUListElement>(null);

    const clearListFilters = () => {
        setStatusFilter(null);
        setSubjectFilter(null);
        setSelectedKey(null);
        setVisible(PAGE_SIZE);
    };

    // The sheet stays mounted while the admin steps between learners — start each one fresh.
    useEffect(() => {
        setBatch(ALL_BATCHES);
        setDay(null);
        clearListFilters();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    const range = useMemo(() => {
        if (day) return { start: day, end: day };
        if (preset !== 'Custom range') return presetRange(preset);
        if (customStart && customEnd && customStart <= customEnd) {
            return { start: customStart, end: customEnd };
        }
        return null;
    }, [day, preset, customStart, customEnd]);

    const customInvalid =
        !day && preset === 'Custom range' && !!customStart && !!customEnd && customStart > customEnd;

    const { data, isLoading, error, refetch } = useQuery({
        ...getLearnerLiveSessionsQuery(userId, range?.start ?? '', range?.end ?? '', batchId),
        enabled: !!userId && !!range,
    });

    const classes = useMemo(() => data?.classes ?? [], [data]);
    const filtered = useMemo(
        () =>
            classes.filter(
                (c) =>
                    (!statusFilter || c.attendance_status === statusFilter) &&
                    (!subjectFilter || (c.subject?.trim() || NO_SUBJECT) === subjectFilter)
            ),
        [classes, statusFilter, subjectFilter]
    );

    // Picking a class on the trend chart: make sure it's in the list and on screen.
    const selectClass = (key: string) => {
        setStatusFilter(null);
        setSubjectFilter(null);
        setSelectedKey(key);
        const idx = classes.findIndex((c) => classKey(c) === key);
        if (idx >= 0) setVisible((v) => Math.max(v, idx + 1));
    };
    useEffect(() => {
        if (!selectedKey) return;
        listRef.current
            ?.querySelector(`[data-class-key="${CSS.escape(selectedKey)}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [selectedKey, visible]);

    const hasListFilters = !!statusFilter || !!subjectFilter;

    return (
        <div className="flex flex-col gap-3">
            {/* Renders only when the learner has 2+ batches. Individually-added classes belong to
                no batch, so they show under the "all" entry only. */}
            <BatchPicker
                packageSessionIds={packageSessionIds}
                value={batch}
                onChange={(v) => {
                    setBatch(v);
                    clearListFilters();
                }}
                allLabel={`All ${getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch).toLowerCase()}`}
            />
            <JoinLinkCard userId={userId} batchId={batchId} />
            <AttendanceStreakCalendar
                userId={userId}
                batchId={batchId}
                selectedDate={day}
                onSelectDate={(d) => {
                    setDay((cur) => (cur === d ? null : d));
                    clearListFilters();
                }}
            />

            {/* ── Class history: date range drives everything below ── */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-caption font-semibold text-card-foreground">
                        Class history
                    </span>
                    <MyDropdown
                        currentValue={day ? format(fromYmd(day), 'd MMM yyyy') : preset}
                        dropdownList={[...PRESETS]}
                        handleChange={(v) => {
                            setDay(null);
                            setPreset(v as Preset);
                            clearListFilters();
                        }}
                        className="h-8 text-caption"
                    />
                </div>
                {!day && preset === 'Custom range' && (
                    <div className="flex flex-col gap-1">
                        <div className="grid grid-cols-2 gap-2">
                            <MyInput
                                label="From"
                                inputType="date"
                                size="small"
                                input={customStart}
                                max={customEnd || toYmd(new Date())}
                                onChangeFunction={(e) => setCustomStart(e.target.value)}
                                className="h-8 sm:w-full"
                            />
                            <MyInput
                                label="To"
                                inputType="date"
                                size="small"
                                input={customEnd}
                                min={customStart || undefined}
                                max={toYmd(new Date())}
                                onChangeFunction={(e) => setCustomEnd(e.target.value)}
                                className="h-8 sm:w-full"
                            />
                        </div>
                        {customInvalid && (
                            <p className="text-2xs text-danger-600">
                                The start date has to be on or before the end date.
                            </p>
                        )}
                    </div>
                )}
            </div>

            {!range ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-2xs text-muted-foreground">
                    Pick a start and end date to see this learner's classes.
                </p>
            ) : isLoading ? (
                <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                        <Skeleton className="h-20 rounded-lg" />
                        <Skeleton className="h-20 rounded-lg" />
                    </div>
                    <Skeleton className="h-40 w-full rounded-lg" />
                    <Skeleton className="h-48 w-full rounded-lg" />
                </div>
            ) : error ? (
                <ProfileError
                    title="Couldn't load live classes"
                    hint="Something went wrong fetching this learner's live-class history."
                    onRetry={() => refetch()}
                />
            ) : !data ? null : data.total_classes === 0 ? (
                <ProfileEmpty
                    icon={VideoCamera}
                    title={day ? 'No live classes on this day' : 'No live classes in this period'}
                    hint="Classes from this learner's batches, and any they were added to directly, will show up here once they've started."
                />
            ) : (
                <>
                    {/* Badges — click to switch the trend chart to that measure. */}
                    <div className="grid grid-cols-2 gap-2">
                        <ProfileHeroStat
                            label="Avg concentration"
                            value={
                                data.avg_concentration_score != null
                                    ? `${Math.round(data.avg_concentration_score)}/100`
                                    : '—'
                            }
                            tone={scoreTone(data.avg_concentration_score)}
                            icon={Brain}
                            onClick={() => setMetric('concentration')}
                            selected={metric === 'concentration'}
                        />
                        <ProfileHeroStat
                            label="Avg duration"
                            value={formatMinutes(data.avg_duration_minutes)}
                            tone={data.avg_duration_minutes != null ? 'primary' : 'neutral'}
                            icon={ClockCountdown}
                            onClick={() => setMetric('duration')}
                            selected={metric === 'duration'}
                        />
                    </div>

                    <ProfileSectionCard icon={ChartPieSlice} heading="Attendance">
                        <AttendanceDonut
                            summary={data}
                            active={statusFilter}
                            onSelect={(s) => {
                                setStatusFilter(s);
                                setSelectedKey(null);
                                setVisible(PAGE_SIZE);
                            }}
                        />
                    </ProfileSectionCard>

                    <ProfileSectionCard
                        icon={ChartLineUp}
                        heading={metric === 'concentration' ? 'Concentration by class' : 'Time in class'}
                    >
                        <ClassTrendChart
                            classes={classes}
                            metric={metric}
                            onMetricChange={setMetric}
                            avgScore={data.avg_concentration_score}
                            avgMinutes={data.avg_duration_minutes}
                            selectedId={selectedKey}
                            onSelectClass={selectClass}
                        />
                        <p className="mt-2 text-2xs text-muted-foreground">
                            Concentration is scored 0–100 per class: 80 for time in class against the
                            class length, 20 for chat, raise-hand, talk and poll activity.
                            {data.scored_classes < data.total_classes &&
                                ` ${data.scored_classes} of ${data.total_classes} classes had data to score.`}
                        </p>
                    </ProfileSectionCard>

                    {/* Renders only when the period spans 2+ subjects. */}
                    {new Set(classes.map((c) => c.subject?.trim() || NO_SUBJECT)).size > 1 && (
                        <ProfileSectionCard icon={Books} heading="By subject">
                            <SubjectBreakdown
                                classes={classes}
                                active={subjectFilter}
                                onSelect={(s) => {
                                    setSubjectFilter(s);
                                    setSelectedKey(null);
                                    setVisible(PAGE_SIZE);
                                }}
                            />
                        </ProfileSectionCard>
                    )}

                    <ProfileSectionCard
                        icon={VideoCamera}
                        heading={
                            hasListFilters
                                ? `${filtered.length} of ${classes.length} classes`
                                : `${classes.length} class${classes.length === 1 ? '' : 'es'}`
                        }
                        action={
                            hasListFilters ? (
                                <MyButton buttonType="text" scale="small" onClick={clearListFilters}>
                                    Clear filters
                                </MyButton>
                            ) : undefined
                        }
                    >
                        {(hasListFilters || day) && (
                            <div className="mb-1 flex flex-wrap gap-1.5">
                                {day && (
                                    <FilterChip
                                        label={format(fromYmd(day), 'EEE, d MMM')}
                                        onClear={() => setDay(null)}
                                    />
                                )}
                                {statusFilter && (
                                    <FilterChip
                                        label={STATUS_META[statusFilter].label}
                                        onClear={() => setStatusFilter(null)}
                                    />
                                )}
                                {subjectFilter && (
                                    <FilterChip label={subjectFilter} onClear={() => setSubjectFilter(null)} />
                                )}
                            </div>
                        )}
                        {filtered.length === 0 ? (
                            <p className="py-4 text-center text-2xs text-muted-foreground">
                                No classes match these filters.
                            </p>
                        ) : (
                            <ul ref={listRef} className="flex flex-col divide-y divide-border">
                                {filtered.slice(0, visible).map((c) => (
                                    <ClassRow
                                        key={classKey(c)}
                                        c={c}
                                        selected={classKey(c) === selectedKey}
                                    />
                                ))}
                            </ul>
                        )}
                        {filtered.length > visible && (
                            <div className="flex justify-center border-t border-border pt-2">
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => setVisible((v) => v + PAGE_SIZE)}
                                >
                                    Show {Math.min(PAGE_SIZE, filtered.length - visible)} more
                                </MyButton>
                            </div>
                        )}
                    </ProfileSectionCard>
                </>
            )}
        </div>
    );
};
