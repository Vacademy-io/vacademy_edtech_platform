import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/**
 * The institute's own names (Settings > Naming) for the things the daily report talks
 * about. Pass these into t() as placeholders so no copy hard-codes "Batch", "Learner"
 * or "Audience List".
 */
export const reportTerms = () => ({
    ...instituteTerms(),
    list: getTerminology(OtherTerms.AudienceList, SystemTerms.AudienceList),
    lists: getTerminologyPlural(OtherTerms.AudienceList, SystemTerms.AudienceList),
});

export type ReportTerms = ReturnType<typeof reportTerms>;
