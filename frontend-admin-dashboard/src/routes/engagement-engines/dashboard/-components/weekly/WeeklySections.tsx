import type { ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { EnvelopeSimple, PhoneCall, Robot, Target, WhatsappLogo } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/design-system/status-chips';
import type { DiagnosisStageKey, EngagementDiagnosis } from '@/services/engagement-diagnosis';
import { stageRow, stageStatusKey, type StageLine } from '../../-utils/diagnosis-stages';
import type { ReportTableSpec } from '../../-utils/report-tables';
import type { DiagnosisViewModel } from '../../-utils/use-diagnosis-view';
import { ReportSection } from '../daily-report/ReportSection';
import { ReportTable } from '../daily-report/ReportTable';
import { StatsGrid } from '../daily-report/StatsGrid';
import { CallHoursChart } from './CallHoursChart';

const STAGE_ICON: Record<DiagnosisStageKey, Icon> = {
    LEADS: Target,
    CALLING: PhoneCall,
    WHATSAPP: WhatsappLogo,
    EMAIL: EnvelopeSimple,
    ENGINE: Robot,
};

/** A titled part of a stage's card, with an optional line under the title. */
function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-2">
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
            {children}
        </div>
    );
}

/** A table, or a short note when the week had nothing for it. */
function TableBlock<R>({
    spec,
    empty,
    maxRows,
}: {
    spec: ReportTableSpec<R>;
    empty: string;
    maxRows?: number;
}) {
    return (
        <Block title={spec.title} note={spec.subtitle}>
            {spec.rows.length > 0 ? (
                <ReportTable spec={spec} maxRows={maxRows} />
            ) : (
                <Muted text={empty} />
            )}
        </Block>
    );
}

function Muted({ text }: { text: string }) {
    return (
        <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-3 text-neutral-500">
            <span className="text-caption">{text}</span>
        </p>
    );
}

interface WeeklySectionsProps {
    diagnosis: EngagementDiagnosis;
    view: DiagnosisViewModel;
    onRetry: () => void;
}

/**
 * One card per stage of the chain with the week's detail. A stage whose data could not be read
 * shows that instead of tables, so a missing table is never mistaken for "nothing happened".
 */
export function WeeklySections({ diagnosis, view, onRetry }: WeeklySectionsProps) {
    const { t } = useTranslation('engagementDailyReport');
    const { weekly } = diagnosis;
    const model = view.weekly;

    const section = (stage: DiagnosisStageKey, isEmpty: boolean, children: ReactNode) => {
        const row = stageRow(diagnosis.stages, stage);
        const line: StageLine | undefined = view.stages.find((s) => s.stage === stage);
        const unavailable = !!row && stageStatusKey(row.status) === 'UNAVAILABLE';
        return (
            <ReportSection
                key={stage}
                icon={STAGE_ICON[stage]}
                title={t(`diagnosis.stage.${stage}`)}
                subtitle={t(`diagnosis.weekly.section.${stage}`)}
                right={
                    line && (
                        <StatusChip
                            text={line.statusLabel}
                            textSize="text-caption"
                            status={line.chip.type}
                            showIcon={line.chip.icon}
                        />
                    )
                }
                hasError={unavailable || !weekly || !model}
                isEmpty={isEmpty}
                emptyText={t(`diagnosis.weekly.empty.${stage}`)}
                onRetry={onRetry}
            >
                {children}
            </ReportSection>
        );
    };

    if (!weekly || !model) {
        // The response had no weekly part at all: every stage says so, none shows an empty table.
        return (
            <div className="flex flex-col gap-4">
                {(['LEADS', 'CALLING', 'WHATSAPP', 'EMAIL', 'ENGINE'] as const).map((stage) =>
                    section(stage, false, null)
                )}
            </div>
        );
    }

    const calls = weekly.callHours.length === 0 && (weekly.callLengths?.connected ?? 0) === 0;
    const insights = weekly.callInsights;
    const analysed = (insights?.analysed ?? 0) > 0;

    return (
        <div className="flex flex-col gap-4">
            {section(
                'LEADS',
                weekly.leadSources.length === 0,
                <ReportTable spec={model.sources} />
            )}

            {section(
                'CALLING',
                calls && !analysed,
                <div className="flex flex-col gap-6">
                    <Block title={model.callHours.title} note={model.callHours.subtitle}>
                        {weekly.callHours.length > 0 ? (
                            <>
                                <CallHoursChart
                                    rows={weekly.callHours}
                                    minimum={weekly.minimums.callsPerHour}
                                />
                                <ReportTable spec={model.callHours} maxRows={24} />
                            </>
                        ) : (
                            <Muted text={t('diagnosis.weekly.empty.CALLING')} />
                        )}
                    </Block>
                    {model.callLengths && (
                        <TableBlock
                            spec={model.callLengths}
                            empty={t('diagnosis.weekly.lengths.empty')}
                        />
                    )}
                    {model.callStats && (
                        <Block title={model.callStats.title} note={model.callStats.subtitle}>
                            {analysed ? (
                                <StatsGrid stats={model.callStats.stats} />
                            ) : (
                                <Muted text={t('diagnosis.weekly.insights.empty')} />
                            )}
                        </Block>
                    )}
                    {analysed && (
                        <div className="grid gap-6 lg:grid-cols-2">
                            {model.callOutcomes && (
                                <TableBlock
                                    spec={model.callOutcomes}
                                    empty={t('diagnosis.weekly.insights.empty')}
                                />
                            )}
                            {model.objections && (
                                <TableBlock
                                    spec={model.objections}
                                    empty={t('diagnosis.weekly.insights.noObjections')}
                                />
                            )}
                        </div>
                    )}
                </div>
            )}

            {section(
                'WHATSAPP',
                weekly.whatsappFailures.length === 0 && weekly.whatsappTemplates.length === 0,
                <div className="flex flex-col gap-6">
                    <TableBlock
                        spec={model.whatsappTemplates}
                        empty={t('diagnosis.weekly.templates.empty')}
                    />
                    <TableBlock
                        spec={model.whatsappFailures}
                        empty={t('diagnosis.weekly.failures.empty')}
                    />
                </div>
            )}

            {section(
                'EMAIL',
                weekly.emailSubjects.length === 0,
                <ReportTable spec={model.emailSubjects} />
            )}

            {section(
                'ENGINE',
                false,
                <div className="flex flex-col gap-6">
                    {model.engineChecks && (
                        <Block title={model.engineChecks.title} note={model.engineChecks.subtitle}>
                            <StatsGrid stats={model.engineChecks.stats} />
                        </Block>
                    )}
                    <TableBlock
                        spec={model.promptChanges}
                        empty={t('diagnosis.weekly.prompts.empty')}
                        maxRows={5}
                    />
                </div>
            )}
        </div>
    );
}
