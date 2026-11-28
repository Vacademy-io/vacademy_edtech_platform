import { ArrowRight, Lightbulb } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/design-system/status-chips';
import { cn } from '@/lib/utils';
import type { DiagnosisSeverity } from '@/services/engagement-diagnosis';
import type { ProblemRowView } from '../../-utils/diagnosis-problems';
import { ReportLink } from '../daily-report/ReportLink';

const BOX: Record<DiagnosisSeverity, string> = {
    critical: 'border-danger-200 bg-danger-50',
    warning: 'border-warning-200 bg-warning-50',
};

function ProblemRow({ problem }: { problem: ProblemRowView }) {
    const { t } = useTranslation('engagementDailyReport');
    const critical = problem.severity === 'critical';
    return (
        <li
            className={cn(
                'flex min-w-0 flex-col gap-2 rounded-lg border p-3 sm:p-4',
                BOX[problem.severity] ?? BOX.warning
            )}
        >
            <div className="flex flex-wrap items-center gap-2">
                <StatusChip
                    text={t(`diagnosis.severity.${problem.severity}`)}
                    textSize="text-caption"
                    status={critical ? 'DANGER' : 'WARNING'}
                />
                <span className="text-neutral-600">
                    <span className="text-caption">{problem.stageLabel}</span>
                </span>
            </div>
            <h4 className="break-words font-semibold text-neutral-900">
                <span className="text-body">{problem.title}</span>
            </h4>
            {problem.evidence && (
                <p className="break-words text-neutral-700">
                    <span className="text-body">{problem.evidence}</span>
                </p>
            )}
            {problem.breakdown.length > 0 && (
                <p className="break-words text-neutral-600">
                    <span className="text-caption">
                        {t('diagnosis.breakdown.lead')}{' '}
                        {problem.breakdown.map((b) => `${b.label} ${b.count}`).join(' · ')}
                    </span>
                </p>
            )}
            <p className="flex items-start gap-2 text-neutral-800">
                <Lightbulb size={16} weight="fill" className="mt-0.5 shrink-0 text-warning-600" />
                <span className="break-words text-body">{problem.advice}</span>
            </p>
            {problem.link && problem.linkLabel && (
                <p>
                    <ReportLink
                        target={problem.link}
                        label={`${problem.linkLabel}: ${problem.title}`}
                        className="inline-flex items-center gap-1 font-medium text-primary-600"
                    >
                        <span className="text-body">{problem.linkLabel}</span>
                        <ArrowRight size={14} aria-hidden="true" className="rtl:rotate-180" />
                    </ReportLink>
                </p>
            )}
        </li>
    );
}

/**
 * The problems, in the order the API sent them (it has ranked them), with how many more there
 * were. A problem code the page does not know is a plain row, never an error.
 */
export function ProblemList({
    problems,
    moreProblems,
}: {
    problems: ProblemRowView[];
    moreProblems: number;
}) {
    const { t } = useTranslation('engagementDailyReport');
    if (problems.length === 0) return null;
    return (
        <div className="flex flex-col gap-3">
            <ol aria-label={t('diagnosis.problemsLabel')} className="flex flex-col gap-3">
                {problems.map((problem) => (
                    <ProblemRow key={problem.key} problem={problem} />
                ))}
            </ol>
            {moreProblems > 0 && (
                <p className="text-neutral-600">
                    <span className="text-caption">
                        {t('diagnosis.more', { count: moreProblems })}
                    </span>
                </p>
            )}
        </div>
    );
}
