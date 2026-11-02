import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBrandColor } from '@/components/common/report-visuals/palette';
import { getStudentReportSnapshotQuery } from '@/services/student-report-snapshot';
import { ProfileError, ProfileSkeleton } from '../profile-ui';
import { buildLearnerReport } from './learner-report-model';
import {
    AttendanceBlock,
    LearnerHero,
    LearnerTiles,
    ProgressBlock,
    SubjectsBlock,
    ThinkingBlock,
    TopicsBlock,
    TrendBlock,
} from './LearnerReportBlocks';
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
}: {
    userId: string;
    instituteId: string;
    batchId?: string;
    range: { start: string; end: string } | null;
    learnerName?: string | null;
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
            <TopicsBlock {...props} />
            <AttendanceBlock {...props} />
            <ProgressBlock {...props} />
            <ThinkingBlock {...props} />
        </div>
    );
};
