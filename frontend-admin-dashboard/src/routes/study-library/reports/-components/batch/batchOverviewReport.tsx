import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Books, Brain, Clock, Exam, UsersThree, WarningCircle } from '@phosphor-icons/react';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    DEFAULT_TIMELINE,
    ReportTimelineFilter,
    resolveTimeline,
    type TimelineValue,
} from '@/components/common/report-timeline-filter';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { ReportBlock, ReportHero, StatTile } from '@/components/common/report-visuals/blocks';
import {
    DonutChart,
    HorizontalBars,
    ScoreHistogram,
    toHistogram,
} from '@/components/common/report-visuals/charts';
import {
    ClassIllustration,
    EmptyReportIllustration,
} from '@/components/common/report-visuals/illustrations';
import {
    REPORT_COLORS,
    minutesLabel,
    pct,
    scoreColor,
    useBrandColor,
} from '@/components/common/report-visuals/palette';
import {
    getBatchSummaryReportQuery,
    type BatchSummaryReport,
    type BatchSummaryRequest,
} from '@/services/batch-summary-report';
import { useBatchOptions } from '../batchMultiSelect';
import { GenerateBatchReportDialog } from './generateBatchReportDialog';

const headlineFor = (r: BatchSummaryReport) => {
    if (r.enrolled_learners === 0) return 'No learners in this batch yet';
    if (r.learners_attempted === 0) return 'No quiz attempts yet';
    return `${r.passed_learners} of ${r.enrolled_learners} learners passed`;
};

