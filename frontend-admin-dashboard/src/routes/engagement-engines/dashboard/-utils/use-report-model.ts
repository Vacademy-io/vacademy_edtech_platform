import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNamingSettingsVersion } from '@/hooks/useNamingSettingsVersion';
import type {
    DailyReportEngineOption,
    EngagementDailyReport,
} from '@/services/engagement-daily-report';
import { buildChannelMeta } from '../../-constants';
import type { ChannelKey } from '../../-types';
import { humanizeKey } from './report-format';
import { buildHealthBanners, type HealthBanner } from './report-health';
import { buildKpis, type ReportKpi } from './report-kpis';
import { buildReportModel, type ReportCtx, type ReportModel } from './report-tables';
import { reportTerms } from './report-terms';

export interface ReportView {
    ctx: ReportCtx;
    model: ReportModel;
    kpis: ReportKpi[];
    banners: HealthBanner[];
}

/** The name an engine goes by in the picker, the file names and the exports. */
export const engineDisplayName = (
    engine: DailyReportEngineOption | undefined,
    t: TFunction
): string => {
    if (!engine) return t('filter.selectedEngine');
    return engine.system ? t('filter.systemEngine') : engine.name;
};

/**
 * Everything the page and the exports show, built once per report from the response, the
 * institute's own terms and the active language.
 */
export function useReportView(data: EngagementDailyReport | undefined): ReportView | null {
    const { t } = useTranslation('engagementDailyReport');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const namingVersion = useNamingSettingsVersion();
    // The terms are read from storage, so the version is what tells us they changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const terms = useMemo(() => reportTerms(), [namingVersion]);

    return useMemo(() => {
        if (!data) return null;
        const channels = buildChannelMeta(tConstants);
        const channelLabel = (channel: string) =>
            channels[channel as ChannelKey]?.label ?? humanizeKey(channel);
        const ctx: ReportCtx = { t, channelLabel, terms };
        return {
            ctx,
            model: buildReportModel(data, ctx),
            kpis: buildKpis(data, t, channelLabel),
            banners: buildHealthBanners(data, t),
        };
    }, [data, t, tConstants, terms]);
}
