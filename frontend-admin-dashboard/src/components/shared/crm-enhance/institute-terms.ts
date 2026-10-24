import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import {
    ContentTerms,
    OtherTerms,
    RoleTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';

/**
 * The institute's own names (Settings → Naming) for the things the CRM pages talk
 * about — pass into t() so no screen hard-codes "Learner", "Batch" or "Sub-Org".
 */
export const instituteTerms = () => ({
    learner: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
    learners: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
    course: getTerminology(ContentTerms.Course, SystemTerms.Course),
    courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course),
    batch: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
    batches: getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch),
    sessions: getTerminologyPlural(ContentTerms.Session, SystemTerms.Session),
    packages: getTerminologyPlural(ContentTerms.Package, SystemTerms.Package),
    inventory: getTerminology(OtherTerms.Inventory, SystemTerms.Inventory),
    subOrgs: getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg),
});
