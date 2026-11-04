import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNamingSettingsVersion } from '@/hooks/useNamingSettingsVersion';
import type { EngagementDiagnosis } from '@/services/engagement-diagnosis';
import { buildChannelMeta } from '../../-constants';
import type { ChannelKey } from '../../-types';
import {
    buildProblemRows,
    capProblems,
    PROBLEM_LIMIT,
    type ProblemRowView,
} from './diagnosis-problems';
import {
    buildGapNotes,
    buildStageLines,
    panelState,
    type PanelState,
    type StageLine,
} from './diagnosis-stages';
import { buildWeeklyModel, type WeeklyModel, type WeeklyTracking } from './diagnosis-weekly';
import { humanizeKey } from './report-format';
import { makeReportLinks } from './report-links';
import type { ReportCtx } from './report-tables';
import { reportTerms } from './report-terms';

export interface DiagnosisViewModel {
    state: PanelState;
    problems: ProblemRowView[];
    /** Problems the server's cap cut. */
    moreProblems: number;
    stages: StageLine[];
    /** Short notes on what the report cannot see. */
    gaps: string[];
    /** Weekly only. */
    weekly: WeeklyModel | null;
    ctx: ReportCtx;
}

/** What this week's tables cannot show, from the diagnosis's own data gaps and the report's. */
export const trackingOf = (
    d: Pick<EngagementDiagnosis, 'dataGaps'>,
    emailRepliesTracked: boolean | undefined
): WeeklyTracking => ({
    emailDeliveryOff: d.dataGaps.some((g) => g.code === 'EMAIL_TRACKING_OFF'),
    whatsappDeliveryOff: d.dataGaps.some((g) => g.code === 'WHATSAPP_TRACKING_OFF'),
    // The week's report says so only when it covers every sender; a partial gap is a note, not a mask.
    emailRepliesOff: emailRepliesTracked === false,
});

/**
 * Everything the daily panel and the weekly page show for one diagnosis, in the active language
 * and the institute's own terms. Built once per response; null until there is one.
 */
export function useDiagnosisView(
    diagnosis: EngagementDiagnosis | undefined,
    options: { emailRepliesTracked?: boolean } = {}
): DiagnosisViewModel | null {
    const { t } = useTranslation('engagementDailyReport');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const namingVersion = useNamingSettingsVersion();
    // The terms are read from storage, so the version is what tells us they changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const terms = useMemo(() => reportTerms(), [namingVersion]);
    const { emailRepliesTracked } = options;

    return useMemo(() => {
        if (!diagnosis) return null;
        const channels = buildChannelMeta(tConstants);
        const channelLabel = (channel: string) =>
            channels[channel as ChannelKey]?.label ?? humanizeKey(channel);
        const links = makeReportLinks(diagnosis.engineId, {
            from: diagnosis.from,
            to: diagnosis.to,
        });
        const ctx: ReportCtx = { t, channelLabel, terms, links };
        return {
            state: panelState(diagnosis),
            ...capProblems(
                buildProblemRows(diagnosis.problems, { t, links }),
                diagnosis.moreProblems,
                PROBLEM_LIMIT[diagnosis.view]
            ),
            stages: buildStageLines(diagnosis.stages, diagnosis.problems, t),
            gaps: buildGapNotes(diagnosis.dataGaps, diagnosis.errors, t),
            weekly: diagnosis.weekly
                ? buildWeeklyModel(diagnosis.weekly, ctx, {
                      problems: diagnosis.problems,
                      tracking: trackingOf(diagnosis, emailRepliesTracked),
                      timezone: diagnosis.timezone,
                      engineId: diagnosis.engineId,
                  })
                : null,
            ctx,
        };
    }, [diagnosis, emailRepliesTracked, t, tConstants, terms]);
}
