import type { Icon } from '@phosphor-icons/react';
import {
    ChatsCircle,
    Coins,
    CurrencyDollar,
    EnvelopeSimple,
    ListChecks,
    PhoneCall,
    Robot,
    Target,
    UsersThree,
    Gauge,
    ChartBar,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import type {
    DailyReportLeadAgent,
    EngagementDailyReport,
} from '@/services/engagement-daily-report';
import { partFailed, type ReportPart } from '../../-utils/report-errors';
import { formatNumber } from '../../-utils/report-format';
import type { ReportView } from '../../-utils/use-report-model';
import { ReportSection, SectionError } from './ReportSection';
import { ReportTable } from './ReportTable';
import { StatsGrid } from './StatsGrid';

function GroupHeading({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <div className="flex flex-col gap-0.5 pt-2">
            <h2 className="font-semibold text-neutral-900">
                <span className="text-title">{title}</span>
            </h2>
            <p className="text-neutral-500">
                <span className="text-caption">{subtitle}</span>
            </p>
        </div>
    );
}

function SubHeading({ title, note }: { title: string; note?: string }) {
    return (
        <div className="flex flex-col gap-0.5">
            <h4 className="font-semibold text-neutral-800">
                <span className="text-body">{title}</span>
            </h4>
            {note && (
                <p className="text-neutral-500">
                    <span className="text-caption">{note}</span>
                </p>
            )}
        </div>
    );
}

/** The Lead Agent's counters for one list, shown as a line under that list's row. */
function LeadAgentLine({ agent }: { agent: DailyReportLeadAgent }) {
    const { t } = useTranslation('engagementDailyReport');
    const figures: Array<[string, number]> = [
        [t('lists.col.discovered'), agent.discovered],
        [t('lists.col.researched'), agent.researched],
        [t('lists.col.agentDelivered'), agent.delivered],
        [t('lists.col.review'), agent.review],
        [t('lists.col.rejected'), agent.rejected],
        [t('lists.col.alreadyInCrm'), agent.alreadyInCrm],
        [t('lists.col.searches'), agent.searches],
        [t('lists.col.pages'), agent.pages],
    ];
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-neutral-600">
            <span className="flex items-center gap-1.5 font-semibold text-neutral-800">
                <Robot size={14} />
                <span className="text-caption">{t('lists.agentLine', { name: agent.name })}</span>
            </span>
            {figures.map(([label, n]) => (
                <span key={label} className="whitespace-nowrap">
                    <span className="text-caption">{label} </span>
                    <span className="font-semibold tabular-nums text-neutral-900">
                        <span className="text-caption">{formatNumber(n)}</span>
                    </span>
                </span>
            ))}
        </div>
    );
}

function SectionsSkeleton() {
    const { t } = useTranslation('engagementDailyReport');
    return (
        <div className="flex flex-col gap-4" aria-busy="true">
            {(['did', 'back', 'cost'] as const).map((group) => (
                <div key={group} className="flex flex-col gap-4">
                    <GroupHeading
                        title={t(`groups.${group}.title`)}
                        subtitle={t(`groups.${group}.subtitle`)}
                    />
                    <Skeleton className="h-48 w-full rounded-xl" />
                    <Skeleton className="h-48 w-full rounded-xl" />
                </div>
            ))}
        </div>
    );
}

interface ReportSectionsProps {
    data: EngagementDailyReport | undefined;
    view: ReportView | null;
    onRetry: () => void;
}

/**
 * The detail tables, in three groups that follow the questions the page answers: what the
 * engine did, what came back, what it cost.
 */
