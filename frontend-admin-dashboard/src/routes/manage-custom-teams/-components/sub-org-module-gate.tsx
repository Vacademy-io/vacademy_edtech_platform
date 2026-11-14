/**
 * Route guard for the Sub-Organizations (Channel Partners) module.
 *
 * Neither /manage-custom-teams nor the per-sub-org drilldown had any route-level
 * check — they were reachable by URL for any signed-in user, with only the
 * sidebar hiding them. Now that a non-admin role can be granted the module from
 * Display Settings, the same toggle gates the route: admins always pass, everyone
 * else needs `subOrganizations.moduleEnabled` on their role.
 *
 * This is a UI gate. Row-level visibility is enforced server-side from the
 * caller's sub-org assignments, so a user who slips past this still cannot read a
 * channel partner that isn't assigned to them.
 */
import type { ReactNode } from 'react';
import { Buildings } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { isSubOrgModuleDenied } from '@/lib/display-settings/sub-org-module';

export function SubOrgModuleGate({ children }: { children: ReactNode }) {
    const { t } = useTranslation('manageCustomTeamsSubOrgModuleGate');
    const term = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);

    // Deny only when settings are resolved AND the module is off — never while
    // they're still loading, or an admin sees a denial screen that takes itself
    // back a moment later.
    if (!isSubOrgModuleDenied()) return <>{children}</>;

    return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-10 text-center">
            <Buildings className="size-8 text-neutral-400" />
            <div>
                <p className="text-subtitle font-semibold text-neutral-700">
                    {t('notEnabled', { term })}
                </p>
                <p className="text-caption text-neutral-500">{t('notEnabledHint', { term })}</p>
            </div>
        </div>
    );
}
