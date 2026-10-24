import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { format, parse } from 'date-fns';
import { ChartLineUp, DownloadSimple, FilePdf, WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { getInstituteId } from '@/constants/helper';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { SendMessageDialog } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/bulk-actions/send-message-dialog';
import { SendEmailDialog } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/bulk-actions/send-email-dialog';
import type { MultiSelectOption } from '../../feedback/-components/multi-select-popover';
import { buildCsv, downloadCsv } from '../../feedback/-utils/csv';
import {
    useLiveClassDashboard,
    type DashboardClassRow,
    type LiveClassDashboardParams,
} from '../../-services/live-class-dashboard';
import { useLiveClassDashboardStore } from '../../-store/useLiveClassDashboardStore';
import {
    PRINT_HIDE_ATTR,
    exportFileName,
    printElement,
    toDashboardUrl,
} from '../../-utils/dashboard-export';
import { platformLabelKey } from '../../-utils/dashboard-format';
import { DashboardFilters } from './dashboard-filters';
import { DashboardKpis, DashboardKpisSkeleton } from './dashboard-kpis';
import {
    AttendanceDonut,
    EngagementCard,
    PlatformCard,
    RatingCard,
    ScheduleHeatmap,
    TrendCard,
} from './dashboard-charts';
import { BatchAttendanceCard, InsightsStrip, TeacherLeaderboard } from './dashboard-highlights';
import { AtRiskCard, FeedbackWall } from './dashboard-followup';
import { ClassDetailSheet } from './class-detail-sheet';
import { LiveNowPanel } from './live-now-panel';
import { ClassesTable, instructorLabel, instructorNames } from './dashboard-tables';

const stripDefault = (s: string) => s.replace(/^default\s+/i, '');

const toDate = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = parse(iso, 'yyyy-MM-dd', new Date());
    return Number.isNaN(d.getTime()) ? null : d;
};

/** "21 – 27 Sep 2026", "28 Sep – 4 Oct 2026", "27 Sep 2026". */
const formatRange = (startIso: string | null | undefined, endIso: string | null | undefined) => {
    const start = toDate(startIso);
    const end = toDate(endIso);
    if (!start || !end) return '';
    if (start.getTime() === end.getTime()) return format(end, 'dd MMM yyyy');
    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = sameYear && start.getMonth() === end.getMonth();
    const left = format(start, sameMonth ? 'dd' : sameYear ? 'dd MMM' : 'dd MMM yyyy');
    return `${left} – ${format(end, 'dd MMM yyyy')}`;
};

const printHide = { [PRINT_HIDE_ATTR]: '' };

/**
 * Live-session "Dashboard" tab: what is live now, and how the classes in a date
 * range went — attendance, time in class, engagement, feedback — broken down by
 * teacher, batch and platform, with drill-down, follow-up and export.
 */
