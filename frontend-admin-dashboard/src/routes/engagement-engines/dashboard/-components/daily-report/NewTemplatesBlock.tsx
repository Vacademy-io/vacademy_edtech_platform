import { Warning } from '@phosphor-icons/react';
import { Trans, useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CellTone, NewTemplatesModel, ReportStat } from '../../-utils/report-tables';
import { ReportLink } from './ReportLink';
import { InfoHint } from './StatsGrid';

type ChipTone = CellTone | 'default' | 'total';

const CHIP_TONE: Record<ChipTone, string> = {
    default: 'border-neutral-200 bg-neutral-50 text-neutral-700',
    muted: 'border-neutral-200 bg-neutral-50 text-neutral-400',
    warning: 'border-warning-200 bg-warning-50 text-warning-700',
    success: 'border-success-200 bg-success-50 text-success-700',
    danger: 'border-danger-200 bg-danger-50 text-danger-700',
    total: 'border-primary-200 bg-primary-50 text-primary-600',
};

/** The total stands out from the categories beside it; a zero fades back. */
const toneOf = (stat: ReportStat): ChipTone =>
    stat.key === 'created' ? 'total' : stat.tone ?? (stat.value === 0 ? 'muted' : 'default');

function StatChip({ stat }: { stat: ReportStat }) {
    const { t } = useTranslation('engagementDailyReport');
    return (
        <li
            className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1',
                CHIP_TONE[toneOf(stat)]
            )}
        >
            <span className="text-caption">{stat.label}</span>
            <span className="font-semibold tabular-nums">
                <span className="text-body">
                    {stat.link ? (
                        <ReportLink
                            target={stat.link}
                            label={t('links.openKpi', { label: stat.label, value: stat.text })}
                        >
                            {stat.text}
                        </ReportLink>
                    ) : (
                        stat.text
                    )}
                </span>
            </span>
            {stat.hint && <InfoHint label={stat.label} hint={stat.hint} />}
        </li>
    );
}

function ChipGroup({ title, stats }: { title: string; stats: ReportStat[] }) {
    return (
        <div className="flex flex-col gap-2">
            <h4 className="font-semibold text-neutral-800">
                <span className="text-body">{title}</span>
            </h4>
            <ul aria-label={title} className="flex flex-wrap items-center gap-2">
                {stats.map((stat) => (
                    <StatChip key={stat.key} stat={stat} />
                ))}
            </ul>
        </div>
    );
}

/**
 * The WhatsApp templates the engine proposed on the day: how many, split by the category it
 * proposed, and where each stands (with the team, with Meta, live, turned down). Every figure
 * above zero opens the Templates list for the same engine and day. A warning appears when Meta
 * made utility templates marketing, because those cost far more per message.
 */
export function NewTemplatesBlock({ model }: { model: NewTemplatesModel }) {
    const { t } = useTranslation('engagementDailyReport');
    const moved = model.moved;
    return (
        <div className="flex flex-col gap-4">
            <ChipGroup title={t('newTemplates.categoryHeading')} stats={model.categories} />
            <ChipGroup title={t('newTemplates.statusHeading')} stats={model.statuses} />
            {moved && (
                <p
                    role="note"
                    className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-warning-700"
                >
                    <Warning
                        size={16}
                        weight="fill"
                        aria-hidden="true"
                        className="mt-0.5 shrink-0"
                    />
                    <span className="text-caption">
                        <Trans
                            t={t}
                            ns="engagementDailyReport"
                            i18nKey="newTemplates.movedNote"
                            count={moved.count}
                            components={{
                                open: moved.link ? (
                                    <ReportLink
                                        target={moved.link}
                                        label={t('links.openKpi', {
                                            label: t('newTemplates.moved'),
                                            value: moved.count,
                                        })}
                                        className="font-semibold"
                                    >
                                        {null}
                                    </ReportLink>
                                ) : (
                                    <span className="font-semibold" />
                                ),
                            }}
                        />
                    </span>
                </p>
            )}
        </div>
    );
}
