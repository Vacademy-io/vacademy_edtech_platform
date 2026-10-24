import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AreaChart, Area, BarChart, Bar, CartesianGrid, XAxis, YAxis } from 'recharts';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';
import {
    DownloadSimple,
    X,
    CalendarBlank,
    ChartBar,
    ClockCountdown,
    BookOpen,
    Video,
    Certificate,
    ClipboardText,
    ChatTeardropDots,
    SignIn,
    Lightbulb,
    Trophy,
    Info,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { downloadReportPdf } from '@/services/student-analysis';
import type {
    ComprehensiveStudentReport,
    AcademicsSectionItem,
    DailyTimeEntry,
    RecommendationItem,
    V2ReportData,
    V2HeadlineMetric,
    V2Strength,
    V2Achievement,
    V2Recommendation,
    V2Assessment,
    V2SubjectPerformance,
    V2AttendanceWeekly,
    V2CourseProgressSubject,
    V2DailyStudyMinute,
    V2SubjectMarksItem,
} from '@/types/student-analysis';
import { ProfileSectionCard } from '../profile-ui';
import { StudentReportCard } from './StudentReportCard';
import useInstituteLogoStore from '@/components/common/layout-container/sidebar/institutelogo-global-zustand';

// ── V2 type alias for admin use ───────────────────────────────────────────────
// V2AdminReportData is V2ReportData from student-analysis.ts
export type V2AdminReportData = V2ReportData;

// ── Type guard ────────────────────────────────────────────────────────────────

function isV2AdminReport(
    report: ComprehensiveStudentReport | V2AdminReportData | null,
): report is V2AdminReportData {
    if (!report) return false;
    const r = report as unknown as Record<string, unknown>;
    return (
        'meta' in report ||
        (typeof r['overview'] === 'object' &&
            r['overview'] !== null &&
            'headline_metrics' in (r['overview'] as Record<string, unknown>))
    );
}

// ── Chart configs ─────────────────────────────────────────────────────────────

const buildActivityChartConfig = (t: TFunction) =>
    ({
        minutes: {
            label: t('activity.chart.timeMinutes'),
            color: 'hsl(var(--chart-1))',
        },
    }) satisfies ChartConfig;

const buildAcademicsChartConfig = (t: TFunction) =>
    ({
        marks: {
            label: t('academics.chart.marks'),
            color: 'hsl(var(--chart-2))',
        },
        total_marks: {
            label: t('academics.chart.total'),
            color: 'hsl(var(--chart-6))',
        },
    }) satisfies ChartConfig;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (iso: string) => {
    try {
        return format(new Date(iso), 'MMM d, yyyy');
    } catch {
        return iso;
    }
};

// A subject label is only worth showing if it's a real subject — never a placeholder
// catch-all bucket. The backend omits these now; this guards historical reports too.
const SUBJECT_PLACEHOLDERS = new Set([
    'unknown',
    'other',
    'others',
    'n/a',
    'na',
    'general',
    'misc',
    'miscellaneous',
    '-',
]);
const isRealSubject = (subject?: string | null): boolean => {
    const s = subject?.trim().toLowerCase();
    return !!s && !SUBJECT_PLACEHOLDERS.has(s);
};

const priorityTone = (priority: string) => {
    const p = priority?.toLowerCase();
    if (p === 'high') return 'text-danger-700 bg-danger-50 ring-danger-200';
    if (p === 'medium') return 'text-warning-700 bg-warning-50 ring-warning-200';
    return 'text-info-700 bg-info-50 ring-info-200';
};

const UnavailableCard = () => {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    return (
        <ProfileSectionCard>
            <p className="py-6 text-center text-sm text-neutral-500">
                {t('unavailable.noDataForPeriod')}
            </p>
        </ProfileSectionCard>
    );
};

// ── Tab: Overview ─────────────────────────────────────────────────────────────

interface OverviewTabProps {
    report: ComprehensiveStudentReport;
}

const OverviewTab = ({ report }: OverviewTabProps) => {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    const { student, period, login } = report;

    const stats: Array<{ label: string; value: React.ReactNode; tone?: string }> = [
        { label: t('overview.stats.batch'), value: student.batch || '—' },
        { label: t('overview.stats.enrollmentNo'), value: student.enrollment_no || '—' },
        { label: t('overview.stats.status'), value: student.status || '—' },
        {
            label: t('overview.stats.enrolled'),
            value: student.enrolled_date ? fmtDate(student.enrolled_date) : '—',
        },
        {
            label: t('overview.stats.reportPeriod'),
            value: `${fmtDate(period.start_date_iso)} – ${fmtDate(period.end_date_iso)}`,
        },
        { label: t('overview.stats.generated'), value: fmtDate(period.generated_at) },
    ];

    const loginStats = login?.available
        ? [
              { label: t('overview.loginStats.totalLogins'), value: login.total_logins },
              { label: t('overview.loginStats.lastLogin'), value: fmtDate(login.last_login) },
              {
                  label: t('overview.loginStats.avgSession'),
                  value: t('overview.avgSessionValue', { minutes: login.avg_session_minutes }),
              },
              {
                  label: t('overview.loginStats.totalActiveTime'),
                  value: t('overview.totalActiveTimeValue', {
                      hours: Math.round(login.total_active_time_minutes / 60),
                  }),
              },
          ]
        : [];

    return (
        <div className="flex flex-col gap-4">
            <ProfileSectionCard heading={t('overview.studentDetailsHeading')}>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 pt-1">
                    {stats.map((s) => (
                        <div key={s.label} className="flex flex-col gap-0.5">
                            <dt className="text-xs text-neutral-400">{s.label}</dt>
                            <dd className="text-sm font-medium text-neutral-800">{s.value}</dd>
                        </div>
                    ))}
                </dl>
            </ProfileSectionCard>

            {login?.available ? (
                <ProfileSectionCard
                    heading={t('overview.loginActivityHeading')}
                    icon={SignIn as PhosphorIcon}
                >
                    <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
                        {loginStats.map((s) => (
                            <div
                                key={s.label}
                                className="flex flex-col gap-0.5 rounded-md bg-neutral-50 px-3 py-2"
                            >
                                <span className="text-xs text-neutral-400">{s.label}</span>
                                <span className="text-sm font-semibold text-neutral-800">
                                    {s.value}
                                </span>
                            </div>
                        ))}
                    </div>
                </ProfileSectionCard>
            ) : (
                <ProfileSectionCard
                    heading={t('overview.loginActivityHeading')}
                    icon={SignIn as PhosphorIcon}
                >
                    <UnavailableCard />
                </ProfileSectionCard>
            )}
        </div>
    );
};

// ── Tab: Attendance ───────────────────────────────────────────────────────────

const AttendanceTab = ({ report }: { report: ComprehensiveStudentReport }) => {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    const att = report.attendance;
    if (!att?.available) {
        return <UnavailableCard />;
    }

    const sessions = att.sessions ?? [];
    const pct = Math.round(att.overall_percentage);
    const tone =
        pct >= 75
            ? '[&>div]:bg-success-500'
            : pct >= 50
              ? '[&>div]:bg-warning-500'
              : '[&>div]:bg-danger-500';

    return (
        <div className="flex flex-col gap-4">
            <ProfileSectionCard
                heading={t('attendance.overallHeading')}
                icon={CalendarBlank as PhosphorIcon}
            >
                <div className="flex flex-col gap-3 pt-1">
                    <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-neutral-700">
                            {t('attendance.attendanceRate')}
                        </span>
                        <span className="font-semibold text-neutral-800">{pct}%</span>
                    </div>
                    <Progress value={pct} className={cn('h-2.5 !bg-neutral-100', tone)} />
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: t('common.stats.present'), value: att.present, cls: 'text-success-600' },
                            { label: t('common.stats.absent'), value: att.absent, cls: 'text-danger-600' },
                            { label: t('common.stats.unmarked'), value: att.unmarked, cls: 'text-neutral-500' },
                        ].map((s) => (
                            <div
                                key={s.label}
                                className="flex flex-col items-center rounded-md bg-neutral-50 py-2"
                            >
                                <span className={cn('text-xl font-bold', s.cls)}>{s.value}</span>
                                <span className="text-xs text-neutral-400">{s.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </ProfileSectionCard>

            {sessions.length > 0 && (
                <ProfileSectionCard heading={t('attendance.recentSessionsHeading')}>
                    <div className="mt-1 flex flex-col divide-y divide-border">
                        {sessions.slice(0, 10).map((s, i) => (
                            <div key={i} className="flex items-center justify-between gap-3 py-2">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-neutral-800">
                                        {s.title || t('attendance.sessionFallbackTitle')}
                                    </p>
                                    <p className="text-xs text-neutral-400">
                                        {s.subject} · {fmtDate(s.date)}
                                    </p>
                                </div>
                                <span
                                    className={cn(
                                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1',
                                        s.status?.toLowerCase() === 'present'
                                            ? 'bg-success-50 text-success-700 ring-success-200'
                                            : s.status?.toLowerCase() === 'absent'
                                              ? 'bg-danger-50 text-danger-700 ring-danger-200'
                                              : 'bg-neutral-100 text-neutral-600 ring-neutral-200'
                                    )}
                                >
                                    {s.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </ProfileSectionCard>
            )}
        </div>
    );
};

// ── Tab: Academics ────────────────────────────────────────────────────────────

const AcademicsTab = ({ report }: { report: ComprehensiveStudentReport }) => {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    const acs = report.academics;
    if (!acs?.available) return <UnavailableCard />;

    const assessmentFallbackName = t('academics.assessmentFallbackName');
    const academicsChartConfig = buildAcademicsChartConfig(t);
    const assessments = acs.assessments ?? [];
    const chartData = assessments.slice(0, 12).map((a: AcademicsSectionItem) => ({
        name: a.assessment_name?.slice(0, 12) ?? assessmentFallbackName,
        marks: a.marks,
        total_marks: a.total_marks,
    }));

    return (
        <div className="flex flex-col gap-4">
            {/* Summary tiles */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                    { label: t('academics.summary.assessments'), value: acs.averages?.total_assessments ?? 0 },
                    {
                        label: t('academics.summary.avgScore'),
                        value: `${Math.round(acs.averages?.avg_percentage ?? 0)}%`,
                    },
                    { label: t('academics.summary.best'), value: acs.averages?.best_assessment?.slice(0, 16) ?? '—' },
                    {
                        label: t('academics.summary.needsWork'),
                        value: acs.averages?.weakest_assessment?.slice(0, 16) ?? '—',
                    },
                ].map((s) => (
                    <div
                        key={s.label}
                        className="flex flex-col gap-0.5 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 shadow-sm"
                    >
                        <span className="text-xs text-neutral-400">{s.label}</span>
                        <span className="truncate text-sm font-semibold text-neutral-800">
                            {s.value}
                        </span>
                    </div>
                ))}
            </div>

            {/* Marks bar chart */}
            {chartData.length > 0 && (
                <ProfileSectionCard
                    heading={t('academics.assessmentScoresHeading')}
                    icon={ChartBar as PhosphorIcon}
                >
                    <ChartContainer
                        config={academicsChartConfig}
                        // Fixed chart height — no Tailwind equivalent; isolated inline style per design-system rules.
                        // design-lint-ignore: chart canvas height
                        style={{ height: 220 }}
                        className="w-full pt-2"
                    >
                        <BarChart data={chartData} margin={{ left: 0, right: 8, bottom: 20 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis
                                dataKey="name"
                                tickLine={false}
                                axisLine={false}
                                tickMargin={6}
                                tick={{ fontSize: 10 }}
                                angle={-30}
                                textAnchor="end"
                            />
                            <YAxis
                                tickLine={false}
                                axisLine={false}
                                width={32}
                                tick={{ fontSize: 10 }}
                            />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar
                                dataKey="total_marks"
                                fill="var(--color-total_marks)"
                                radius={[2, 2, 0, 0]}
                            />
                            <Bar dataKey="marks" fill="var(--color-marks)" radius={[2, 2, 0, 0]} />
                        </BarChart>
                    </ChartContainer>
                </ProfileSectionCard>
            )}

            {/* Assessment list */}
            <ProfileSectionCard heading={t('academics.allAssessmentsHeading')}>
                <div className="mt-1 flex flex-col divide-y divide-border">
                    {assessments.map((a) => (
                        <div
                            key={a.attempt_id}
                            className="flex items-center justify-between gap-3 py-2"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-neutral-800">
                                    {a.assessment_name}
                                </p>
                                <p className="text-xs text-neutral-400">
                                    {fmtDate(a.attempt_date)}
                                </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-0.5">
                                <span className="text-sm font-semibold text-neutral-800">
                                    {a.marks}/{a.total_marks}
                                </span>
                                <span className="text-xs text-neutral-500">
                                    {Math.round(a.percentage)}%
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </ProfileSectionCard>
        </div>
    );
};

// ── Tab: Activity ─────────────────────────────────────────────────────────────

const ActivityTab = ({ report }: { report: ComprehensiveStudentReport }) => {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    const act = report.activity;
    if (!act?.available) return <UnavailableCard />;

    const activityChartConfig = buildActivityChartConfig(t);
    const chartData = (act.daily_time ?? []).map((d: DailyTimeEntry) => ({
        date: d.date,
        minutes: d.minutes,
    }));

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
                {[
                    {
                        label: t('activity.totalTime'),
                        value: `${Math.round(act.total_time_minutes / 60)} h`,
                    },
                    {
                        label: t('activity.avgConcentration'),
                        value:
                            act.avg_concentration != null
                                ? `${Math.round(act.avg_concentration)}%`
                                : t('common.notAvailable'),
                    },
                ].map((s) => (
                    <div
                        key={s.label}
                        className="flex flex-col gap-0.5 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 shadow-sm"
                    >
                        <span className="text-xs text-neutral-400">{s.label}</span>
                        <span className="text-lg font-bold text-neutral-800">{s.value}</span>
                    </div>
                ))}
            </div>

            {chartData.length > 0 && (
                <ProfileSectionCard
                    heading={t('activity.dailyActivityHeading')}
                    icon={ClockCountdown as PhosphorIcon}
                >
                    <ChartContainer
                        config={activityChartConfig}
                        // Fixed chart height — no Tailwind equivalent; isolated inline style per design-system rules.
                        // design-lint-ignore: chart canvas height
                        style={{ height: 200 }}
                        className="w-full pt-2"
                    >
                        <AreaChart data={chartData} margin={{ left: 0, right: 8, bottom: 16 }}>
                            <defs>
                                <linearGradient id="activityGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop
                                        offset="5%"
                                        stopColor="var(--color-minutes)"
                                        stopOpacity={0.3}
                                    />
                                    <stop
                                        offset="95%"
                                        stopColor="var(--color-minutes)"
                                        stopOpacity={0}
                                    />
                                </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} />
                            <XAxis
                                dataKey="date"
                                tickLine={false}
                                axisLine={false}
                                tickMargin={6}
                                tick={{ fontSize: 10 }}
                                tickFormatter={(v) => {
                                    try {
                                        return format(new Date(v), 'MMM d');
                                    } catch {
                                        return v;
                                    }
                                }}
                            />
                            <YAxis
                                tickLine={false}
                                axisLine={false}
                                width={32}
                                tick={{ fontSize: 10 }}
                            />
                            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                            <Area
                                dataKey="minutes"
                                type="monotone"
                                stroke="var(--color-minutes)"
                                strokeWidth={2}
                                fill="url(#activityGrad)"
                            />
                        </AreaChart>
                    </ChartContainer>
                </ProfileSectionCard>
            )}

            {Object.keys(act.content_engagement ?? {}).length > 0 && (
                <ProfileSectionCard heading={t('activity.contentEngagementHeading')}>
                    <div className="mt-1 flex flex-col gap-3">
                        {Object.entries(act.content_engagement).map(([key, val]) => (
                            <div key={key} className="flex flex-col gap-1">
                                <div className="flex justify-between text-xs">
                                    <span className="font-medium capitalize text-neutral-700">
                                        {key}
                                    </span>
                                    <span className="text-neutral-500">
                                        {t('activity.minutesValue', { minutes: val })}
                                    </span>
                                </div>
                                <Progress
                                    value={Math.min(
                                        100,
                                        (val / Math.max(...Object.values(act.content_engagement))) *
                                            100
                                    )}
                                    className="h-1.5 !bg-neutral-100 [&>div]:bg-primary-500"
                                />
                            </div>
                        ))}
                    </div>
                </ProfileSectionCard>
            )}
        </div>
    );
};

// ── Tab: Progress ─────────────────────────────────────────────────────────────

const ProgressTab = ({ report }: { report: ComprehensiveStudentReport }) => {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    const prog = report.progress;
    if (!prog?.available) return <UnavailableCard />;

    const subjects = prog.subjects ?? [];
    return (
        <div className="flex flex-col gap-4">
            <ProfileSectionCard
                heading={t('progress.courseCompletionHeading')}
                icon={BookOpen as PhosphorIcon}
            >
                <div className="flex flex-col gap-2 pt-1">
                    <div className="flex justify-between text-sm">
                        <span className="text-neutral-700">{t('progress.overallProgress')}</span>
                        <span className="font-semibold text-neutral-800">
                            {Math.round(prog.course_completion_percentage)}%
                        </span>
                    </div>
                    <Progress
                        value={prog.course_completion_percentage}
                        className="h-3 !bg-neutral-100 [&>div]:bg-primary-500"
                    />
                </div>
            </ProfileSectionCard>

            {subjects.length > 0 && (
                <ProfileSectionCard heading={t('progress.subjectProgressHeading')}>
                    <div className="mt-1 flex flex-col gap-3">
                        {subjects.map((s) => (
                            <div key={s.subject_id} className="flex flex-col gap-1">
                                <div className="flex justify-between text-xs">
                                    <span className="font-medium text-neutral-700">{s.name}</span>
                                    <span className="text-neutral-500">
                                        {Math.round(s.percentage)}%
                                    </span>
                                </div>
                                <Progress
                                    value={s.percentage}
                                    className="h-1.5 !bg-neutral-100 [&>div]:bg-primary-400"
                                />
                            </div>
                        ))}
                    </div>
                </ProfileSectionCard>
            )}
        </div>
    );
};

// ── Tab: Live Classes ─────────────────────────────────────────────────────────

const LiveClassesTab = ({ report }: { report: ComprehensiveStudentReport }) => {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    const lc = report.live_classes;
    if (!lc?.available) return <UnavailableCard />;

    return (
        <div className="flex flex-col gap-4">
            <ProfileSectionCard heading={t('liveClasses.summaryHeading')} icon={Video as PhosphorIcon}>
                <div className="mb-3 flex items-baseline justify-between rounded-md bg-neutral-50 px-4 py-3">
                    <span className="text-xs text-neutral-500">
                        {t('liveClasses.totalClasses')}{' '}
                        <span className="font-semibold text-neutral-800">{lc.total ?? 0}</span>
                    </span>
                    <span className="text-sm font-semibold text-neutral-800">
                        {t('liveClasses.attendanceSuffix', {
                            value: lc.attendance_percentage != null ? `${lc.attendance_percentage}%` : '—',
                        })}
                    </span>
                </div>
                <div className="grid grid-cols-3 gap-3 pt-1">
                    {[
                        { label: t('common.stats.attended'), value: lc.attended ?? 0, cls: 'text-success-600' },
                        { label: t('common.stats.missed'), value: lc.missed ?? 0, cls: 'text-danger-600' },
                        { label: t('common.stats.notMarked'), value: lc.unmarked ?? 0, cls: 'text-neutral-500' },
                    ].map((s) => (
                        <div
                            key={s.label}
                            className="flex flex-col items-center rounded-md bg-neutral-50 py-3"
                        >
                            <span className={cn('text-2xl font-bold', s.cls)}>{s.value}</span>
                            <span className="text-xs text-neutral-400">{s.label}</span>
                        </div>
                    ))}
                </div>
            </ProfileSectionCard>
        </div>
    );
};

// ── Tab: Certificates ─────────────────────────────────────────────────────────

const CertificatesTab = ({ report }: { report: ComprehensiveStudentReport }) => {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    const certs = report.certificates ?? [];
    if (!certs.length) return <UnavailableCard />;

    return (
        <div className="flex flex-col gap-3">
            {certs.map((c) => (
                <ProfileSectionCard
                    key={c.certificate_id}
                    icon={Certificate as PhosphorIcon}
                    heading={c.course_name}
                >
                    <div className="flex items-center gap-4 pt-1">
                        <div className="flex-1">
                            <div className="mb-1 flex justify-between text-xs text-neutral-500">
                                <span>{t('certificates.completion')}</span>
                                <span>{Math.round(c.completion_percentage)}%</span>
                            </div>
                            <Progress
                                value={c.completion_percentage}
                                className="h-1.5 !bg-neutral-100 [&>div]:bg-success-500"
                            />
                        </div>
                        <span className="shrink-0 text-xs text-neutral-400">
                            {fmtDate(c.issued_at)}
                        </span>
                    </div>
                </ProfileSectionCard>
            ))}
        </div>
    );
};

// ── Tab: Assignments ──────────────────────────────────────────────────────────

const AssignmentsTab = ({ report }: { report: ComprehensiveStudentReport }) => {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    const asgn = report.assignments;
    if (!asgn?.available) return <UnavailableCard />;

    const items = asgn.items ?? [];
    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
                {[
                    { label: t('assignments.summary.submitted'), value: asgn.submitted, cls: 'text-primary-600' },
                    { label: t('assignments.summary.graded'), value: asgn.graded, cls: 'text-success-600' },
                    { label: t('assignments.summary.late'), value: asgn.late, cls: 'text-warning-600' },
                ].map((s) => (
                    <div
                        key={s.label}
                        className="flex flex-col items-center rounded-lg border border-neutral-200 bg-white py-3 shadow-sm"
                    >
                        <span className={cn('text-2xl font-bold', s.cls)}>{s.value}</span>
                        <span className="text-xs text-neutral-400">{s.label}</span>
                    </div>
                ))}
            </div>

            {items.length > 0 && (
                <ProfileSectionCard heading={t('common.headings.assignments')} icon={ClipboardText as PhosphorIcon}>
                    <div className="mt-1 flex flex-col divide-y divide-border">
                        {items.map((item) => (
                            <div
                                key={item.slide_id}
                                className="flex items-center justify-between gap-3 py-2"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-neutral-800">
                                        {item.title}
                                    </p>
                                    {item.feedback && (
                                        <p className="truncate text-xs text-neutral-400">
                                            {item.feedback}
                                        </p>
                                    )}
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-0.5">
                                    <span className="text-sm font-semibold text-neutral-800">
                                        {item.score_percentage != null
                                            ? `${item.score_percentage}%`
                                            : item.marks != null
                                              ? item.marks
                                              : t('assignments.notGraded')}
                                    </span>
                                    {item.late && (
                                        <span className="rounded-full bg-warning-50 px-1.5 py-0.5 text-xs font-medium text-warning-700 ring-1 ring-warning-200">
                                            {t('assignments.lateBadge')}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </ProfileSectionCard>
            )}

            {report.doubts?.available && (
                <ProfileSectionCard heading={t('assignments.doubtsHeading')} icon={ChatTeardropDots as PhosphorIcon}>
                    <div className="grid grid-cols-3 gap-3 pt-1">
                        {[
                            { label: t('assignments.doubtsStats.raised'), value: report.doubts.raised },
                            { label: t('assignments.doubtsStats.resolved'), value: report.doubts.resolved },
                            {
                                label: t('assignments.doubtsStats.avgResolution'),
                                value: `${Math.round(report.doubts.avg_resolution_hours)} h`,
                            },
                        ].map((s) => (
                            <div
                                key={s.label}
                                className="flex flex-col items-center rounded-md bg-neutral-50 py-2"
                            >
                                <span className="text-lg font-bold text-neutral-800">
                                    {s.value}
                                </span>
                                <span className="text-xs text-neutral-400">{s.label}</span>
                            </div>
                        ))}
                    </div>
                </ProfileSectionCard>
            )}
        </div>
    );
};

// ── Tab: AI Insights ──────────────────────────────────────────────────────────

const InsightsTab = ({ report }: { report: ComprehensiveStudentReport }) => {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    const ins = report.ai_insights;
    if (!ins) return <UnavailableCard />;

    return (
        <div className="flex flex-col gap-4">
            {ins.summary && (
                <ProfileSectionCard heading={t('insights.summaryHeading')} icon={Lightbulb as PhosphorIcon}>
                    <p className="pt-1 text-sm leading-relaxed text-neutral-700">{ins.summary}</p>
                </ProfileSectionCard>
            )}

            {ins.cross_domain_insights?.length > 0 && (
                <ProfileSectionCard heading={t('insights.keyInsightsHeading')}>
                    <ul className="mt-1 flex flex-col gap-2">
                        {ins.cross_domain_insights.map((insight, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
                                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary-400" />
                                {insight}
                            </li>
                        ))}
                    </ul>
                </ProfileSectionCard>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                {Object.keys(ins.strengths ?? {}).length > 0 && (
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold text-neutral-800">
                                {t('common.headings.strengths')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                            {Object.entries(ins.strengths).map(([topic, score]) => (
                                <div key={topic} className="flex flex-col gap-1">
                                    <div className="flex justify-between text-xs">
                                        <span className="font-medium text-neutral-700">
                                            {topic}
                                        </span>
                                        <span className="text-success-600">{score}%</span>
                                    </div>
                                    <Progress
                                        value={score}
                                        className="h-1.5 !bg-neutral-100 [&>div]:bg-success-500"
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}

                {Object.keys(ins.weaknesses ?? {}).length > 0 && (
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold text-neutral-800">
                                {t('common.headings.areasToImprove')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                            {Object.entries(ins.weaknesses).map(([topic, score]) => (
                                <div key={topic} className="flex flex-col gap-1">
                                    <div className="flex justify-between text-xs">
                                        <span className="font-medium text-neutral-700">
                                            {topic}
                                        </span>
                                        <span className="text-danger-600">{score}%</span>
                                    </div>
                                    <Progress
                                        value={score}
                                        className="h-1.5 !bg-neutral-100 [&>div]:bg-danger-500"
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}
            </div>

            {ins.recommendations?.length > 0 && (
                <ProfileSectionCard heading={t('insights.recommendationsHeading')}>
                    <div className="mt-1 flex flex-col gap-3">
                        {ins.recommendations.map((rec: RecommendationItem, i) => (
                            <div
                                key={i}
                                className="flex items-start gap-3 rounded-md border border-border bg-neutral-50 p-3"
                            >
                                <span
                                    className={cn(
                                        'mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1',
                                        priorityTone(rec.priority)
                                    )}
                                >
                                    {rec.priority}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-neutral-600">
                                        {rec.area}
                                    </p>
                                    <p className="mt-0.5 text-sm text-neutral-700">
                                        {rec.suggestion}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </ProfileSectionCard>
            )}
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════════
// V2 ADMIN REPORT CARD
// ═══════════════════════════════════════════════════════════════════════════════

// ── Admin V2 section heading ──────────────────────────────────────────────────

function AdminSectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="border-l-4 border-primary-500 pl-3 text-base font-semibold text-neutral-800 mb-4">
            {children}
        </h3>
    );
}

// ── Admin V2 subject bar helpers ──────────────────────────────────────────────

function getAdminSubjectBarClass(sentiment?: string, score?: number): string {
    if (sentiment === 'good') return '[&>div]:bg-success-500';
    if (sentiment === 'attention' || sentiment === 'bad') return '[&>div]:bg-danger-500';
    if (sentiment === 'neutral') return '[&>div]:bg-primary-400';
    if (score !== undefined) {
        if (score >= 70) return '[&>div]:bg-success-500';
        if (score >= 50) return '[&>div]:bg-warning-500';
        return '[&>div]:bg-danger-500';
    }
    return '[&>div]:bg-primary-400';
}

function getAdminWeeklyBarClass(pct: number): string {
    if (pct >= 90) return '[&>div]:bg-success-500';
    if (pct >= 70) return '[&>div]:bg-warning-500';
    return '[&>div]:bg-danger-500';
}

// ── Admin StudentReportCardAdmin ──────────────────────────────────────────────

function StudentReportCardAdmin({ data }: { data: V2AdminReportData }) {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    const { meta, student, institute, period, overview } = data;
    const accentColor = institute.theme_color ?? '#2563eb'; // design-lint-ignore: user-supplied institute theme color
    // Coalesce all arrays that the backend may return as null for sparse reports.
    const headlineMetrics = overview.headline_metrics ?? [];
    const academicAssessments = data.academics?.assessments ?? [];
    // Never surface a placeholder subject ("Unknown"/"Other"/…) to a parent. The backend already
    // omits these, but historical reports may still carry them — filter defensively here too.
    const academicSubjectPerf = (data.academics?.subject_performance ?? []).filter((sp) =>
        isRealSubject(sp.subject),
    );
    const subjectMarksList = (data.subject_marks?.subjects ?? []).filter((sm) =>
        isRealSubject(sm.subject),
    );
    const courseProgressSubjects = data.course_progress?.subjects ?? [];
    const aiCrossDomainInsights = data.ai_insights?.cross_domain_insights ?? [];
    const aiRecommendations = data.ai_insights?.recommendations ?? [];

    return (
        <div className="flex flex-col gap-4">

            {/* Header */}
            <ProfileSectionCard>
                <div
                    className="rounded-lg p-5 text-white"
                    style={{ background: `linear-gradient(135deg, ${accentColor}, color-mix(in srgb, ${accentColor} 60%, #000))` }} /* design-lint-ignore: user-supplied institute theme color */
                >
                    <div className="flex flex-wrap justify-between items-start gap-3">
                        <div>
                            <p className="text-xs opacity-80">{institute.name}</p>
                            <p className="text-lg font-semibold mt-0.5">{t('adminReport.title')}</p>
                            <p className="text-xs opacity-70 mt-0.5">
                                {t('adminReport.periodGenerated', {
                                    period: period.label,
                                    date: fmtDate(meta.generated_at),
                                })}
                            </p>
                        </div>
                        <div
                            className="text-xs font-semibold px-3 py-1.5 rounded-full border border-white/30"
                            style={{ background: 'rgba(255,255,255,0.16)' }} /* design-lint-ignore: header badge overlay */
                        >
                            {t('adminReport.statusGrade', {
                                status: overview.overall_status,
                                grade: overview.overall_grade,
                            })}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 pt-3 border-t border-white/20 text-sm">
                        <div>
                            <p className="text-xs opacity-75">{t('adminReport.studentLabels.student')}</p>
                            <p className="font-semibold">{student.name}</p>
                        </div>
                        <div>
                            <p className="text-xs opacity-75">{t('adminReport.studentLabels.class')}</p>
                            <p className="font-semibold">{student.class}</p>
                        </div>
                        <div>
                            <p className="text-xs opacity-75">{t('adminReport.studentLabels.enrollmentNo')}</p>
                            <p className="font-semibold">{student.enrollment_no}</p>
                        </div>
                        <div>
                            <p className="text-xs opacity-75">{t('adminReport.studentLabels.rollNo')}</p>
                            <p className="font-semibold">{student.roll_no}</p>
                        </div>
                    </div>
                </div>
            </ProfileSectionCard>

            {/* KPI tiles */}
            {headlineMetrics.length > 0 && (
                <ProfileSectionCard heading={t('adminReport.atAGlanceHeading')}>
                    <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-3">
                        {headlineMetrics.map((m: V2HeadlineMetric) => {
                            const displayValue = m.unit
                                ? `${m.value}${m.unit}`
                                : String(m.value);
                            const trendClass =
                                m.trend === 'up'
                                    ? 'text-success-600'
                                    : m.trend === 'down'
                                      ? 'text-danger-600'
                                      : 'text-neutral-500';
                            const arrow =
                                m.trend === 'up' ? '▲' : m.trend === 'down' ? '▼' : '—';
                            return (
                                <div
                                    key={m.key}
                                    className="flex flex-col gap-0.5 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 shadow-sm"
                                >
                                    <span className="text-xs text-neutral-400">{m.label}</span>
                                    <span className="text-xl font-semibold text-neutral-800">{displayValue}</span>
                                    {m.trend && (
                                        <span className={cn('text-xs font-semibold', trendClass)}>
                                            {arrow} {m.change ?? ''}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </ProfileSectionCard>
            )}

            {/* Parent summary */}
            {data.parent_summary && (
                <ProfileSectionCard>
                    <div className="flex items-start gap-2 p-3 rounded-lg border-l-4 border-primary-500 bg-primary-50">
                        <Info size={16} className="text-primary-500 mt-0.5 shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-neutral-800 mb-1">
                                {t('adminReport.summaryForParentsHeading')}
                            </p>
                            <p className="text-sm text-neutral-700 leading-relaxed">{data.parent_summary}</p>
                        </div>
                    </div>
                </ProfileSectionCard>
            )}

            {/* Attendance */}
            {data.attendance?.available && (
                <ProfileSectionCard>
                    <AdminSectionHeading>{t('adminSections.attendance')}</AdminSectionHeading>
                    <div className="flex flex-wrap gap-6 items-center mb-4">
                        <div className="flex flex-col items-center gap-1">
                            <div className="relative size-16">
                                <svg viewBox="0 0 64 64" className="size-full -rotate-90">
                                    <circle cx="32" cy="32" r="27" fill="none" strokeWidth="6" className="stroke-neutral-100" />
                                    <circle
                                        cx="32"
                                        cy="32"
                                        r="27"
                                        fill="none"
                                        strokeWidth="6"
                                        strokeLinecap="round"
                                        strokeDasharray={`${(data.attendance.overall_percentage / 100) * 169.6} 169.6`}
                                        className={cn(
                                            data.attendance.overall_percentage >= 75
                                                ? 'stroke-success-500'
                                                : data.attendance.overall_percentage >= 50
                                                  ? 'stroke-warning-500'
                                                  : 'stroke-danger-500',
                                        )}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-neutral-800">
                                    {data.attendance.overall_percentage}%
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 flex-1 min-w-48">
                            {[
                                { label: t('common.stats.present'), value: data.attendance.present, cls: 'text-success-600' },
                                { label: t('common.stats.absent'), value: data.attendance.absent, cls: 'text-danger-600' },
                                { label: t('common.stats.late'), value: data.attendance.late, cls: 'text-warning-600' },
                            ].map((s) => (
                                <div key={s.label} className="flex flex-col items-center rounded-md bg-neutral-50 py-2">
                                    <span className={cn('text-xl font-semibold', s.cls)}>{s.value}</span>
                                    <span className="text-xs text-neutral-400">{s.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    {data.attendance.weekly && data.attendance.weekly.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-xs text-neutral-500 mb-2">{t('adminReport.weeklyTrend')}</p>
                            {data.attendance.weekly.map((w: V2AttendanceWeekly) => (
                                <div key={w.week} className="flex items-center gap-3">
                                    <span className="text-xs text-neutral-700 w-24 shrink-0">{w.week}</span>
                                    <Progress
                                        value={w.percentage}
                                        className={cn('h-2 flex-1 !bg-neutral-100', getAdminWeeklyBarClass(w.percentage))}
                                    />
                                    <span className="text-xs text-neutral-500 w-10 text-right">{w.percentage}%</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {data.attendance.note && (
                        <p className="text-xs text-neutral-500 mt-3 italic">{data.attendance.note}</p>
                    )}
                </ProfileSectionCard>
            )}

            {/* Academics */}
            {data.academics?.available && (
                <ProfileSectionCard>
                    <AdminSectionHeading>{t('adminSections.academicPerformance')}</AdminSectionHeading>
                    <p className="text-xs text-neutral-500 mb-3 -mt-2">
                        {t('adminReport.averagePrefix')}{' '}
                        <span className="font-semibold text-neutral-800">{data.academics.average_percentage}%</span>{' '}
                        {t('adminReport.vsClassAverage', { percentage: data.academics.class_average_percentage })}
                        {data.academics.best_subject && (
                            <>
                                {' '}
                                · {t('adminReport.bestSubjectLabel')}{' '}
                                <span className="text-success-600">{data.academics.best_subject}</span>
                            </>
                        )}
                        {data.academics.weakest_subject && (
                            <>
                                {' '}
                                · {t('adminReport.weakestSubjectLabel')}{' '}
                                <span className="text-danger-600">{data.academics.weakest_subject}</span>
                            </>
                        )}
                    </p>
                    {academicAssessments.length > 0 && (
                        <div className="mt-1 flex flex-col divide-y divide-border mb-4">
                            {academicAssessments.map((a: V2Assessment, i) => (
                                <div key={i} className="flex items-center justify-between gap-3 py-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-neutral-800">{a.name}</p>
                                        <p className="text-xs text-neutral-400">{a.subject} · {fmtDate(a.date)}</p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                                        <span className="text-sm font-semibold text-neutral-800">
                                            {a.marks}/{a.total_marks} · {a.percentage}%
                                        </span>
                                        <span className={cn(
                                            'text-xs rounded-full px-1.5 py-0.5 font-medium',
                                            a.status === 'NEEDS_WORK'
                                                ? 'bg-danger-50 text-danger-700'
                                                : 'bg-success-50 text-success-700',
                                        )}>
                                            {a.status === 'NEEDS_WORK' ? t('adminReport.needsWorkBadge') : a.grade}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {academicSubjectPerf.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-xs text-neutral-500 mb-2">
                                {t('adminReport.subjectPerformanceVsClass')}
                            </p>
                            {academicSubjectPerf.map((sp: V2SubjectPerformance) => (
                                <div key={sp.subject} className="flex items-center gap-3">
                                    <span className="text-xs font-medium text-neutral-700 w-20 shrink-0">{sp.subject}</span>
                                    <Progress
                                        value={sp.score_percentage}
                                        className={cn('h-2 flex-1 !bg-neutral-100', getAdminSubjectBarClass(sp.sentiment, sp.score_percentage))}
                                    />
                                    <span className="text-xs text-neutral-500 w-24 text-right">
                                        {sp.score_percentage}% · cls {sp.class_average}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </ProfileSectionCard>
            )}

            {/* Marks by Subject */}
            {data.subject_marks?.available && subjectMarksList.length > 0 && (
                <ProfileSectionCard>
                    <AdminSectionHeading>{t('adminSections.marksBySubject')}</AdminSectionHeading>
                    <p className="text-xs text-neutral-500 mb-3 -mt-2">
                        {t('adminReport.marksAggregationNote')}
                    </p>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                        {subjectMarksList.map((sm: V2SubjectMarksItem) => {
                            const pct = sm.percentage ?? 0;
                            return (
                                <div
                                    key={sm.subject}
                                    className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-3 shadow-sm"
                                >
                                    <div className="relative size-16">
                                        <svg viewBox="0 0 64 64" className="size-full -rotate-90">
                                            <circle cx="32" cy="32" r="27" fill="none" strokeWidth="6" className="stroke-neutral-100" />
                                            <circle
                                                cx="32"
                                                cy="32"
                                                r="27"
                                                fill="none"
                                                strokeWidth="6"
                                                strokeLinecap="round"
                                                strokeDasharray={`${(pct / 100) * 169.6} 169.6`}
                                                className={cn(
                                                    pct >= 75
                                                        ? 'stroke-success-500'
                                                        : pct >= 50
                                                          ? 'stroke-warning-500'
                                                          : 'stroke-danger-500',
                                                )}
                                            />
                                        </svg>
                                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                                            <span className="text-xs font-bold text-neutral-800">{pct}%</span>
                                        </div>
                                    </div>
                                    <div className="text-center">
                                        <p className="truncate text-sm font-medium text-neutral-800 max-w-24">{sm.subject}</p>
                                        <p className="text-xs text-neutral-400">
                                            {sm.marks_obtained}/{sm.total_marks}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </ProfileSectionCard>
            )}

            {/* Strengths + Areas to Improve */}
            {((data.strengths && data.strengths.length > 0) ||
                (data.areas_to_improve && data.areas_to_improve.length > 0)) && (
                <div className="grid gap-4 sm:grid-cols-2">
                    {data.strengths && data.strengths.length > 0 && (
                        <ProfileSectionCard heading={t('common.headings.strengths')}>
                            <div className="mt-1 flex flex-col gap-3">
                                {data.strengths.map((s: V2Strength) => (
                                    <div key={s.topic} className="flex flex-col gap-1">
                                        <div className="flex justify-between text-xs">
                                            <span className="font-medium text-neutral-700">{s.topic}</span>
                                            <span className="text-success-600">{s.confidence}</span>
                                        </div>
                                        <Progress
                                            value={s.confidence}
                                            className="h-1.5 !bg-neutral-100 [&>div]:bg-success-500"
                                        />
                                    </div>
                                ))}
                            </div>
                        </ProfileSectionCard>
                    )}
                    {data.areas_to_improve && data.areas_to_improve.length > 0 && (
                        <ProfileSectionCard heading={t('common.headings.areasToImprove')}>
                            <div className="mt-1 flex flex-col gap-3">
                                {data.areas_to_improve.map((s: V2Strength) => (
                                    <div key={s.topic} className="flex flex-col gap-1">
                                        <div className="flex justify-between text-xs">
                                            <span className="font-medium text-neutral-700">{s.topic}</span>
                                            <span className={s.confidence < 50 ? 'text-danger-600' : 'text-warning-600'}>
                                                {s.confidence}
                                            </span>
                                        </div>
                                        <Progress
                                            value={s.confidence}
                                            className={cn(
                                                'h-1.5 !bg-neutral-100',
                                                s.confidence < 50
                                                    ? '[&>div]:bg-danger-500'
                                                    : '[&>div]:bg-warning-500',
                                            )}
                                        />
                                    </div>
                                ))}
                            </div>
                        </ProfileSectionCard>
                    )}
                </div>
            )}

            {/* Study Habits */}
            {data.study_habits?.available && (
                <ProfileSectionCard>
                    <AdminSectionHeading>{t('adminSections.studyHabits')}</AdminSectionHeading>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
                        {[
                            { label: t('adminReport.studyHabitsStats.activeDays'), value: `${data.study_habits.active_days}/${data.study_habits.total_days}` },
                            { label: t('adminReport.studyHabitsStats.longestStreak'), value: `${data.study_habits.longest_streak_days}d` },
                            { label: t('adminReport.studyHabitsStats.focusScore'), value: data.study_habits.focus_score != null ? `${data.study_habits.focus_score}%` : '—' },
                            { label: t('adminReport.studyHabitsStats.mostActive'), value: data.study_habits.most_active_time ?? '—' },
                        ].map((s) => (
                            <div key={s.label} className="flex flex-col gap-0.5 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 shadow-sm">
                                <span className="text-xs text-neutral-400">{s.label}</span>
                                <span className="text-base font-semibold text-neutral-800">{s.value}</span>
                            </div>
                        ))}
                    </div>

                    {/* Daily study bar chart */}
                    {data.study_habits.daily_study_minutes && data.study_habits.daily_study_minutes.length > 0 && (() => {
                        const maxMin = Math.max(...data.study_habits!.daily_study_minutes.map((d: V2DailyStudyMinute) => d.minutes), 1);
                        return (
                            <>
                                <p className="text-xs text-neutral-500 mb-2">
                                    {t('adminReport.dailyStudyTimeDays', {
                                        count: data.study_habits!.daily_study_minutes.length,
                                    })}
                                </p>
                                <div
                                    className="flex items-end gap-px border-b border-neutral-200 mb-3"
                                    style={{ height: 80 }} /* design-lint-ignore: fixed chart canvas height */
                                >
                                    {data.study_habits!.daily_study_minutes.map((d: V2DailyStudyMinute, i: number) => {
                                        const pct = maxMin > 0 ? Math.round((d.minutes / maxMin) * 100) : 0;
                                        return (
                                            <div
                                                key={i}
                                                className="flex-1 bg-primary-50 rounded-t-sm relative"
                                                style={{ height: '100%' }} /* design-lint-ignore: chart column full height */
                                            >
                                                <div
                                                    className="absolute bottom-0 left-0 right-0 bg-primary-400 rounded-t-sm"
                                                    style={{ height: `${pct}%` }} /* design-lint-ignore: dynamic bar height */
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="flex justify-between text-xs text-neutral-400 mb-3">
                                    <span>{t('adminReport.dayLabel', { count: 1 })}</span>
                                    <span>
                                        {t('adminReport.dayLabel', {
                                            count: data.study_habits!.daily_study_minutes.length,
                                        })}
                                    </span>
                                </div>
                            </>
                        );
                    })()}

                    <p className="text-xs text-neutral-500">
                        {t('adminReport.contentExplored')}{' '}
                        <span className="font-semibold text-neutral-800">{data.study_habits.content_engagement?.videos_watched}</span>{' '}
                        {t('adminReport.videosWatched')} &middot;{' '}
                        <span className="font-semibold text-neutral-800">{data.study_habits.content_engagement?.documents_read}</span>{' '}
                        {t('adminReport.documentsRead')} &middot;{' '}
                        <span className="font-semibold text-neutral-800">{data.study_habits.content_engagement?.quizzes_attempted}</span>{' '}
                        {t('adminReport.quizzesAttempted')}
                    </p>
                </ProfileSectionCard>
            )}

            {/* Course Progress */}
            {data.course_progress?.available && (
                <ProfileSectionCard>
                    <AdminSectionHeading>
                        {t('adminSections.courseProgress', {
                            percentage: data.course_progress.overall_completion_percentage,
                        })}
                    </AdminSectionHeading>
                    <div className="space-y-2">
                        {courseProgressSubjects.map((s: V2CourseProgressSubject) => (
                            <div key={s.subject} className="flex items-center gap-3">
                                <span className="text-xs font-medium text-neutral-700 w-20 shrink-0">{s.subject}</span>
                                <Progress
                                    value={s.completion_percentage}
                                    className={cn('h-2 flex-1 !bg-neutral-100', getAdminSubjectBarClass(undefined, s.completion_percentage))}
                                />
                                <span className="text-xs text-neutral-500 w-20 text-right">
                                    {s.completion_percentage}% · {s.time_hours}h
                                </span>
                            </div>
                        ))}
                    </div>
                </ProfileSectionCard>
            )}

            {/* Live Classes + Assignments */}
            {(data.live_classes?.available || data.assignments?.available) && (
                <div className="grid gap-4 sm:grid-cols-2">
                    {data.live_classes?.available && (
                        <ProfileSectionCard heading={t('common.headings.liveClasses')} icon={Video as PhosphorIcon}>
                            <div className="mt-1 flex flex-col divide-y divide-border">
                                {[
                                    { label: t('adminReport.liveClassesStats.totalClasses'), value: data.live_classes.total ?? 0, cls: undefined },
                                    { label: t('adminReport.liveClassesStats.attended'), value: data.live_classes.attended ?? 0, cls: 'text-success-600' },
                                    { label: t('adminReport.liveClassesStats.missed'), value: data.live_classes.missed ?? 0, cls: 'text-danger-600' },
                                    { label: t('adminReport.liveClassesStats.notMarked'), value: data.live_classes.unmarked ?? 0, cls: 'text-neutral-500' },
                                    { label: t('adminReport.liveClassesStats.attendance'), value: data.live_classes.attendance_percentage != null ? `${data.live_classes.attendance_percentage}%` : '—', cls: undefined },
                                ].map(({ label, value, cls }) => (
                                    <div key={label} className="flex justify-between items-center py-1.5">
                                        <span className="text-xs text-neutral-500">{label}</span>
                                        <span className={cn('text-sm font-semibold', cls ?? 'text-neutral-800')}>{value}</span>
                                    </div>
                                ))}
                            </div>
                        </ProfileSectionCard>
                    )}
                    {data.assignments?.available && (
                        <ProfileSectionCard heading={t('common.headings.assignments')} icon={ClipboardText as PhosphorIcon}>
                            <div className="mt-1 flex flex-col divide-y divide-border">
                                {[
                                    { label: t('adminReport.assignmentsStats.assigned'), value: data.assignments.assigned ?? '—', cls: undefined },
                                    { label: t('adminReport.assignmentsStats.submitted'), value: data.assignments.submitted ?? 0, cls: 'text-success-600' },
                                    { label: t('adminReport.assignmentsStats.onTime'), value: data.assignments.on_time ?? '—', cls: undefined },
                                    { label: t('adminReport.assignmentsStats.late'), value: data.assignments.late ?? 0, cls: 'text-warning-600' },
                                    { label: t('adminReport.assignmentsStats.pending'), value: data.assignments.pending ?? '—', cls: 'text-danger-600' },
                                    { label: t('adminReport.assignmentsStats.avgScore'), value: data.assignments.avg_score_percentage != null ? `${data.assignments.avg_score_percentage}%` : '—', cls: undefined },
                                ].map(({ label, value, cls }) => (
                                    <div key={label} className="flex justify-between items-center py-1.5">
                                        <span className="text-xs text-neutral-500">{label}</span>
                                        <span className={cn('text-sm font-semibold', cls ?? 'text-neutral-800')}>{value}</span>
                                    </div>
                                ))}
                            </div>
                        </ProfileSectionCard>
                    )}
                </div>
            )}

            {/* Achievements */}
            {data.achievements && data.achievements.length > 0 && (
                <ProfileSectionCard heading={t('adminReport.achievementsHeading')} icon={Trophy as PhosphorIcon}>
                    <div className="mt-1 flex flex-wrap gap-2">
                        {data.achievements.map((a: V2Achievement, i) => (
                            <span
                                key={i}
                                className="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-3 py-1 text-xs font-semibold text-success-700 ring-1 ring-success-200"
                            >
                                <Trophy size={12} className="text-success-600 shrink-0" />
                                {a.title}
                                {a.issued_at && <span className="font-normal text-success-600">({fmtDate(a.issued_at)})</span>}
                            </span>
                        ))}
                    </div>
                </ProfileSectionCard>
            )}

            {/* AI Insights */}
            {data.ai_insights && (
                <>
                    {aiCrossDomainInsights.length > 0 && (
                        <ProfileSectionCard heading={t('adminReport.whatWeNoticedHeading')} icon={Lightbulb as PhosphorIcon}>
                            <ul className="mt-1 flex flex-col gap-2">
                                {aiCrossDomainInsights.map((insight, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
                                        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary-400" />
                                        {insight}
                                    </li>
                                ))}
                            </ul>
                        </ProfileSectionCard>
                    )}

                    {aiRecommendations.length > 0 && (
                        <ProfileSectionCard heading={t('adminReport.recommendedNextStepsHeading')}>
                            <div className="mt-1 flex flex-col gap-3">
                                {aiRecommendations.map((rec: V2Recommendation, i) => (
                                    <div
                                        key={i}
                                        className="flex items-start gap-3 rounded-md border border-border bg-neutral-50 p-3"
                                    >
                                        <span
                                            className={cn(
                                                'mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1',
                                                priorityTone(rec.priority),
                                            )}
                                        >
                                            {rec.priority}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-semibold text-neutral-600">{rec.area}</p>
                                            <p className="mt-0.5 text-sm text-neutral-700">{rec.suggestion}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ProfileSectionCard>
                    )}
                </>
            )}

            {/* Footer */}
            <div className="text-center text-xs text-neutral-400 py-2">
                {t('adminReport.footer', {
                    instituteName: institute.name,
                    date: fmtDate(meta.generated_at),
                    period: period.label,
                })}
            </div>
        </div>
    );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

interface ComprehensiveReportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    processId: string | null;
    report: ComprehensiveStudentReport | V2AdminReportData | null;
    /** Admin-supplied or auto-generated report name. Falls back to student + period if absent. */
    reportName?: string;
}

export const ComprehensiveReportDialog = ({
    open,
    onOpenChange,
    processId,
    report,
    reportName,
}: ComprehensiveReportDialogProps) => {
    const { t } = useTranslation('manageStudentsComprehensiveReportDialog');
    const [pdfLoading, setPdfLoading] = useState(false);
    const instituteLogo = useInstituteLogoStore((s) => s.instituteLogo);

    const handleDownloadPdf = async () => {
        if (!processId) return;
        setPdfLoading(true);
        try {
            await downloadReportPdf(processId);
        } catch {
            toast.error(t('dialog.toast.downloadFailed'));
        } finally {
            setPdfLoading(false);
        }
    };

    // Derive display name depending on shape
    const studentName = isV2AdminReport(report)
        ? (report as V2AdminReportData).student.name
        : (report as ComprehensiveStudentReport | null)?.student?.name ?? t('dialog.studentFallbackName');

    const periodLabel = isV2AdminReport(report)
        ? (report as V2AdminReportData).period.label
        : report
          ? `${fmtDate((report as ComprehensiveStudentReport).period.start_date_iso)} – ${fmtDate((report as ComprehensiveStudentReport).period.end_date_iso)}`
          : '';

    const dialogHeading = reportName
        ? t('dialog.headingWithName', { reportName, studentName })
        : periodLabel
          ? t('dialog.headingWithPeriod', { studentName, periodLabel })
          : t('dialog.headingDefault', { studentName });

    const headerActions = (
        <div className="flex items-center gap-2">
            <MyButton
                buttonType="secondary"
                scale="small"
                onClick={handleDownloadPdf}
                disabled={pdfLoading || !processId}
            >
                <DownloadSimple className="size-3.5" />
                {pdfLoading ? t('dialog.actions.downloading') : t('dialog.actions.downloadPdf')}
            </MyButton>
        </div>
    );

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={dialogHeading}
            dialogWidth="max-w-5xl"
            content={
                <div className="flex flex-col gap-4">
                    {/* Header action row */}
                    <div className="flex justify-end">{headerActions}</div>

                    {!report ? (
                        <ProfileSectionCard>
                            <p className="py-10 text-center text-sm text-neutral-500">
                                {t('dialog.reportNotAvailable')}
                            </p>
                        </ProfileSectionCard>
                    ) : isV2AdminReport(report) ? (
                        /* V2: unified parent-first "paper document" report */
                        <StudentReportCard data={report} fallbackLogoUrl={instituteLogo} />
                    ) : (
                        /* V1: 9-tab layout */
                        <Tabs defaultValue="overview" className="w-full">
                            <TabsList className="mb-4 flex h-auto w-full flex-wrap gap-1">
                                <TabsTrigger value="overview">{t('dialog.tabs.overview')}</TabsTrigger>
                                <TabsTrigger value="attendance">{t('dialog.tabs.attendance')}</TabsTrigger>
                                <TabsTrigger value="academics">{t('dialog.tabs.academics')}</TabsTrigger>
                                <TabsTrigger value="activity">{t('dialog.tabs.activity')}</TabsTrigger>
                                <TabsTrigger value="progress">{t('dialog.tabs.progress')}</TabsTrigger>
                                <TabsTrigger value="live-classes">{t('dialog.tabs.liveClasses')}</TabsTrigger>
                                <TabsTrigger value="certificates">{t('dialog.tabs.certificates')}</TabsTrigger>
                                <TabsTrigger value="assignments">{t('dialog.tabs.assignments')}</TabsTrigger>
                                <TabsTrigger value="insights">{t('dialog.tabs.insights')}</TabsTrigger>
                            </TabsList>

                            <TabsContent value="overview">
                                <OverviewTab report={report as ComprehensiveStudentReport} />
                            </TabsContent>
                            <TabsContent value="attendance">
                                <AttendanceTab report={report as ComprehensiveStudentReport} />
                            </TabsContent>
                            <TabsContent value="academics">
                                <AcademicsTab report={report as ComprehensiveStudentReport} />
                            </TabsContent>
                            <TabsContent value="activity">
                                <ActivityTab report={report as ComprehensiveStudentReport} />
                            </TabsContent>
                            <TabsContent value="progress">
                                <ProgressTab report={report as ComprehensiveStudentReport} />
                            </TabsContent>
                            <TabsContent value="live-classes">
                                <LiveClassesTab report={report as ComprehensiveStudentReport} />
                            </TabsContent>
                            <TabsContent value="certificates">
                                <CertificatesTab report={report as ComprehensiveStudentReport} />
                            </TabsContent>
                            <TabsContent value="assignments">
                                <AssignmentsTab report={report as ComprehensiveStudentReport} />
                            </TabsContent>
                            <TabsContent value="insights">
                                <InsightsTab report={report as ComprehensiveStudentReport} />
                            </TabsContent>
                        </Tabs>
                    )}
                </div>
            }
            footer={
                <MyButton buttonType="secondary" onClick={() => onOpenChange(false)}>
                    <X className="size-3.5" />
                    {t('dialog.actions.close')}
                </MyButton>
            }
        />
    );
};
