import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { format, parse } from 'date-fns';
import { ArrowSquareOut, WarningCircle } from '@phosphor-icons/react';
import { MultiSelect } from '@/components/design-system/multi-select';
import { MyButton } from '@/components/design-system/button';
import {
    ReportTimelineFilter,
    resolveTimeline,
    type TimelineValue,
} from '@/components/common/report-timeline-filter';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { getInstituteId } from '@/constants/helper';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { SendMessageDialog } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/bulk-actions/send-message-dialog';
import { SendEmailDialog } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/bulk-actions/send-email-dialog';
import {
    useLiveClassDashboard,
    type DashboardClassRow,
    type LiveClassDashboardParams,
} from '@/routes/study-library/live-session/-services/live-class-dashboard';
import {
    DashboardKpis,
    DashboardKpisSkeleton,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-kpis';
import {
    AttendanceDonut,
    EngagementCard,
    RatingCard,
    TrendCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import {
    BatchAttendanceCard,
    TeacherLeaderboard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-highlights';
import { AtRiskCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-followup';
import { ClassesTable } from '@/routes/study-library/live-session/-components/dashboard/dashboard-tables';
import { ClassDetailSheet } from '@/routes/study-library/live-session/-components/dashboard/class-detail-sheet';
import { toDashboardUrl } from '@/routes/study-library/live-session/-utils/dashboard-export';
import { useBatchOptions } from '../batchMultiSelect';

const DEFAULT_LIVE_TIMELINE: TimelineValue = { preset: 'LAST_30_DAYS' };

const formatRange = (start?: string | null, end?: string | null) => {
    if (!start || !end) return null;
    const s = parse(start, 'yyyy-MM-dd', new Date());
    const e = parse(end, 'yyyy-MM-dd', new Date());
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
    return `${format(s, 'dd MMM yyyy')} – ${format(e, 'dd MMM yyyy')}`;
};

/**
 * Learning Reports → Live sessions: attendance, time in class, engagement, feedback and the
 * learners slipping away for the picked batches and dates. Same data as the Live Session
 * dashboard, so the two never disagree.
 */
export default function BatchLiveSessions({
    fixedPackageSessionId,
}: {
    /** Course Details → Reports: the batch is implied by the page. */
    fixedPackageSessionId?: string;
}) {
    const navigate = useNavigate();
    const instituteId = getInstituteId() ?? '';
    const batchOptions = useBatchOptions();
    const [picked, setPicked] = useState<string[]>([]);
    const [timeline, setTimeline] = useState<TimelineValue>(DEFAULT_LIVE_TIMELINE);
    const [selected, setSelected] = useState<DashboardClassRow | null>(null);
    const range = resolveTimeline(timeline);

    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const batchesTerm = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
    const classesTerm = getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession);
    const teachersTerm = getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher);

    const batchLabels = useMemo(
        () => new Map(batchOptions.map((b) => [b.value, b.label])),
        [batchOptions]
    );
    const batchLabel = useCallback(
        (id: string) => batchLabels.get(id) ?? batchTerm,
        [batchLabels, batchTerm]
    );

    const batchIds = useMemo(
        () => (fixedPackageSessionId ? [fixedPackageSessionId] : [...picked].sort()),
        [fixedPackageSessionId, picked]
    );
    const params: LiveClassDashboardParams = useMemo(
        () => ({
            instituteId,
            startDate: range?.start ?? '',
            endDate: range?.end ?? '',
            batchIds,
            instructorIds: [],
        }),
        [instituteId, range?.start, range?.end, batchIds]
    );
    const { data, isLoading, error, refetch } = useLiveClassDashboard(params);

    const openFullPage = useCallback(
        (row: { session_id: string }) =>
            navigate({
                to: '/study-library/live-session/view/$sessionId',
                params: { sessionId: row.session_id },
            }),
        [navigate]
    );

    const compareLabel = data?.previous_summary
        ? formatRange(data.previous_start_date, data.previous_end_date)
        : null;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 md:flex-row md:items-end">
                {!fixedPackageSessionId && (
                    <div className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-600">
                        {batchTerm}
                        <MultiSelect
                            options={batchOptions}
                            selected={picked}
                            onChange={setPicked}
                            checkboxes
                            placeholder={`All ${batchesTerm.toLowerCase()}`}
                            className="h-auto min-h-9 py-1 text-sm"
                        />
                    </div>
                )}
                <div className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-600">
                    Timeline
                    <ReportTimelineFilter value={timeline} onChange={setTimeline} />
                </div>
                <Link
                    to="/study-library/live-session/dashboard"
                    search={toDashboardUrl({
                        startDate: params.startDate,
                        endDate: params.endDate,
                        batchIds,
                        teacherIds: [],
                    })}
                    className="flex shrink-0 items-center gap-1 self-start text-xs font-medium text-primary-600 hover:underline md:self-end md:pb-2"
                >
                    Full dashboard
                    <ArrowSquareOut className="size-3.5" />
                </Link>
            </div>

            {!range ? null : isLoading && !data ? (
                <div className="flex flex-col gap-4">
                    <DashboardKpisSkeleton />
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                        <Skeleton className="h-80 rounded-xl xl:col-span-2" />
                        <Skeleton className="h-80 rounded-xl" />
                    </div>
                </div>
            ) : error && !data ? (
                <Alert variant="destructive" className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <WarningCircle size={20} className="shrink-0" />
                    <div className="flex-1">
                        <AlertTitle>Couldn&apos;t load {classesTerm.toLowerCase()}</AlertTitle>
                        <AlertDescription>Try again in a moment.</AlertDescription>
                    </div>
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => refetch()}>
                        Try again
                    </MyButton>
                </Alert>
            ) : data ? (
                <>
                    <DashboardKpis
                        summary={data.summary}
                        previous={data.previous_summary}
                        compareLabel={compareLabel}
                        daily={data.daily}
                        classesTerm={classesTerm}
                    />
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                        <TrendCard daily={data.daily} classesTerm={classesTerm} />
                        <AttendanceDonut summary={data.summary} />
                    </div>
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <EngagementCard summary={data.summary} />
                        <RatingCard distribution={data.rating_distribution} summary={data.summary} />
                    </div>
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <TeacherLeaderboard
                            instructors={data.instructors}
                            teachersTerm={teachersTerm}
                            classesTerm={classesTerm}
                        />
                        {batchIds.length === 1 ? (
                            <AtRiskCard params={params} batchLabel={batchLabel} classesTerm={classesTerm} />
                        ) : (
                            <BatchAttendanceCard
                                batches={data.batches}
                                batchLabel={batchLabel}
                                batchesTerm={batchesTerm}
                                classesTerm={classesTerm}
                            />
                        )}
                    </div>
                    {batchIds.length !== 1 && (
                        <AtRiskCard params={params} batchLabel={batchLabel} classesTerm={classesTerm} />
                    )}
                    <ClassesTable
                        classes={data.classes}
                        truncated={data.classes_truncated}
                        limit={data.classes_limit}
                        batchLabel={batchLabel}
                        classesTerm={classesTerm}
                        batchesTerm={batchesTerm}
                        teachersTerm={teachersTerm}
                        onOpen={setSelected}
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
                </>
            ) : null}
        </div>
    );
}
