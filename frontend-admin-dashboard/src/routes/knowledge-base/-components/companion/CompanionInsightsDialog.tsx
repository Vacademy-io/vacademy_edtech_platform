import { useTranslation } from 'react-i18next';
import { ChartLineUp, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber, formatRelative } from '@/lib/formatters';
import { useCompanionInsights } from '../../-hooks/companion';

function Kpi({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
            <p className="text-caption text-neutral-500">{label}</p>
            <p className="text-title font-semibold text-neutral-700">{value}</p>
        </div>
    );
}

function MasteryBar({ value }: { value: number | null }) {
    if (value == null) return <span className="text-caption text-neutral-400">—</span>;
    return (
        <div className="flex items-center gap-2">
            <Progress value={value} className="h-1.5 w-20" />
            <span className="text-caption tabular-nums text-neutral-600">{value}%</span>
        </div>
    );
}

export function CompanionInsightsDialog({
    companionId,
    companionName,
    open,
    onOpenChange,
}: {
    companionId: string;
    companionName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('knowledgeBaseCompanions');
    const { data, isLoading, isError, refetch } = useCompanionInsights(companionId, open);

    const started = data?.learners.length ?? 0;
    const completed = data?.nodes.reduce((sum, n) => sum + n.completed, 0) ?? 0;
    const total = data?.leaves_total ?? 0;

    return (
        <MyDialog
            heading={t('insights.heading', { name: companionName })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-4xl"
        >
            <div className="flex flex-col gap-5">
                {isLoading && <Skeleton className="h-48 w-full rounded-md" />}
                {isError && (
                    <div className="flex flex-col items-center gap-2 p-6 text-center">
                        <WarningCircle className="size-6 text-danger-500" />
                        <p className="text-body text-neutral-600">{t('insights.loadError')}</p>
                        <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                            {t('actions.tryAgain')}
                        </MyButton>
                    </div>
                )}

                {data && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <Kpi label={t('insights.kpi.started')} value={formatNumber(started)} />
                        <Kpi
                            label={t('insights.kpi.questions')}
                            value={formatNumber(data.questions_asked)}
                        />
                        <Kpi label={t('insights.kpi.completed')} value={formatNumber(completed)} />
                    </div>
                )}

                {data && started === 0 && data.questions_asked === 0 && (
                    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-neutral-300 p-8 text-center">
                        <ChartLineUp className="size-7 text-neutral-400" />
                        <p className="text-body font-medium text-neutral-700">
                            {t('insights.emptyTitle')}
                        </p>
                        <p className="text-caption text-neutral-500">{t('insights.emptyBody')}</p>
                    </div>
                )}

                {data && data.nodes.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="text-subtitle font-semibold text-neutral-700">
                            {t('insights.topicsHeading')}
                        </p>
                        <div className="overflow-x-auto rounded-md border border-neutral-200">
                            <table className="w-full text-body">
                                <thead className="bg-neutral-50 text-caption text-neutral-500">
                                    <tr>
                                        <th className="px-3 py-2 text-start font-medium">
                                            {t('insights.cols.topic')}
                                        </th>
                                        <th className="px-3 py-2 text-end font-medium">
                                            {t('insights.cols.started')}
                                        </th>
                                        <th className="px-3 py-2 text-end font-medium">
                                            {t('insights.cols.completed')}
                                        </th>
                                        <th className="px-3 py-2 text-start font-medium">
                                            {t('insights.cols.mastery')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                    {data.nodes.map((n) => (
                                        <tr key={n.node_id}>
                                            <td className="px-3 py-2 text-neutral-700">
                                                {n.title || t('insights.untitledTopic')}
                                            </td>
                                            <td className="px-3 py-2 text-end tabular-nums">
                                                {formatNumber(n.started)}
                                            </td>
                                            <td className="px-3 py-2 text-end tabular-nums">
                                                {formatNumber(n.completed)}
                                            </td>
                                            <td className="px-3 py-2">
                                                <MasteryBar value={n.avg_mastery} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {data && data.learners.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="text-subtitle font-semibold text-neutral-700">
                            {t('insights.learnersHeading')}
                        </p>
                        <div className="overflow-x-auto rounded-md border border-neutral-200">
                            <table className="w-full text-body">
                                <thead className="bg-neutral-50 text-caption text-neutral-500">
                                    <tr>
                                        <th className="px-3 py-2 text-start font-medium">
                                            {t('insights.cols.student')}
                                        </th>
                                        <th className="px-3 py-2 text-end font-medium">
                                            {t('insights.cols.topicsDone')}
                                        </th>
                                        <th className="px-3 py-2 text-start font-medium">
                                            {t('insights.cols.mastery')}
                                        </th>
                                        <th className="px-3 py-2 text-end font-medium">
                                            {t('insights.cols.lastActive')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                    {data.learners.map((l) => (
                                        <tr key={l.user_id}>
                                            <td className="px-3 py-2 text-neutral-700">
                                                {l.name || t('insights.unnamedStudent')}
                                            </td>
                                            <td className="px-3 py-2 text-end tabular-nums">
                                                {t('insights.doneOf', {
                                                    done: formatNumber(l.completed),
                                                    total: formatNumber(total),
                                                })}
                                            </td>
                                            <td className="px-3 py-2">
                                                <MasteryBar value={l.avg_mastery} />
                                            </td>
                                            <td className="px-3 py-2 text-end text-caption text-neutral-500">
                                                {l.last_active
                                                    ? formatRelative(l.last_active)
                                                    : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </MyDialog>
    );
}