export default function LiveClassDashboard() {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const navigate = useNavigate();
    const instituteId = getInstituteId() ?? '';
    const { instituteDetails } = useInstituteDetailsStore();
    const rootRef = useRef<HTMLDivElement>(null);
    const [selected, setSelected] = useState<DashboardClassRow | null>(null);

    const startDate = useLiveClassDashboardStore((s) => s.startDate);
    const endDate = useLiveClassDashboardStore((s) => s.endDate);
    const batchIds = useLiveClassDashboardStore((s) => s.batchIds);
    const teacherIds = useLiveClassDashboardStore((s) => s.teacherIds);
    const setRange = useLiveClassDashboardStore((s) => s.setRange);
    const setBatchIds = useLiveClassDashboardStore((s) => s.setBatchIds);
    const setTeacherIds = useLiveClassDashboardStore((s) => s.setTeacherIds);

    const classesTerm = getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession);
    const batchesTerm = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
    const teachersTerm = getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher);
    const pageTitle = t('hero.title', {
        term: getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession),
    });

    // Keep the filters in the URL so a refresh or a bookmark reopens the same view.
    useEffect(() => {
        navigate({
            to: '/study-library/live-session/dashboard',
            search: toDashboardUrl({ startDate, endDate, batchIds, teacherIds }),
            replace: true,
        });
    }, [navigate, startDate, endDate, batchIds, teacherIds]);

    const batchOptions: MultiSelectOption[] = useMemo(
        () =>
            instituteDetails?.batches_for_sessions?.map((batch) => ({
                value: batch.id,
                label:
                    batch.level.id === 'DEFAULT'
                        ? `${stripDefault(batch.package_dto.package_name)}, ${batch.session.session_name}`.trim()
                        : `${stripDefault(batch.level.level_name)} ${stripDefault(batch.package_dto.package_name)}, ${batch.session.session_name}`.trim(),
            })) ?? [],
        [instituteDetails?.batches_for_sessions]
    );
    const batchLabelMap = useMemo(
        () => new Map(batchOptions.map((o) => [o.value, o.label])),
        [batchOptions]
    );
    const batchLabel = useCallback(
        (id: string) => batchLabelMap.get(id) ?? t('batches.unknown'),
        [batchLabelMap, t]
    );

    const params: LiveClassDashboardParams = useMemo(
        () => ({ instituteId, startDate, endDate, batchIds, instructorIds: teacherIds }),
        [instituteId, startDate, endDate, batchIds, teacherIds]
    );
    const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } =
        useLiveClassDashboard(params);

    // Options come from the whole range before the teacher filter, and the
    // previous result stays in place while a filter change loads. A picked
    // teacher with no class in the new range stays listed so it can be unticked.
    const teacherOptions: MultiSelectOption[] = useMemo(() => {
        const opts = (data?.instructor_options ?? []).map((ref) => ({
            value: ref.user_id,
            label: instructorLabel(ref),
        }));
        const known = new Set(opts.map((o) => o.value));
        teacherIds
            .filter((id) => !known.has(id))
            .forEach((id) => opts.push({ value: id, label: id }));
        return opts;
    }, [data?.instructor_options, teacherIds]);

    const openFullPage = useCallback(
        (row: { session_id: string }) =>
            navigate({
                to: '/study-library/live-session/view/$sessionId',
                params: { sessionId: row.session_id },
            }),
        [navigate]
    );
    const openClass = useCallback((row: DashboardClassRow) => setSelected(row), []);
    const openClassById = useCallback(
        (scheduleId: string, sessionId: string) => {
            const row = data?.classes.find((c) => c.schedule_id === scheduleId);
            if (row) setSelected(row);
            else openFullPage({ session_id: sessionId });
        },
        [data?.classes, openFullPage]
    );

    const exportClasses = () => {
        if (!data) return;
        const csv = buildCsv(
            [
                t('csv.date'),
                t('csv.start'),
                t('csv.end'),
                t('csv.class'),
                t('csv.subject'),
                t('csv.teachers'),
                t('csv.batches'),
                t('csv.platform'),
                t('csv.status'),
                t('csv.expected'),
                t('csv.joined'),
                t('csv.present'),
                t('csv.attendance'),
                t('csv.avgMinutes'),
                t('csv.scheduledMinutes'),
                t('csv.engagement'),
                t('csv.feedbackCount'),
                t('csv.rating'),
            ],
            data.classes.map((c) => [
                c.meeting_date,
                c.start_time?.slice(0, 5),
                c.end_time?.slice(0, 5),
                c.title,
                c.subject,
                instructorNames(c.instructors),
                c.batch_ids.map(batchLabel).join(' | '),
                t(`platforms.names.${platformLabelKey(c.platform)}`),
                t(`status.${c.status}`),
                c.expected,
                c.joined,
                c.present,
                c.attendance_rate !== null ? Math.round(c.attendance_rate * 100) : '',
                c.avg_attended_minutes ?? '',
                c.scheduled_minutes ?? '',
                c.engagement_rate !== null ? Math.round(c.engagement_rate * 100) : '',
                c.feedback_count,
                c.avg_rating ?? '',
            ])
        );
        downloadCsv(exportFileName('live-classes', startDate, endDate), csv);
    };

    const downloadPdf = () => {
        if (rootRef.current) {
            printElement(rootRef.current, `${pageTitle} ${formatRange(startDate, endDate)}`);
        }
    };

    const filters = (
        <div {...printHide}>
            <DashboardFilters
                startDate={startDate}
                endDate={endDate}
                onRangeChange={setRange}
                batchOptions={batchOptions}
                selectedBatchIds={batchIds}
                onBatchChange={setBatchIds}
                teacherOptions={teacherOptions}
                selectedTeacherIds={teacherIds}
                onTeacherChange={setTeacherIds}
                batchesTerm={batchesTerm}
                teachersTerm={teachersTerm}
                isFetching={isFetching}
                onRefresh={() => refetch()}
            />
        </div>
    );

    const compareLabel = data?.previous_summary
        ? formatRange(data.previous_start_date, data.previous_end_date)
        : null;

    // Header band: what this is, which dates, compared with what, actions and filters.
    const hero = (
        <section className="flex flex-col gap-5 rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50 via-white to-info-50 p-4 shadow-sm sm:p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-primary-600">
                        <ChartLineUp size={14} weight="bold" />
                        {t('hero.eyebrow')}
                    </span>
                    <h2 className="text-h2-semibold text-neutral-900">{pageTitle}</h2>
                    <p className="text-body text-neutral-600">
                        {formatRange(startDate, endDate)}
                        {compareLabel ? (
                            <span className="text-neutral-400">
                                {' · '}
                                {t('hero.compared', { range: compareLabel })}
                            </span>
                        ) : null}
                    </p>
                </div>
                <div className="flex flex-col items-start gap-2 lg:items-end">
                    {dataUpdatedAt ? (
                        <span className="flex shrink-0 items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-caption text-neutral-600 shadow-sm">
                            <span className="size-2 rounded-full bg-success-500" aria-hidden />
                            {t('filters.updatedAt', { time: format(dataUpdatedAt, 'h:mm a') })}
                        </span>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2" {...printHide}>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className="gap-1.5 bg-white sm:min-w-0"
                            onClick={exportClasses}
                            disabled={!data || data.classes.length === 0}
                        >
                            <DownloadSimple size={16} />
                            {t('share.csv')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className="gap-1.5 bg-white sm:min-w-0"
                            onClick={downloadPdf}
                            disabled={!data}
                        >
                            <FilePdf size={16} />
                            {t('share.pdf')}
                        </MyButton>
                    </div>
                </div>
            </div>
            {filters}
        </section>
    );

    if (isLoading && !data) {
        return (
            <div className="flex flex-col gap-6">
                {hero}
                <DashboardKpisSkeleton />
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <Skeleton className="h-80 rounded-xl xl:col-span-2" />
                    <Skeleton className="h-80 rounded-xl" />
                </div>
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="flex flex-col gap-6">
                {hero}
                <Alert
                    variant="destructive"
                    className="flex flex-col gap-3 sm:flex-row sm:items-center"
                >
                    <WarningCircle size={20} className="shrink-0" />
                    <div className="flex-1">
                        <AlertTitle>{t('error.title')}</AlertTitle>
                        <AlertDescription>{t('error.body')}</AlertDescription>
                    </div>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => refetch()}
                    >
                        {t('error.retry')}
                    </MyButton>
                </Alert>
            </div>
        );
    }

    if (!data) return <div className="flex flex-col gap-6">{hero}</div>;

    return (
        <div ref={rootRef} className="flex flex-col gap-6">
            {hero}

            <LiveNowPanel classes={data.live_now} classesTerm={classesTerm} onOpen={openClass} />

            <DashboardKpis
                summary={data.summary}
                previous={data.previous_summary}
                compareLabel={compareLabel}
                daily={data.daily}
                classesTerm={classesTerm}
            />

            <InsightsStrip
                classes={data.classes}
                instructors={data.instructors}
                daily={data.daily}
                classesTerm={classesTerm}
                onOpen={openClass}
            />

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <TrendCard daily={data.daily} classesTerm={classesTerm} />
                <AttendanceDonut summary={data.summary} />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <ScheduleHeatmap classes={data.classes} classesTerm={classesTerm} />
                <EngagementCard summary={data.summary} />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <TeacherLeaderboard
                    instructors={data.instructors}
                    teachersTerm={teachersTerm}
                    classesTerm={classesTerm}
                />
                <BatchAttendanceCard
                    batches={data.batches}
                    batchLabel={batchLabel}
                    batchesTerm={batchesTerm}
                    classesTerm={classesTerm}
                />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <AtRiskCard params={params} batchLabel={batchLabel} classesTerm={classesTerm} />
                <div className="flex flex-col gap-4">
                    <RatingCard distribution={data.rating_distribution} summary={data.summary} />
                    <PlatformCard platforms={data.platforms} classesTerm={classesTerm} />
                </div>
            </div>

            <FeedbackWall params={params} classesTerm={classesTerm} onOpenClass={openClassById} />

            <ClassesTable
                classes={data.classes}
                truncated={data.classes_truncated}
                limit={data.classes_limit}
                batchLabel={batchLabel}
                classesTerm={classesTerm}
                batchesTerm={batchesTerm}
                teachersTerm={teachersTerm}
                onOpen={openClass}
            />

            <ClassDetailSheet
                key={selected?.schedule_id ?? 'none'}
                row={selected}
                onClose={() => setSelected(null)}
                batchIds={batchIds}
                batchLabel={batchLabel}
                onOpenFullPage={openFullPage}
            />
            <SendMessageDialog />
            <SendEmailDialog />
        </div>
    );
}