const BatchOverviewBody = ({ data, brand }: { data: BatchSummaryReport; brand: string }) => {
    const scored = useMemo(
        () => data.learners.filter((l) => l.avg_score_percent != null),
        [data]
    );
    const histogram = useMemo(() => toHistogram(scored.map((l) => l.avg_score_percent)), [scored]);
    const needsAttention = useMemo(
        () =>
            data.learners
                .filter((l) => l.status !== 'PASSED')
                .sort((a, b) => {
                    if (a.status !== b.status) return a.status === 'FAILED' ? -1 : 1;
                    return (a.avg_score_percent ?? 0) - (b.avg_score_percent ?? 0);
                })
                .slice(0, 6),
        [data]
    );
    const topScorers = scored.slice(0, 8);
    const maxTime = Math.max(1, ...data.activity.map((a) => a.total_time_minutes ?? 0));

    return (
        <div className="flex flex-col gap-4">
            <ReportHero
                brand={brand}
                kicker={data.batch_name ?? 'Batch report'}
                headline={headlineFor(data)}
                subline={
                    data.avg_quiz_score != null
                        ? `Average quiz score ${pct(data.avg_quiz_score)} across ${data.quizzes_in_course} quiz${data.quizzes_in_course === 1 ? '' : 'zes'}.`
                        : undefined
                }
                bigValue={data.pass_rate != null ? `${Math.round(data.pass_rate)}` : '—'}
                bigSuffix={data.pass_rate != null ? '%' : undefined}
                bigCaption="passed"
                illustration={<ClassIllustration brand={brand} className="h-auto w-full" />}
                track={
                    data.avg_course_completion != null
                        ? {
                              value: data.avg_course_completion,
                              left: (
                                  <>
                                      Course completion <b>{pct(data.avg_course_completion)}</b>
                                  </>
                              ),
                          }
                        : null
                }
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <StatTile
                    value={data.enrolled_learners}
                    label="Learners"
                    icon={<UsersThree className="size-3.5" />}
                />
                <StatTile
                    value={pct(data.avg_quiz_score)}
                    label="Avg quiz score"
                    color={scoreColor(data.avg_quiz_score)}
                    icon={<Exam className="size-3.5" />}
                />
                <StatTile
                    value={pct(data.avg_course_completion)}
                    label="Course completion"
                    color={brand}
                    icon={<Books className="size-3.5" />}
                />
                <StatTile
                    value={minutesLabel(data.avg_time_spent_minutes)}
                    label="Avg time per learner"
                    icon={<Clock className="size-3.5" />}
                />
                <StatTile
                    value={pct(data.avg_concentration)}
                    label="Concentration"
                    icon={<Brain className="size-3.5" />}
                />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ReportBlock
                    brand={brand}
                    tag="Results"
                    title={
                        data.enrolled_learners > 0
                            ? `${pct(data.pass_rate)} passed, ${data.not_attempted_learners} yet to attempt`
                            : 'No learners yet'
                    }
                >
                    <DonutChart
                        data={[
                            { label: 'Passed', value: data.passed_learners, color: REPORT_COLORS.good },
                            { label: 'Failed', value: data.failed_learners, color: REPORT_COLORS.bad },
                            {
                                label: 'Not attempted',
                                value: data.not_attempted_learners,
                                color: REPORT_COLORS.neutral,
                            },
                        ]}
                        centerValue={pct(data.pass_rate)}
                        centerLabel="passed"
                        size={170}
                    />
                </ReportBlock>

                <ReportBlock
                    brand={brand}
                    tag="Where learners stand"
                    title={
                        scored.length > 0
                            ? `${histogram.filter((b) => b.from >= 60).reduce((s, b) => s + b.count, 0)} of ${scored.length} scored 60% or more`
                            : 'No quiz scores yet'
                    }
                    lede="How many learners have an average quiz score in each range."
                >
                    {scored.length > 0 ? (
                        <ScoreHistogram data={histogram} height={200} />
                    ) : (
                        <EmptyReportIllustration brand={brand} className="mx-auto w-36" />
                    )}
                </ReportBlock>

                <ReportBlock
                    brand={brand}
                    tag="Subject progress"
                    title={
                        data.subjects.length > 0
                            ? `Furthest along in ${[...data.subjects].sort((a, b) => (b.avg_completion ?? 0) - (a.avg_completion ?? 0))[0]?.subject_name}`
                            : 'No subject progress yet'
                    }
                    lede="Average completion and time per learner in each subject."
                >
                    {data.subjects.length > 0 ? (
                        <HorizontalBars
                            color={brand}
                            rows={data.subjects.map((s) => ({
                                key: s.subject_name,
                                label: s.subject_name,
                                value: s.avg_completion,
                                display: pct(s.avg_completion),
                                sub: minutesLabel(s.avg_time_minutes),
                            }))}
                        />
                    ) : (
                        <p className="text-sm text-neutral-500">Nothing completed yet.</p>
                    )}
                </ReportBlock>

                <ReportBlock
                    brand={brand}
                    tag="Top scorers"
                    title={
                        topScorers[0]
                            ? `${topScorers[0].full_name} leads with ${pct(topScorers[0].avg_score_percent)}`
                            : 'No quiz scores yet'
                    }
                    lede="Highest average quiz scores."
                >
                    {topScorers.length > 0 ? (
                        <HorizontalBars
                            color={brand}
                            marker={
                                data.avg_quiz_score != null
                                    ? { value: data.avg_quiz_score, label: 'Batch average' }
                                    : null
                            }
                            rows={topScorers.map((l) => ({
                                key: l.user_id,
                                label: l.full_name,
                                value: l.avg_score_percent,
                                display: pct(l.avg_score_percent),
                                color: scoreColor(l.avg_score_percent),
                            }))}
                        />
                    ) : (
                        <p className="text-sm text-neutral-500">Nobody has attempted a quiz.</p>
                    )}
                </ReportBlock>

                <ReportBlock
                    brand={brand}
                    tag="Most active"
                    title={
                        data.activity[0]
                            ? `${data.activity[0].full_name} spent the most time learning`
                            : 'No learning activity in these dates'
                    }
                    lede="Time spent learning in the selected dates."
                >
                    {data.activity.length > 0 ? (
                        <HorizontalBars
                            color={brand}
                            max={maxTime}
                            rows={data.activity.map((a) => ({
                                key: a.user_id,
                                label: a.full_name,
                                value: a.total_time_minutes,
                                display: minutesLabel(a.total_time_minutes),
                                sub:
                                    a.avg_concentration != null
                                        ? `${Math.round(a.avg_concentration)}% focus`
                                        : undefined,
                            }))}
                        />
                    ) : (
                        <p className="text-sm text-neutral-500">No activity recorded.</p>
                    )}
                </ReportBlock>

                <ReportBlock
                    brand={brand}
                    tag="Needs attention"
                    title={
                        needsAttention.length > 0
                            ? `${data.failed_learners + data.not_attempted_learners} learners need a nudge`
                            : 'Everyone is on track'
                    }
                    lede="Below the pass mark first, then learners yet to attempt a quiz."
                >
                    {needsAttention.length === 0 ? (
                        <p className="text-sm text-neutral-500">Nobody to follow up with.</p>
                    ) : (
                        <ul className="flex flex-col divide-y divide-neutral-100">
                            {needsAttention.map((l) => (
                                <li key={l.user_id} className="flex items-center gap-2 py-2 text-sm">
                                    <WarningCircle
                                        className="size-4 shrink-0"
                                        weight="fill"
                                        style={{
                                            color:
                                                l.status === 'FAILED'
                                                    ? REPORT_COLORS.bad
                                                    : REPORT_COLORS.neutral,
                                        }}
                                    />
                                    <span className="truncate text-neutral-700">{l.full_name}</span>
                                    <span
                                        className="ml-auto shrink-0 text-xs font-semibold"
                                        style={{
                                            color:
                                                l.status === 'FAILED'
                                                    ? REPORT_COLORS.bad
                                                    : REPORT_COLORS.muted,
                                        }}
                                    >
                                        {l.status === 'FAILED'
                                            ? pct(l.avg_score_percent)
                                            : 'Not attempted'}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </ReportBlock>
            </div>
        </div>
    );
};

export default function BatchOverviewReport({
    fixedPackageSessionId,
}: {
    /** Course Details → Reports: the batch is implied by the page. */
    fixedPackageSessionId?: string;
}) {
    const batchOptions = useBatchOptions();
    const brand = useBrandColor();
    const [picked, setPicked] = useState<string>('');
    const [timeline, setTimeline] = useState<TimelineValue>(DEFAULT_TIMELINE);
    const range = resolveTimeline(timeline);
    const batchId = fixedPackageSessionId ?? picked;
    const batchLabel = batchOptions.find((b) => b.value === batchId)?.label;
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    const request: BatchSummaryRequest | null = useMemo(
        () =>
            batchId && range
                ? {
                      package_session_id: batchId,
                      batch_name: batchLabel,
                      start_date: range.start,
                      end_date: range.end,
                  }
                : null,
        [batchId, batchLabel, range?.start, range?.end]
    );

    const { data, isLoading, isError } = useQuery({
        ...getBatchSummaryReportQuery(
            request ?? { package_session_id: '', start_date: '', end_date: '' }
        ),
    });

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 md:flex-row md:items-end">
                {!fixedPackageSessionId && (
                    <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-600">
                        {batchTerm}
                        <Select value={picked} onValueChange={setPicked}>
                            <SelectTrigger className="h-9 w-full text-sm">
                                <SelectValue placeholder={`Select a ${batchTerm.toLowerCase()}`} />
                            </SelectTrigger>
                            <SelectContent>
                                {batchOptions.map((b) => (
                                    <SelectItem key={b.value} value={b.value}>
                                        {b.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>
                )}
                <div className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-600">
                    Timeline
                    <ReportTimelineFilter value={timeline} onChange={setTimeline} />
                </div>
                <div className="md:ml-auto">
                    <GenerateBatchReportDialog request={request} disabled={!data} />
                </div>
            </div>

            {!batchId ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <ClassIllustration brand={brand} className="w-44" />
                    <span className="text-sm text-neutral-500">
                        Select a {batchTerm.toLowerCase()} to see its report.
                    </span>
                </div>
            ) : !range ? (
                <p className="py-10 text-center text-sm text-neutral-500">
                    Pick a start and end date.
                </p>
            ) : isLoading ? (
                <DashboardLoader />
            ) : isError || !data ? (
                <p className="py-10 text-center text-sm text-danger-600">
                    Couldn&apos;t load this report.
                </p>
            ) : (
                <BatchOverviewBody data={data} brand={brand} />
            )}
        </div>
    );
}
