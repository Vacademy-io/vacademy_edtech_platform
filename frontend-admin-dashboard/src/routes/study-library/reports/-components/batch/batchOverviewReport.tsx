import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    ArrowDown,
    ArrowUp,
    Books,
    ChartLineUp,
    Exam,
    UsersThree,
    WarningCircle,
} from '@phosphor-icons/react';
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
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    ReportBlock,
    ReportHero,
    StatTile,
    TopicColumn,
} from '@/components/common/report-visuals/blocks';
import {
    CompareBarChart,
    DonutChart,
    HorizontalBars,
    ScoreHistogram,
    TopicRadar,
    TrendChart,
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

const ALL = '__all__';
const STRONG_FROM = 60;

const Empty = ({ brand, text }: { brand: string; text: string }) => (
    <div className="flex flex-col items-center gap-1 py-4 text-center">
        <EmptyReportIllustration brand={brand} className="w-28" />
        <span className="text-xs text-neutral-500">{text}</span>
    </div>
);

const headlineFor = (r: BatchSummaryReport) => {
    if (r.enrolled_learners === 0) return 'No learners yet';
    if (r.avg_score == null) return 'No assessment attempts in these dates';
    if (r.avg_score >= 60) return 'Strong results across the board';
    if (r.avg_score >= 40) return 'Steady, with room to grow';
    return 'Scores need attention';
};

const BatchOverviewBody = ({
    data,
    brand,
    batchLabels,
}: {
    data: BatchSummaryReport;
    brand: string;
    batchLabels: Map<string, string>;
}) => {
    const single = !!data.package_session_id;
    const scored = useMemo(() => data.learners.filter((l) => l.avg_score != null), [data]);
    const histogram = useMemo(() => toHistogram(scored.map((l) => l.avg_score)), [scored]);
    const topics = useMemo(
        () => data.topics.filter((t) => t.accuracy != null && t.questions > 0),
        [data]
    );
    const strengths = useMemo(
        () =>
            topics
                .filter((t) => (t.accuracy ?? 0) >= STRONG_FROM)
                .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0)),
        [topics]
    );
    const weaknesses = useMemo(
        () =>
            topics
                .filter((t) => (t.accuracy ?? 0) < STRONG_FROM)
                .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0)),
        [topics]
    );
    const needsAttention = useMemo(
        () =>
            data.learners
                .filter((l) => l.band === 'WEAK' || l.band === 'NOT_ASSESSED')
                .sort((a, b) => {
                    if (a.band !== b.band) return a.band === 'WEAK' ? -1 : 1;
                    return (a.avg_score ?? 0) - (b.avg_score ?? 0);
                })
                .slice(0, 6),
        [data]
    );
    const trend = data.assessments.slice(-12).map((a) => ({
        label: a.name,
        sub: a.date ?? undefined,
        you: a.avg_score,
        klass: null,
    }));
    const topScorers = scored.slice(0, 8);
    const activity = data.activity ?? [];
    const maxTime = Math.max(1, ...activity.map((a) => a.total_time_minutes ?? 0));
    const batches = (data.batches ?? []).filter((b) => b.learners > 0);

    return (
        <div className="flex flex-col gap-4">
            <ReportHero
                brand={brand}
                kicker={data.batch_name ?? 'All batches'}
                headline={headlineFor(data)}
                subline={
                    data.assessments_held > 0
                        ? `${data.assessments_held} assessment${data.assessments_held === 1 ? '' : 's'}, ${data.total_attempts} attempts.`
                        : undefined
                }
                bigValue={data.avg_score != null ? `${Math.round(data.avg_score)}` : '—'}
                bigSuffix={data.avg_score != null ? '%' : undefined}
                bigCaption="average score"
                illustration={<ClassIllustration brand={brand} className="h-auto w-full" />}
                track={
                    data.participation_rate != null
                        ? {
                              value: data.participation_rate,
                              left: (
                                  <>
                                      <b>{data.learners_assessed}</b> of {data.enrolled_learners}{' '}
                                      learners took an assessment
                                  </>
                              ),
                          }
                        : null
                }
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile
                    value={data.enrolled_learners}
                    label="Learners"
                    icon={<UsersThree className="size-3.5" />}
                />
                <StatTile
                    value={pct(data.participation_rate)}
                    label="Took an assessment"
                    color={brand}
                    icon={<Exam className="size-3.5" />}
                />
                <StatTile
                    value={data.assessments_held}
                    label="Assessments held"
                    icon={<ChartLineUp className="size-3.5" />}
                />
                {single ? (
                    <StatTile
                        value={pct(data.avg_course_completion)}
                        label="Course completion"
                        icon={<Books className="size-3.5" />}
                    />
                ) : (
                    <StatTile
                        value={data.total_attempts}
                        label="Attempts"
                        icon={<Exam className="size-3.5" />}
                    />
                )}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ReportBlock
                    brand={brand}
                    tag="Score bands"
                    title={`${data.strong_learners} of ${data.enrolled_learners} learners at 60% or more`}
                    lede="Learners by their average assessment score."
                >
                    <DonutChart
                        data={[
                            { label: '60% and above', value: data.strong_learners, color: REPORT_COLORS.good },
                            { label: '40 to 60%', value: data.average_learners, color: REPORT_COLORS.warn },
                            { label: 'Under 40%', value: data.weak_learners, color: REPORT_COLORS.bad },
                            {
                                label: 'Not assessed',
                                value: data.not_assessed_learners,
                                color: REPORT_COLORS.neutral,
                            },
                        ]}
                        centerValue={pct(data.avg_score)}
                        centerLabel="average"
                        size={170}
                    />
                </ReportBlock>

                <ReportBlock
                    brand={brand}
                    tag="Where learners stand"
                    title={scored.length > 0 ? 'Spread of scores' : 'No scores yet'}
                    lede="How many learners have an average score in each range."
                >
                    {scored.length > 0 ? (
                        <ScoreHistogram data={histogram} height={200} />
                    ) : (
                        <Empty brand={brand} text="No assessment attempts in these dates." />
                    )}
                </ReportBlock>

                <ReportBlock
                    brand={brand}
                    tag="Assessments"
                    title={
                        data.assessments.length > 0
                            ? `${data.assessments.length} assessment${data.assessments.length === 1 ? '' : 's'} in these dates`
                            : 'No assessments in these dates'
                    }
                    lede="Average score in each assessment, in date order."
                >
                    {trend.length > 0 ? (
                        <TrendChart data={trend} brand={brand} />
                    ) : (
                        <Empty brand={brand} text="Scores appear once learners attempt an assessment." />
                    )}
                </ReportBlock>

                <ReportBlock
                    brand={brand}
                    tag="By subject"
                    title={
                        data.subject_scores[0]
                            ? `Best in ${data.subject_scores[0].subject}`
                            : 'No subject scores yet'
                    }
                    lede="Average score in each subject's assessments."
                >
                    {data.subject_scores.length > 0 ? (
                        <CompareBarChart
                            brand={brand}
                            youLabel="Average score"
                            data={data.subject_scores.map((s) => ({
                                name: s.subject,
                                you: s.avg_score,
                                klass: null,
                            }))}
                        />
                    ) : (
                        <Empty brand={brand} text="Subjects are read from assessment names." />
                    )}
                </ReportBlock>
            </div>

            <ReportBlock
                brand={brand}
                tag="Strengths and weaknesses"
                title={
                    topics.length > 0
                        ? `${strengths.length} strong, ${weaknesses.length} to work on`
                        : 'No analysed attempts yet'
                }
                lede="Questions answered correctly in each topic across the learners. 60% or above is a strength."
            >
                {topics.length === 0 ? (
                    <Empty
                        brand={brand}
                        text="Topic accuracy appears once assessment attempts are analysed."
                    />
                ) : (
                    <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-[1fr_1fr_1fr]">
                        {topics.length >= 3 ? (
                            <TopicRadar
                                brand={brand}
                                data={[...strengths, ...weaknesses]
                                    .slice(0, 10)
                                    .map((t) => ({ topic: t.topic, accuracy: t.accuracy ?? 0 }))}
                            />
                        ) : (
                            <div />
                        )}
                        <TopicColumn
                            title="Strengths"
                            icon={<ArrowUp className="size-4 text-success-600" weight="bold" />}
                            rows={strengths}
                            brand={brand}
                            empty="No topic at 60% or above yet."
                        />
                        <TopicColumn
                            title="Needs work"
                            icon={<ArrowDown className="size-4 text-danger-600" weight="bold" />}
                            rows={weaknesses}
                            brand={brand}
                            empty="No topic below 60%."
                        />
                    </div>
                )}
            </ReportBlock>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {!single && (
                    <ReportBlock
                        brand={brand}
                        tag="Batches compared"
                        title={
                            batches[0]?.avg_score != null
                                ? `${batchLabels.get(batches[0].package_session_id) ?? 'A batch'} leads`
                                : 'No batch scores yet'
                        }
                        lede="Average score of each batch's assessed learners."
                    >
                        {batches.some((b) => b.avg_score != null) ? (
                            <HorizontalBars
                                color={brand}
                                marker={
                                    data.avg_score != null
                                        ? { value: data.avg_score, label: 'Institute average' }
                                        : null
                                }
                                rows={batches.slice(0, 12).map((b) => ({
                                    key: b.package_session_id,
                                    label: batchLabels.get(b.package_session_id) ?? 'Batch',
                                    value: b.avg_score,
                                    display: pct(b.avg_score),
                                    sub: `${b.learners_assessed}/${b.learners} assessed`,
                                    color: scoreColor(b.avg_score),
                                }))}
                            />
                        ) : (
                            <Empty brand={brand} text="No batch has assessment scores yet." />
                        )}
                    </ReportBlock>
                )}

                <ReportBlock
                    brand={brand}
                    tag="Top performers"
                    title={
                        topScorers[0]
                            ? `${topScorers[0].full_name} leads with ${pct(topScorers[0].avg_score)}`
                            : 'No scores yet'
                    }
                    lede="Highest average assessment scores."
                >
                    {topScorers.length > 0 ? (
                        <HorizontalBars
                            color={brand}
                            marker={
                                data.avg_score != null
                                    ? { value: data.avg_score, label: 'Average' }
                                    : null
                            }
                            rows={topScorers.map((l) => ({
                                key: l.user_id,
                                label: l.full_name,
                                value: l.avg_score,
                                display: pct(l.avg_score),
                                color: scoreColor(l.avg_score),
                            }))}
                        />
                    ) : (
                        <Empty brand={brand} text="Nobody has attempted an assessment yet." />
                    )}
                </ReportBlock>

                <ReportBlock
                    brand={brand}
                    tag="Needs attention"
                    title={
                        needsAttention.length > 0
                            ? `${data.weak_learners + data.not_assessed_learners} learners need a nudge`
                            : 'Everyone is on track'
                    }
                    lede="Under 40% first, then learners with no assessment attempt."
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
                                                l.band === 'WEAK'
                                                    ? REPORT_COLORS.bad
                                                    : REPORT_COLORS.neutral,
                                        }}
                                    />
                                    <span className="truncate text-neutral-700">{l.full_name}</span>
                                    <span
                                        className="ml-auto shrink-0 text-xs font-semibold"
                                        style={{
                                            color:
                                                l.band === 'WEAK'
                                                    ? REPORT_COLORS.bad
                                                    : REPORT_COLORS.muted,
                                        }}
                                    >
                                        {l.band === 'WEAK' ? pct(l.avg_score) : 'Not assessed'}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </ReportBlock>

                {single && (
                    <ReportBlock
                        brand={brand}
                        tag="Course progress"
                        title={
                            (data.subjects ?? []).length > 0
                                ? `${pct(data.avg_course_completion)} of the course completed`
                                : 'No course progress yet'
                        }
                        lede="Average completion and time per learner in each subject."
                    >
                        {(data.subjects ?? []).length > 0 ? (
                            <HorizontalBars
                                color={brand}
                                rows={(data.subjects ?? []).map((s) => ({
                                    key: s.subject_name,
                                    label: s.subject_name,
                                    value: s.avg_completion,
                                    display: pct(s.avg_completion),
                                    sub: minutesLabel(s.avg_time_minutes),
                                }))}
                            />
                        ) : (
                            <Empty brand={brand} text="Nothing completed yet." />
                        )}
                    </ReportBlock>
                )}

                {single && (
                    <ReportBlock
                        brand={brand}
                        tag="Most active"
                        title={
                            activity[0]
                                ? `${activity[0].full_name} spent the most time learning`
                                : 'No learning activity in these dates'
                        }
                        lede="Time spent learning in the selected dates."
                    >
                        {activity.length > 0 ? (
                            <HorizontalBars
                                color={brand}
                                max={maxTime}
                                rows={activity.map((a) => ({
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
                            <Empty brand={brand} text="No activity recorded." />
                        )}
                    </ReportBlock>
                )}
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
    const [picked, setPicked] = useState<string>(ALL);
    const [timeline, setTimeline] = useState<TimelineValue>(DEFAULT_TIMELINE);
    const range = resolveTimeline(timeline);
    const batchId = fixedPackageSessionId ?? (picked === ALL ? undefined : picked);
    const batchLabels = useMemo(
        () => new Map(batchOptions.map((b) => [b.value, b.label])),
        [batchOptions]
    );
    const batchLabel = batchId ? batchLabels.get(batchId) : undefined;
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const batchesTerm = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);

    const request: BatchSummaryRequest | null = useMemo(
        () =>
            range
                ? {
                      ...(batchId ? { package_session_id: batchId, batch_name: batchLabel } : {}),
                      start_date: range.start,
                      end_date: range.end,
                  }
                : null,
        [batchId, batchLabel, range?.start, range?.end]
    );

    const { data, isLoading, isError } = useQuery({
        ...getBatchSummaryReportQuery(request ?? { start_date: '', end_date: '' }),
    });

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 md:flex-row md:items-end">
                {!fixedPackageSessionId && (
                    <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-600">
                        {batchTerm}
                        <Select value={picked} onValueChange={setPicked}>
                            <SelectTrigger className="h-9 w-full text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL}>All {batchesTerm.toLowerCase()}</SelectItem>
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

            {!range ? (
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
                <BatchOverviewBody data={data} brand={brand} batchLabels={batchLabels} />
            )}
        </div>
    );
}
