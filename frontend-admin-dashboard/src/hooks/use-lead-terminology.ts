import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLeadSettings } from './use-lead-settings';

/**
 * useLeadTerminology — what this institute calls the built-in lead attributes.
 *
 * "Tier", "Lead status" and "Campaign type" are platform concepts, but institutes
 * migrating from other CRMs know them by their own names (Eduzilla: "Interest
 * Level" / "Action Label"; I2CAN calls the campaign type "Source"). Admins set the
 * names in Lead Settings → Terminology; this hook resolves them with the translated
 * default as fallback so table headers, filters, chips, CSV exports, the lead side
 * view and the settings screens all agree.
 */
export interface LeadTerminology {
    /** Label for the lead tier attribute (default "Tier"). */
    tier: string;
    /** Label for the lead pipeline status attribute (default "Lead status"). */
    leadStatus: string;
    /** Label for the audience's channel attribute (default "Campaign type"). */
    campaignType: string;
    /** Label for the audience a lead arrived through (default "Audience"). */
    leadSource: string;
    isLoading: boolean;
}

export const DEFAULT_TIER_LABEL = 'Tier';
export const DEFAULT_LEAD_STATUS_LABEL = 'Lead status';
export const DEFAULT_CAMPAIGN_TYPE_LABEL = 'Campaign type';
export const DEFAULT_LEAD_SOURCE_LABEL = 'Audience';

export function useLeadTerminology(options?: { skip?: boolean }): LeadTerminology {
    const { labels, isLoading } = useLeadSettings(options);
    const { t } = useTranslation('leadTerminology');
    return useMemo(
        () => ({
            tier: labels?.tier?.trim() || t('tier', { defaultValue: DEFAULT_TIER_LABEL }),
            leadStatus:
                labels?.leadStatus?.trim() ||
                t('leadStatus', { defaultValue: DEFAULT_LEAD_STATUS_LABEL }),
            campaignType:
                labels?.campaignType?.trim() ||
                t('campaignType', { defaultValue: DEFAULT_CAMPAIGN_TYPE_LABEL }),
            leadSource:
                labels?.leadSource?.trim() ||
                t('leadSource', { defaultValue: DEFAULT_LEAD_SOURCE_LABEL }),
            isLoading,
        }),
        [labels?.tier, labels?.leadStatus, labels?.campaignType, labels?.leadSource, isLoading, t]
    );
}
