import { useQuery } from '@tanstack/react-query';
import { Coins } from '@phosphor-icons/react';
import { STUDENT_ANALYSIS_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { cn } from '@/lib/utils';

export interface ReportAiEstimate {
    learners: number;
    per_report_credits: number | null;
    estimated_credits: number | null;
    basis: 'INSTITUTE' | 'PLATFORM' | 'NONE';
    sample_runs: number;
    balance: number | null;
    balance_after: number | null;
    sufficient: boolean;
}

export const fetchReportAiEstimate = async (
    instituteId: string,
    learners: number
): Promise<ReportAiEstimate> => {
    const { data } = await authenticatedAxiosInstance.get<ReportAiEstimate>(
        `${STUDENT_ANALYSIS_BASE}/ai-estimate`,
        { params: { instituteId, learners } }
    );
    return data;
};

const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : String(Math.round(n * 10) / 10));

/**
 * "About N AI credits" before an AI learner report runs: the institute average per report times
 * the learners, with the balance. Red when the balance would not cover it.
 */
export const AiEstimateNote = ({
    instituteId,
    learners,
    enabled = true,
    perLearner = false,
    className,
}: {
    instituteId: string | undefined;
    learners: number;
    enabled?: boolean;
    /** Show the cost of one learner, for a run whose learner count is not known yet. */
    perLearner?: boolean;
    className?: string;
}) => {
    const { data } = useQuery({
        queryKey: ['REPORT_AI_ESTIMATE', instituteId, learners],
        queryFn: () => fetchReportAiEstimate(instituteId ?? '', learners),
        enabled: enabled && !!instituteId && learners > 0,
        staleTime: 5 * 60_000,
    });
    if (!data || data.estimated_credits == null) return null;
    const low = !data.sufficient;
    return (
        <div
            className={cn(
                'flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-3 py-2 text-xs',
                low ? 'bg-danger-50 text-danger-700' : 'bg-neutral-50 text-neutral-600',
                className
            )}
        >
            <Coins className="size-4 shrink-0" weight="fill" />
            <span>
                About <b>{fmt(data.estimated_credits)}</b> AI credits
                {perLearner ? ' per learner' : data.learners > 1 ? ` for ${data.learners} learners` : ''}
            </span>
            {data.balance != null && (
                <span className="text-neutral-500">
                    · balance {fmt(data.balance)}
                    {low ? ', not enough' : ''}
                </span>
            )}
        </div>
    );
};
