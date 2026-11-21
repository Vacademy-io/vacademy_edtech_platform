import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { minutesLabel, useBrandColor } from '@/components/common/report-visuals/palette';
import {
    getLearnerDailyTimeQuery,
    getStudentReportSnapshotQuery,
} from '@/services/student-report-snapshot';
import { ReportBlock } from '@/components/common/report-visuals/blocks';
import { DailyTimeChart } from '@/components/common/report-visuals/charts';
import { ProfileError, ProfileSkeleton } from '../profile-ui';
import { buildLearnerReport } from './learner-report-model';
import {
    AttendanceBlock,
    LearnerHero,
    LearnerTiles,
    MistakesBlock,
    ProgressBlock,
    SubjectsBlock,
    ThinkingBlock,
    TopicsBlock,
    TrendBlock,
} from './LearnerReportBlocks';
import { LearnerJourneyBlock, LearnerPointsBlock } from './LearnerJourneyBlocks';
import { LearnerReportDialog } from './LearnerReportDocument';

/**
 * The learner Reports tab basic report: hero result, tiles and the charts of the printable
 * report, for the picked batch and dates. "Generate report" opens the same data as A4 pages.
 */
export const StudentReportSnapshot = ({
    userId,
    instituteId,
    batchId,
    range,
    learnerName,
    packageSessionIds = [],
}: {
    userId: string;
    instituteId: string;
    batchId?: string;
    range: { start: string; end: string } | null;
    learnerName?: string | null;
    /** The learner batches; daily time covers the picked one, or all of them. */
    packageSessionIds?: string[];
}) => {
    const { data, isLoading, isError, refetch } = useQuery({
        ...getStudentReportSnapshotQuery({
            userId,
            instituteId,
            batchId,
            startDate: range?.start ?? '',
            endDate: range?.end ?? '',
        }),
    });
    const brand = useBrandColor(data?.institute?.theme_color);
    const daily = useQuery({
        ...getLearnerDailyTimeQuery({
            userId,
            packageSessionIds: batchId ? [batchId] : packageSessionIds,
            startDate: range?.start ?? '',
            endDate: range?.end ?? '',
        }),
    });
    const dailyPoints = useMemo(
        () =>
            (daily.data ?? []).map((d) => ({
                date: String(d.activity_date).slice(0, 10),
                minutes: (d.time_spent_by_user_millis ?? 0) / 60000,
                compare:
                    d.avg_time_spent_by_batch_millis != null
                        ? d.avg_time_spent_by_batch_millis / 60000
                        : null,
            })),
        [daily.data]
    );
    const studiedDays = dailyPoints.filter((p) => p.minutes > 0);
    const dailyAvg =
        studiedDays.length > 0
            ? studiedDays.reduce((s, p) => s + p.minutes, 0) / studiedDays.length
            : null;
    const m = useMemo(() => (data ? buildLearnerReport(data, learnerName) : null), [data, learnerName]);

    if (!range) {
        return (
            <p className="text-xs text-neutral-500">Pick a start and end date to see the report.</p>
        );
    }
    if (isLoading) return <ProfileSkeleton blocks={3} />;
    if (isError || !data || !m) {
        return (
            <ProfileError
                title="Couldn't load the report"
                hint="Check the dates and try again."
                onRetry={() => refetch()}
            />
        );
    }

    const props = { m, brand };
    return (
        <div className="flex flex-col gap-3">
            <div className="flex justify-end">
                <LearnerReportDialog
                    snapshot={data}
                    brand={brand}
                    fallbackName={learnerName}
                    range={range}
                />
            </div>
            <LearnerHero
                {...props}
                compact
                logo={{ url: data.institute?.logo_url, name: data.institute?.name }}
            />
            <LearnerTiles {...props} narrow />
            <SubjectsBlock {...props} />
            <TrendBlock {...props} />
            <LearnerJourneyBlock userId={userId} brand={brand} range={range} snapshot={data} />
            <LearnerPointsBlock userId={userId} instituteId={instituteId} brand={brand} />
            <ReportBlock
                brand={brand}
                tag="Daily time spent"
                title={
                    dailyAvg != null
                        ? `${minutesLabel(dailyAvg)} on days of study, ${studiedDays.length} day${studiedDays.length === 1 ? '' : 's'}`
                        : 'No learning time in these dates'
                }
                lede="Minutes learning each day; the line is the batch average."
            >
                {studiedDays.length > 0 ? (
                    <DailyTimeChart
                        data={dailyPoints}
                        brand={brand}
                        valueLabel={m.firstName}
                        compareLabel="Batch average"
                        height={180}
                    />
                ) : (
                    <p className="text-xs text-neutral-500">
                        Time appears once the learner opens course content.
                    </p>
                )}
            </ReportBlock>
            <TopicsBlock {...props} />
            <MistakesBlock {...props} />
            <AttendanceBlock {...props} />
            <ProgressBlock {...props} />
            <ThinkingBlock {...props} />
        </div>
    );
};
