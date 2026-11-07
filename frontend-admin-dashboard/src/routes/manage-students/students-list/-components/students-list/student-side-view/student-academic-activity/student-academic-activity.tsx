import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNowStrict, subDays } from 'date-fns';
import {
    BookOpenText,
    Books,
    CalendarDots,
    CaretDown,
    ChartBar,
    ChatsCircle,
    Exam,
    FilePdf,
    Lightning,
    Question,
    Robot,
    UserCircle,
    VideoCamera,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { BASE_URL } from '@/constants/urls';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { cn } from '@/lib/utils';
import { useLearnerPackagesQuery } from '@/routes/manage-students/students-list/-services/getLearnerPackages';
import { DailyTimeChart, HorizontalBars } from '@/components/common/report-visuals/charts';
import { REPORT_COLORS, minutesLabel, pct, scoreColor, useBrandColor } from '@/components/common/report-visuals/palette';
import { getLearnerLiveSessionsQuery } from '@/services/learner-live-sessions';
import {
    getLearnerDailyTimeQuery,
    getStudentReportSnapshotQuery,
} from '@/services/student-report-snapshot';
import {
    useConversationMessagesQuery,
    useUserConversationsQuery,
} from '@/routes/settings/-services/ai-usage-service';
import { ALL_BATCHES, BatchPicker } from '../BatchPicker';
import { ProfileEmpty, ProfileSectionCard, ProfileSkeleton } from '../profile-ui';
import { StudentGamification } from '../student-gamification/student-gamification';

/**
 * Academic Activity: what the learner is doing right now (live pulse), what they read lately,
 * course progress, live classes, points and badges and their AI tutor chats, on one tab.
 */

interface PulseSlide {
    slide_id: string;
    title: string | null;
    type: string | null;
    chapter: string | null;
    last_seen_at: string | null;
    minutes: number;
    visits: number;
    percent: number | null;
}

interface LearnerPulse {
    state: 'ACTIVE' | 'IDLE' | 'OFFLINE' | 'NEVER';
    last_seen_at: string | null;
    last_seen_ago_seconds: number | null;
    current: PulseSlide | null;
    recent: PulseSlide[];
}

const fetchLearnerPulse = async (userId: string, instituteId: string): Promise<LearnerPulse> => {
    const { data } = await authenticatedAxiosInstance.get<LearnerPulse>(
        `${BASE_URL}/admin-core-service/course-pulse/learner`,
        { params: { userId, instituteId } }
    );
    return data;
};

interface LearnerInsights {
    total_minutes?: number;
    active_days?: number;
    slides_opened?: number;
    visits?: number;
    week_minutes?: number;
    previous_week_minutes?: number;
    content_mix: { type: string | null; minutes: number; slides: number }[];
    /** weekday: Monday is 1. hour: 0 to 23, institute time. */
    rhythm: { weekday: number; hour: number; minutes: number }[];
}

const fetchLearnerInsights = async (userId: string, instituteId: string): Promise<LearnerInsights> => {
    const { data } = await authenticatedAxiosInstance.get<LearnerInsights>(
        `${BASE_URL}/admin-core-service/course-pulse/learner/insights`,
        { params: { userId, instituteId } }
    );
    return data;
};

const DAYS = 30;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Three-hour bands across the day. */
const HOUR_BANDS = [0, 3, 6, 9, 12, 15, 18, 21];
const bandLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;

const CONTENT_LABEL: Record<string, string> = {
    VIDEO: 'Videos',
    DOCUMENT: 'Documents',
    QUESTION: 'Questions',
    QUIZ: 'Quizzes',
    ASSIGNMENT: 'Assignments',
    AUDIO: 'Audio',
    HTML_VIDEO: 'Videos',
    SCORM: 'Interactive lessons',
};

const contentLabel = (type: string | null) => {
    const key = (type ?? '').toUpperCase();
    if (CONTENT_LABEL[key]) return CONTENT_LABEL[key] as string;
    if (!key) return 'Other';
    return key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ');
};

const ago = (iso: string | number | null | undefined) => {
    if (iso == null) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${formatDistanceToNowStrict(d)} ago`;
};

const slideIcon = (type: string | null): PhosphorIcon => {
    switch ((type ?? '').toUpperCase()) {
        case 'VIDEO':
            return VideoCamera;
        case 'DOCUMENT':
            return FilePdf;
        case 'QUESTION':
        case 'QUIZ':
        case 'ASSIGNMENT':
            return Question;
        default:
            return BookOpenText;
    }
};

const STATE_META: Record<LearnerPulse['state'], { label: string; dot: string; text: string }> = {
    ACTIVE: { label: 'Learning now', dot: 'bg-success-500', text: 'text-success-700' },
    IDLE: { label: 'Idle', dot: 'bg-warning-500', text: 'text-warning-700' },
    OFFLINE: { label: 'Offline', dot: 'bg-neutral-400', text: 'text-neutral-600' },
    NEVER: { label: 'No activity yet', dot: 'bg-neutral-300', text: 'text-neutral-500' },
};

const Bar = ({ value }: { value: number }) => (
    <div className="h-1.5 w-full rounded-full bg-neutral-100">
        <div
            className="h-full rounded-full bg-primary-500"
            style={{ width: `${Math.max(value > 0 ? 2 : 0, Math.min(100, value))}%` }}
        />
    </div>
);

const LivePulse = ({ pulse }: { pulse: LearnerPulse }) => {
    const meta = STATE_META[pulse.state];
    const live = pulse.state === 'ACTIVE';
    return (
        <ProfileSectionCard icon={Lightning} heading="Live pulse">
            <div className="flex items-start gap-3">
                <span className="relative mt-1 flex size-3 shrink-0">
                    {live && (
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success-400 opacity-60" />
                    )}
                    <span className={cn('relative inline-flex size-3 rounded-full', meta.dot)} />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className={cn('text-sm font-semibold', meta.text)}>{meta.label}</span>
                    {pulse.current ? (
                        <span className="text-sm text-neutral-700">
                            On <b>{pulse.current.title ?? 'a slide'}</b>
                            {pulse.current.chapter ? ` · ${pulse.current.chapter}` : ''}
                        </span>
                    ) : pulse.last_seen_at ? (
                        <span className="text-xs text-neutral-500">
                            Last seen {ago(pulse.last_seen_at)}
                            {pulse.recent[0]?.title ? ` on ${pulse.recent[0].title}` : ''}
                        </span>
                    ) : (
                        <span className="text-xs text-neutral-500">
                            Has not opened any course content in the last {DAYS} days.
                        </span>
                    )}
                </div>
            </div>
        </ProfileSectionCard>
    );
};

const RecentlyRead = ({ pulse }: { pulse: LearnerPulse }) => (
    <ProfileSectionCard icon={BookOpenText} heading="What they read lately">
        {pulse.recent.length === 0 ? (
            <ProfileEmpty
                icon={BookOpenText}
                title="Nothing read yet"
                hint={`No course content opened in ${DAYS} days.`}
            />
        ) : (
            <ul className="flex flex-col divide-y divide-neutral-100">
                {pulse.recent.map((s) => {
                    const Icon = slideIcon(s.type);
                    return (
                        <li key={s.slide_id} className="flex items-center gap-2 py-2">
                            <Icon className="size-4 shrink-0 text-primary-500" weight="duotone" />
                            <div className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-sm text-neutral-800" title={s.title ?? ''}>
                                    {s.title ?? 'Untitled'}
                                </span>
                                <span className="truncate text-xs text-neutral-500">
                                    {[s.chapter, ago(s.last_seen_at)].filter(Boolean).join(' · ')}
                                </span>
                            </div>
                            <div className="flex shrink-0 flex-col items-end text-xs text-neutral-500">
                                <span className="font-semibold text-neutral-700">
                                    {s.minutes >= 1 ? `${Math.round(s.minutes)} min` : '<1 min'}
                                </span>
                                {s.percent != null && <span>{s.percent}% seen</span>}
                            </div>
                        </li>
                    );
                })}
            </ul>
        )}
    </ProfileSectionCard>
);

const ThisMonth = ({ data }: { data: LearnerInsights }) => {
    const week = data.week_minutes ?? 0;
    const previous = data.previous_week_minutes ?? 0;
    const change = previous > 0 ? Math.round(((week - previous) / previous) * 100) : null;
    return (
        <ProfileSectionCard icon={ChartBar} heading={`Last ${DAYS} days`}>
            <div className="grid grid-cols-2 gap-2 text-center md:grid-cols-4">
                {[
                    { v: minutesLabel(data.total_minutes ?? 0), l: 'Time learning' },
                    { v: `${data.active_days ?? 0}`, l: 'Active days' },
                    { v: `${data.slides_opened ?? 0}`, l: 'Slides opened' },
                    {
                        v: minutesLabel(week),
                        l:
                            change == null
                                ? 'Last 7 days'
                                : `Last 7 days, ${change >= 0 ? '+' : ''}${change}%`,
                    },
                ].map((x) => (
                    <div key={x.l} className="rounded-lg bg-neutral-50 px-2 py-2">
                        <div className="text-base font-bold text-neutral-800">{x.v}</div>
                        <div className="text-2xs text-neutral-500">{x.l}</div>
                    </div>
                ))}
            </div>
        </ProfileSectionCard>
    );
};

const DailyTime = ({
    userId,
    packageSessionIds,
    brand,
}: {
    userId: string;
    packageSessionIds: string[];
    brand: string;
}) => {
    const [range] = useState(() => ({
        startDate: format(subDays(new Date(), DAYS), 'yyyy-MM-dd'),
        endDate: format(new Date(), 'yyyy-MM-dd'),
    }));
    const { data, isLoading } = useQuery(getLearnerDailyTimeQuery({ userId, packageSessionIds, ...range }));
    const points = (data ?? []).map((d) => ({
        date: String(d.activity_date).slice(0, 10),
        minutes: (d.time_spent_by_user_millis ?? 0) / 60000,
        compare: d.avg_time_spent_by_batch_millis != null ? d.avg_time_spent_by_batch_millis / 60000 : null,
    }));
    return (
        <ProfileSectionCard icon={CalendarDots} heading="Time spent each day">
            {isLoading ? (
                <ProfileSkeleton blocks={1} />
            ) : points.every((p) => p.minutes === 0) ? (
                <ProfileEmpty icon={CalendarDots} title="No learning time in this period" />
            ) : (
                <DailyTimeChart
                    data={points}
                    brand={brand}
                    valueLabel="This learner"
                    compareLabel="Batch average"
                    height={170}
                />
            )}
        </ProfileSectionCard>
    );
};

const ContentMix = ({ data, brand }: { data: LearnerInsights; brand: string }) => {
    const max = Math.max(1, ...data.content_mix.map((m) => m.minutes));
    return (
        <ProfileSectionCard icon={BookOpenText} heading="What they spend time on">
            {data.content_mix.length === 0 ? (
                <ProfileEmpty icon={BookOpenText} title="No content opened in this period" />
            ) : (
                <HorizontalBars
                    color={brand}
                    max={max}
                    rows={data.content_mix.map((m) => ({
                        key: m.type ?? 'other',
                        label: contentLabel(m.type),
                        value: m.minutes,
                        display: minutesLabel(m.minutes),
                        sub: `${m.slides} slide${m.slides === 1 ? '' : 's'}`,
                    }))}
                />
            )}
        </ProfileSectionCard>
    );
};

/** When they study: weekdays against three-hour bands, darker means more time. */
const StudyRhythm = ({ data, brand }: { data: LearnerInsights; brand: string }) => {
    const cells = new Map<string, number>();
    for (const r of data.rhythm) {
        const band = Math.floor(r.hour / 3) * 3;
        const key = `${r.weekday}-${band}`;
        cells.set(key, (cells.get(key) ?? 0) + r.minutes);
    }
    const max = Math.max(1, ...cells.values());
    let peak: { weekday: number; band: number; minutes: number } | null = null;
    cells.forEach((minutes, key) => {
        if (peak == null || minutes > peak.minutes) {
            const [weekday, band] = key.split('-').map(Number);
            peak = { weekday: weekday ?? 1, band: band ?? 0, minutes };
        }
    });
    const best = peak as { weekday: number; band: number; minutes: number } | null;
    return (
        <ProfileSectionCard icon={CalendarDots} heading="When they study">
            {cells.size === 0 ? (
                <ProfileEmpty icon={CalendarDots} title="No study time in this period" />
            ) : (
                <div className="flex flex-col gap-2">
                    {best && (
                        <span className="text-sm font-semibold text-neutral-800">
                            Most often {WEEKDAYS[best.weekday - 1]} around {bandLabel(best.band)}
                        </span>
                    )}
                    <div className="grid grid-cols-[2rem_repeat(8,minmax(0,1fr))] gap-1 text-2xs text-neutral-500">
                        <span />
                        {HOUR_BANDS.map((h) => (
                            <span key={h} className="truncate text-center">
                                {bandLabel(h)}
                            </span>
                        ))}
                        {WEEKDAYS.flatMap((day, i) => [
                            <span key={day} className="self-center">
                                {day}
                            </span>,
                            ...HOUR_BANDS.map((h) => {
                                const minutes = cells.get(`${i + 1}-${h}`) ?? 0;
                                return (
                                    <span
                                        key={`${day}-${h}`}
                                        title={`${day} ${bandLabel(h)}: ${minutesLabel(minutes)}`}
                                        className="h-5 rounded-sm"
                                        style={{
                                            background: minutes > 0 ? brand : REPORT_COLORS.line,
                                            opacity: minutes > 0 ? 0.25 + 0.75 * (minutes / max) : 1,
                                        }}
                                    />
                                );
                            }),
                        ])}
                    </div>
                </div>
            )}
        </ProfileSectionCard>
    );
};

const RecentTests = ({
    userId,
    instituteId,
    batchId,
}: {
    userId: string;
    instituteId: string;
    batchId?: string;
}) => {
    const [range] = useState(() => ({
        startDate: format(subDays(new Date(), DAYS), 'yyyy-MM-dd'),
        endDate: format(new Date(), 'yyyy-MM-dd'),
    }));
    const { data, isLoading } = useQuery(getStudentReportSnapshotQuery({ userId, instituteId, batchId, ...range }));
    const tests = [...(data?.academics?.assessments ?? [])]
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        .slice(0, 6);
    return (
        <ProfileSectionCard icon={Exam} heading={`Assessments, last ${DAYS} days`}>
            {isLoading ? (
                <ProfileSkeleton blocks={2} />
            ) : tests.length === 0 ? (
                <ProfileEmpty icon={Exam} title="No assessments in this period" />
            ) : (
                <ul className="flex flex-col divide-y divide-neutral-100">
                    {tests.map((t) => (
                        <li key={t.assessment_id} className="flex items-center gap-2 py-1.5">
                            <div className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-sm text-neutral-800" title={t.name ?? ''}>
                                    {t.name ?? 'Assessment'}
                                </span>
                                <span className="truncate text-xs text-neutral-500">
                                    {[t.date, t.rank != null ? `Rank ${t.rank}` : null].filter(Boolean).join(' · ')}
                                </span>
                            </div>
                            <span
                                className="shrink-0 text-sm font-bold"
                                style={{ color: scoreColor(t.percentage) }}
                            >
                                {pct(t.percentage)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </ProfileSectionCard>
    );
};

const CourseProgress = ({
    userId,
    instituteId,
    batchId,
}: {
    userId: string;
    instituteId: string;
    batchId?: string;
}) => {
    const { data, isLoading } = useLearnerPackagesQuery({
        instituteId,
        userId,
        type: 'PROGRESS',
        size: 20,
    });
    const courses = (data?.content ?? []).filter((c) => !batchId || c.package_session_id === batchId);
    return (
        <ProfileSectionCard icon={Books} heading="Course progress">
            {isLoading ? (
                <ProfileSkeleton blocks={2} />
            ) : courses.length === 0 ? (
                <ProfileEmpty icon={Books} title="No courses in progress" />
            ) : (
                <ul className="flex flex-col gap-2.5">
                    {courses.map((c) => (
                        <li key={`${c.id}-${c.package_session_id ?? ''}`} className="flex flex-col gap-1">
                            <div className="flex items-baseline justify-between gap-2 text-sm">
                                <span className="truncate text-neutral-800" title={c.package_name}>
                                    {c.package_name}
                                    {c.level_name ? (
                                        <span className="text-neutral-500"> · {c.level_name}</span>
                                    ) : null}
                                </span>
                                <span className="shrink-0 text-xs font-semibold text-neutral-700">
                                    {Math.round(c.percentage_completed ?? 0)}%
                                </span>
                            </div>
                            <Bar value={c.percentage_completed ?? 0} />
                        </li>
                    ))}
                </ul>
            )}
        </ProfileSectionCard>
    );
};

const LiveClasses = ({ userId }: { userId: string }) => {
    const end = format(new Date(), 'yyyy-MM-dd');
    const start = format(subDays(new Date(), DAYS), 'yyyy-MM-dd');
    const { data, isLoading } = useQuery(getLearnerLiveSessionsQuery(userId, start, end));
    const classes = (data?.classes ?? []).slice(0, 5);
    return (
        <ProfileSectionCard icon={VideoCamera} heading={`Live classes, last ${DAYS} days`}>
            {isLoading ? (
                <ProfileSkeleton blocks={2} />
            ) : !data || data.total_classes === 0 ? (
                <ProfileEmpty icon={VideoCamera} title="No live classes in this period" />
            ) : (
                <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-3 gap-2 text-center">
                        {[
                            { v: `${Math.round(data.attendance_percentage ?? 0)}%`, l: 'Attended' },
                            { v: `${data.present_count}/${data.total_classes}`, l: 'Classes' },
                            {
                                v:
                                    data.avg_concentration_score != null
                                        ? `${Math.round(data.avg_concentration_score)}`
                                        : '—',
                                l: 'Focus score',
                            },
                        ].map((x) => (
                            <div key={x.l} className="rounded-lg bg-neutral-50 px-2 py-2">
                                <div className="text-base font-bold text-neutral-800">{x.v}</div>
                                <div className="text-2xs text-neutral-500">{x.l}</div>
                            </div>
                        ))}
                    </div>
                    <ul className="flex flex-col divide-y divide-neutral-100">
                        {classes.map((c) => (
                            <li key={c.schedule_id} className="flex items-center gap-2 py-1.5 text-sm">
                                <span className="truncate text-neutral-700">{c.title ?? 'Live class'}</span>
                                <span className="ml-auto shrink-0 text-xs text-neutral-500">
                                    {c.meeting_date}
                                </span>
                                <span
                                    className={cn(
                                        'shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-semibold',
                                        c.attendance_status === 'PRESENT'
                                            ? 'bg-success-50 text-success-700'
                                            : c.attendance_status === 'ABSENT'
                                              ? 'bg-danger-50 text-danger-700'
                                              : 'bg-neutral-100 text-neutral-500'
                                    )}
                                >
                                    {c.attendance_status === 'PRESENT'
                                        ? 'Present'
                                        : c.attendance_status === 'ABSENT'
                                          ? 'Absent'
                                          : 'Unmarked'}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </ProfileSectionCard>
    );
};

const Transcript = ({ sessionId }: { sessionId: string }) => {
    const { data, isLoading } = useConversationMessagesQuery(sessionId);
    const messages = (data ?? []).filter((m) => m.type === 'user' || m.type === 'assistant');
    if (isLoading) return <ProfileSkeleton blocks={2} />;
    if (messages.length === 0) {
        return <p className="py-2 text-xs text-neutral-500">No messages in this chat.</p>;
    }
    return (
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-lg bg-neutral-50 p-2">
            {messages.map((m) => {
                const mine = m.type === 'user';
                return (
                    <div key={m.id} className={cn('flex gap-1.5', mine ? 'justify-end' : 'justify-start')}>
                        {!mine && <Robot className="mt-1 size-4 shrink-0 text-primary-500" weight="duotone" />}
                        <div
                            className={cn(
                                'max-w-[85%] whitespace-pre-wrap rounded-xl px-2.5 py-1.5 text-xs',
                                mine ? 'bg-primary-500 text-white' : 'bg-white text-neutral-700 shadow-sm'
                            )}
                        >
                            {m.content}
                        </div>
                        {mine && <UserCircle className="mt-1 size-4 shrink-0 text-neutral-400" weight="duotone" />}
                    </div>
                );
            })}
        </div>
    );
};

const AiChats = ({ userId }: { userId: string }) => {
    const [open, setOpen] = useState<string | null>(null);
    const [filters] = useState(() => ({
        startDate: subDays(new Date(), DAYS).setHours(0, 0, 0, 0),
        endDate: Date.now(),
    }));
    const { data, isLoading, isError } = useUserConversationsQuery(userId, 0, 10, filters);
    const rows = data?.content ?? [];
    return (
        <ProfileSectionCard icon={ChatsCircle} heading={`AI tutor chats, last ${DAYS} days`}>
            {isLoading ? (
                <ProfileSkeleton blocks={2} />
            ) : isError ? (
                <ProfileEmpty
                    icon={ChatsCircle}
                    title="Chats are not available"
                    hint="Only staff of this institute can view them."
                />
            ) : rows.length === 0 ? (
                <ProfileEmpty
                    icon={ChatsCircle}
                    title="No AI tutor chats"
                    hint="Prompts and answers show up here."
                />
            ) : (
                <ul className="flex flex-col divide-y divide-neutral-100">
                    {rows.map((c) => (
                        <li key={c.sessionId} className="flex flex-col gap-1.5 py-2">
                            <button
                                type="button"
                                onClick={() => setOpen(open === c.sessionId ? null : c.sessionId)}
                                className="flex w-full items-start gap-2 text-left"
                            >
                                <ChatsCircle className="mt-0.5 size-4 shrink-0 text-primary-500" weight="duotone" />
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-sm text-neutral-800">
                                        {c.preview ?? 'Chat'}
                                    </span>
                                    <span className="truncate text-xs text-neutral-500">
                                        {[c.contextTitle, `${c.messageCount} messages`, ago(c.lastActive ?? c.createdAt)]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </span>
                                </div>
                                <CaretDown
                                    className={cn(
                                        'mt-1 size-3.5 shrink-0 text-neutral-400 transition-transform',
                                        open === c.sessionId && 'rotate-180'
                                    )}
                                />
                            </button>
                            {open === c.sessionId && <Transcript sessionId={c.sessionId} />}
                        </li>
                    ))}
                </ul>
            )}
        </ProfileSectionCard>
    );
};

export const StudentAcademicActivity = ({
    userId,
    instituteId,
    packageSessionIds = [],
}: {
    userId: string;
    instituteId: string;
    /** The learner batches: the batch picker and the batch average on the daily time chart. */
    packageSessionIds?: string[];
}) => {
    const brand = useBrandColor();
    const [picked, setPicked] = useState(ALL_BATCHES);
    const selected = packageSessionIds.includes(picked) ? picked : ALL_BATCHES;
    const batchId = selected === ALL_BATCHES ? undefined : selected;
    const insights = useQuery({
        queryKey: ['LEARNER_ACADEMIC_INSIGHTS', userId, instituteId],
        queryFn: () => fetchLearnerInsights(userId, instituteId),
        enabled: !!userId && !!instituteId,
        staleTime: 5 * 60_000,
    });
    const pulse = useQuery({
        queryKey: ['LEARNER_PULSE', userId, instituteId],
        queryFn: () => fetchLearnerPulse(userId, instituteId),
        enabled: !!userId && !!instituteId,
        refetchInterval: 30_000,
        staleTime: 15_000,
    });
    return (
        <div className="flex flex-col gap-3">
            <BatchPicker
                packageSessionIds={packageSessionIds}
                value={selected}
                onChange={setPicked}
                allLabel={`All ${getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch).toLowerCase()}`}
            />
            {pulse.isLoading ? (
                <ProfileSkeleton blocks={2} />
            ) : pulse.data ? (
                <>
                    <LivePulse pulse={pulse.data} />
                    <RecentlyRead pulse={pulse.data} />
                </>
            ) : (
                <ProfileEmpty icon={Lightning} title="Live pulse is not available" />
            )}
            {insights.data && <ThisMonth data={insights.data} />}
            {packageSessionIds.length > 0 && (
                <DailyTime
                    userId={userId}
                    packageSessionIds={batchId ? [batchId] : packageSessionIds}
                    brand={brand}
                />
            )}
            <CourseProgress userId={userId} instituteId={instituteId} batchId={batchId} />
            {insights.data && <ContentMix data={insights.data} brand={brand} />}
            {insights.data && <StudyRhythm data={insights.data} brand={brand} />}
            <RecentTests userId={userId} instituteId={instituteId} batchId={batchId} />
            <LiveClasses userId={userId} />
            <StudentGamification
                userId={userId}
                instituteId={instituteId}
                packageSessionIds={packageSessionIds}
                defaultBatch={packageSessionIds.length === 1 ? packageSessionIds[0] : selected}
            />
            <AiChats userId={userId} />
        </div>
    );
};