export function ReportSections({ data, view, onRetry }: ReportSectionsProps) {
    const { t } = useTranslation('engagementDailyReport');
    if (!data || !view) return <SectionsSkeleton />;

    const { model } = view;
    const failed = (part: ReportPart) => partFailed(data.errors, part);
    const channelsEmpty =
        data.channels.length === 0 ||
        data.channels.every((c) => c.sent === 0 && c.failed === 0 && c.replied === 0);
    const runs = data.runs;
    const runsEmpty = !runs || (runs.decisions === 0 && runs.failed === 0 && runs.expired === 0);
    const outcomes = data.outcomes;
    const outcomesEmpty =
        !outcomes ||
        (outcomes.demosBooked === 0 &&
            outcomes.demosScheduled === 0 &&
            outcomes.conversions === 0 &&
            outcomes.statusChanges.length === 0);
    const costs = data.costs;
    const whatsappCostFailed = failed('whatsappCost');
    // Zeros from WhatsApp charges that failed to load are not an empty cost section.
    const costsEmpty =
        !costs ||
        (!whatsappCostFailed &&
            costs.credits.total === 0 &&
            costs.whatsapp.amount === 0 &&
            costs.whatsapp.billableMessages === 0 &&
            costs.ai.tokensIn + costs.ai.tokensOut === 0);

    const section = (
        icon: Icon,
        title: string,
        subtitle: string | undefined,
        key: ReportPart,
        isEmpty: boolean,
        children: React.ReactNode,
        emptyText?: string,
        hasError?: boolean
    ) => (
        <ReportSection
            icon={icon}
            title={title}
            subtitle={subtitle}
            hasError={hasError ?? failed(key)}
            isEmpty={isEmpty}
            emptyText={emptyText}
            onRetry={onRetry}
        >
            {children}
        </ReportSection>
    );

    return (
        <div className="flex flex-col gap-4">
            <GroupHeading title={t('groups.did.title')} subtitle={t('groups.did.subtitle')} />

            {data.engineId === null &&
                section(
                    UsersThree,
                    model.perEngine.title,
                    model.perEngine.subtitle,
                    'perEngine',
                    model.perEngine.rows.length === 0,
                    <ReportTable spec={model.perEngine} />
                )}

            {section(
                ListChecks,
                model.lists.title,
                model.lists.subtitle,
                'lists',
                model.lists.rows.length === 0,
                <ReportTable
                    spec={model.lists}
                    renderExpandedRow={(row) =>
                        row.leadAgent ? <LeadAgentLine agent={row.leadAgent} /> : null
                    }
                />
            )}

            {section(
                Gauge,
                t('runs.title'),
                t('runs.subtitle'),
                'runs',
                runsEmpty,
                <div className="flex flex-col gap-4">
                    {model.runsStats && <StatsGrid stats={model.runsStats.stats} />}
                    <div className="grid gap-4 lg:grid-cols-2">
                        {model.runsByKind && (
                            <div className="flex flex-col gap-2">
                                <SubHeading title={model.runsByKind.title} />
                                <ReportTable spec={model.runsByKind} />
                            </div>
                        )}
                        <div className="flex flex-col gap-2">
                            <SubHeading title={t('runs.errorsTitle')} />
                            {model.runsErrors && model.runsErrors.rows.length > 0 ? (
                                <ReportTable spec={model.runsErrors} maxRows={5} />
                            ) : (
                                <p className="rounded-lg border border-success-200 bg-success-50 p-3 text-success-700">
                                    <span className="text-body">{t('runs.noErrors')}</span>
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {section(
                ChartBar,
                model.channels.title,
                model.channels.subtitle,
                'channels',
                channelsEmpty,
                <ReportTable spec={model.channels} />
            )}

            {section(
                PhoneCall,
                t('calls.title'),
                t('calls.subtitle'),
                'calls',
                !data.calls || (data.calls.placed === 0 && data.calls.notDialled === 0),
                model.calls && <StatsGrid stats={model.calls.stats} />,
                t('empty.calls')
            )}

            {section(
                EnvelopeSimple,
                t('email.title'),
                t('email.subtitle'),
                'email',
                !data.email || data.email.sent === 0,
                model.email && <StatsGrid stats={model.email.stats} note={model.email.note} />,
                t('empty.email')
            )}

            <GroupHeading title={t('groups.back.title')} subtitle={t('groups.back.subtitle')} />

            {section(
                ChatsCircle,
                model.templates.title,
                model.templates.subtitle,
                'templates',
                model.templates.rows.length === 0,
                <ReportTable spec={model.templates} maxRows={15} />,
                t('empty.templates')
            )}

            {section(
                Target,
                t('outcomes.title'),
                t('outcomes.subtitle'),
                'outcomes',
                outcomesEmpty && !failed('outcomes') && !failed('statusChanges'),
                <div className="flex flex-col gap-4">
                    {failed('outcomes') ? (
                        <SectionError onRetry={onRetry} />
                    ) : (
                        model.outcomes && <StatsGrid stats={model.outcomes.stats} />
                    )}
                    {failed('statusChanges') ? (
                        <SectionError onRetry={onRetry} />
                    ) : (
                        model.statusChanges &&
                        model.statusChanges.rows.length > 0 && (
                            <div className="flex flex-col gap-2">
                                <SubHeading
                                    title={model.statusChanges.title}
                                    note={model.statusChanges.subtitle}
                                />
                                <ReportTable spec={model.statusChanges} />
                            </div>
                        )
                    )}
                </div>,
                undefined,
                // Only when both halves failed does the whole card give way to the error note.
                failed('outcomes') && failed('statusChanges')
            )}

            <GroupHeading title={t('groups.cost.title')} subtitle={t('groups.cost.subtitle')} />

            {section(
                Coins,
                t('costs.title'),
                t('costs.subtitle'),
                'costs',
                costsEmpty,
                <div className="flex flex-col gap-6">
                    <div className="grid gap-6 lg:grid-cols-2">
                        {model.costCredits && (
                            <div className="flex flex-col gap-2">
                                <SubHeading
                                    title={model.costCredits.title}
                                    note={model.costCredits.subtitle}
                                />
                                <ReportTable spec={model.costCredits} />
                            </div>
                        )}
                        {model.costWhatsapp && (
                            <div className="flex flex-col gap-3">
                                <SubHeading
                                    title={model.costWhatsapp.title}
                                    note={model.costWhatsapp.subtitle}
                                />
                                {whatsappCostFailed ? (
                                    <SectionError onRetry={onRetry} />
                                ) : (
                                    <>
                                        <StatsGrid stats={model.costWhatsapp.stats} compact />
                                        {model.costWhatsappCategories &&
                                            model.costWhatsappCategories.rows.length > 0 && (
                                                <ReportTable spec={model.costWhatsappCategories} />
                                            )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                    {model.costAi && (
                        <div className="flex flex-col gap-3">
                            <SubHeading title={model.costAi.title} note={model.costAi.subtitle} />
                            <StatsGrid
                                stats={model.costAi.stats}
                                note={model.costAi.note}
                                noteHint={model.costAi.noteHint}
                            />
                        </div>
                    )}
                </div>,
                t('empty.costs')
            )}

            {data.realCost &&
                model.realCost &&
                section(
                    CurrencyDollar,
                    model.realCost.title,
                    model.realCost.subtitle,
                    'realCost',
                    false,
                    <StatsGrid stats={model.realCost.stats} />
                )}
        </div>
    );
}
