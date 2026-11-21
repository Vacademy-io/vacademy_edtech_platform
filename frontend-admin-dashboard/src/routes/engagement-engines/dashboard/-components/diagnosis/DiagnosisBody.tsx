import type { ReactNode } from 'react';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { PanelState } from '../../-utils/diagnosis-stages';
import type { ReportKpi } from '../../-utils/report-kpis';
import type { DiagnosisViewModel } from '../../-utils/use-diagnosis-view';
import { ProblemList } from './ProblemList';
import { DataGapNotes, StageStatusList } from './StageStatusList';

/** The headline numbers the page already has, shown with a calm day or week. */
const HEADLINE: ReportKpi['key'][] = ['peopleAdded', 'messagesSent', 'replies', 'demosBooked'];

const TONE: Record<
    Exclude<PanelState, 'problems'>,
    { box: string; text: string; icon: ReactNode }
> = {
    calm: {
        box: 'border-success-200 bg-success-50',
        text: 'text-success-700',
        icon: <CheckCircle size={20} weight="fill" aria-hidden="true" />,
    },
    quiet: {
        box: 'border-neutral-200 bg-neutral-50',
        text: 'text-neutral-700',
        icon: <CheckCircle size={20} aria-hidden="true" />,
    },
    // Nothing fired, but something could not be read: this must not look like a clean bill.
    incomplete: {
        box: 'border-warning-200 bg-warning-50',
        text: 'text-warning-700',
        icon: <WarningCircle size={20} weight="fill" aria-hidden="true" />,
    },
};

/** How the "no problems" words name the period: today, an earlier day, or the week. */
export type DiagnosisScope = 'today' | 'day' | 'week';

function NoProblems({
    state,
    scope,
    kpis,
}: {
    state: Exclude<PanelState, 'problems'>;
    scope: DiagnosisScope;
    kpis: ReportKpi[];
}) {
    const { t } = useTranslation('engagementDailyReport');
    const tone = TONE[state];
    const headline = HEADLINE.map((key) => kpis.find((k) => k.key === key)).filter(
        (k): k is ReportKpi => !!k
    );
    return (
        <div role="status" className={cn('flex flex-col gap-3 rounded-lg border p-4', tone.box)}>
            <p className={cn('flex items-center gap-2 font-semibold', tone.text)}>
                {tone.icon}
                <span className="text-subtitle">
                    {t(`diagnosis.noProblems.${state}.title`, { context: scope })}
                </span>
            </p>
            <p className="text-neutral-700">
                <span className="text-body">
                    {t(`diagnosis.noProblems.${state}.text`, { context: scope })}
                </span>
            </p>
            {headline.length > 0 && (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {headline.map((k) => (
                        <div key={k.key} className="min-w-0">
                            <dt className="truncate text-neutral-600">
                                <span className="text-caption">{k.label}</span>
                            </dt>
                            <dd className="font-semibold tabular-nums text-neutral-900">
                                <span className="text-title">{k.value}</span>
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    );
}

interface DiagnosisBodyProps {
    view: DiagnosisViewModel;
    scope: DiagnosisScope;
    /** The report's headline numbers, shown when there is nothing to fix; empty while it loads. */
    kpis: ReportKpi[];
}

/**
 * What the diagnosis says, for a day or a week: the problems, or a calm "nothing to fix" with the
 * headline numbers; then a line per stage and a note on what the report cannot see.
 */
export function DiagnosisBody({ view, scope, kpis }: DiagnosisBodyProps) {
    return (
        <div className="flex flex-col gap-4">
            {view.state === 'problems' ? (
                <ProblemList problems={view.problems} moreProblems={view.moreProblems} />
            ) : (
                <NoProblems state={view.state} scope={scope} kpis={kpis} />
            )}
            <StageStatusList stages={view.stages} />
            <DataGapNotes notes={view.gaps} />
        </div>
    );
}
