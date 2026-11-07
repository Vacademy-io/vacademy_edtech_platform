import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    getSelectedSubOrgId,
    isCallerSubOrgAdmin,
    setSelectedSubOrgId,
} from '@/lib/auth/facultyAccessUtils';
import { listAccessibleSubOrgs } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyDropdown } from '@/components/design-system/dropdown';
import { SubOrgAnalyticsPanel } from './-components/sub-org-analytics-panel';
import { SubOrgStatCards } from './-components/sub-org-stat-cards';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const Route = createLazyFileRoute('/manage-suborg-teams/')({
    component: ManageSubOrgTeams,
});

interface SubOrgItem {
    id: string;
    name: string;
}

function normaliseSubOrg(org: any, t: TFunction): SubOrgItem | null {
    const id =
        org?.sub_org_id || org?.suborgId || org?.subOrgId || org?.suborg_id || org?.id;
    const name =
        org?.name || org?.institute_name || org?.instituteName || org?.subOrgName;
    if (!id) return null;
    return {
        id,
        name:
            name ||
            t('untitledTerm', { term: getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg) }),
    };
}

/**
 * Sub-org-admin route. Lists the caller's accessible sub-orgs and mounts the
 * analytics panel in restricted (admin-payment + team) mode for the selected
 * one. Institute admins reach the same analytics surface via
 * /manage-custom-teams/sub-orgs/$subOrgSlug instead.
 *
 * Why the picker is back:
 *   - A single sub-org admin can hold FSPSSM entries against multiple sub-orgs
 *     (e.g. principal of two campuses under the same parent institute). Without
 *     a picker they were stuck on subOrgs[0] with no way to switch.
 *   - Initial selection prefers the persisted `selected_suborg_id` (so deep
 *     refresh keeps the same context as the sidebar), falling back to the first
 *     accessible sub-org.
 */
function ManageSubOrgTeams() {
    const { t } = useTranslation('manageSuborgTeamsIndexLazy');
    const instituteId = getCurrentInstituteId();
    // Institutes rename this concept via Settings → Naming (Channel Partner,
    // Branch, Franchise, VLE …); user-facing labels must follow that.
    const subOrgTerm = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);

    const { data: rawSubOrgs, isLoading } = useQuery({
        queryKey: ['sub-orgs-accessible-picker', instituteId],
        queryFn: () => listAccessibleSubOrgs(instituteId!),
        enabled: !!instituteId,
    });

    const subOrgs: SubOrgItem[] = useMemo(() => {
        const list = Array.isArray(rawSubOrgs)
            ? rawSubOrgs
            : (rawSubOrgs as any)?.content || [];
        return list.map((org: unknown) => normaliseSubOrg(org, t)).filter(Boolean) as SubOrgItem[];
    }, [rawSubOrgs, t]);

    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Pick an initial sub-org once the list resolves: persisted choice if it's
    // still valid (so sidebar branding and this page stay in sync), otherwise
    // the first accessible sub-org.
    useEffect(() => {
        if (subOrgs.length === 0) {
            setSelectedId(null);
            return;
        }
        if (selectedId && subOrgs.some((s) => s.id === selectedId)) return;
        const persisted = getSelectedSubOrgId();
        const initial =
            (persisted && subOrgs.find((s) => s.id === persisted)?.id) || subOrgs[0]!.id;
        setSelectedId(initial);
    }, [subOrgs, selectedId]);

    const selectedSubOrg = useMemo(
        () => subOrgs.find((s) => s.id === selectedId) || null,
        [subOrgs, selectedId]
    );

    // Only persist the selected sub-org for actual sub-org admins. Institute admins
    // hitting this route accidentally (the backend's listAccessibleSubOrgs returns
    // ALL sub-orgs for them, not just FSPSSM matches) would otherwise poison the
    // localStorage key and flip sidebar branding across the whole app.
    useEffect(() => {
        if (selectedSubOrg?.id && isCallerSubOrgAdmin()) {
            setSelectedSubOrgId(selectedSubOrg.id);
        }
    }, [selectedSubOrg?.id]);

    const dropdownList = useMemo(
        () => subOrgs.map((s) => ({ label: s.name, value: s.id })),
        [subOrgs]
    );

    return (
        <LayoutContainer>
            <Helmet>
                <title>
                    {selectedSubOrg ? `${selectedSubOrg.name} — ${subOrgTerm}` : subOrgTerm}
                </title>
            </Helmet>
            <div className="p-5">
                {/* Same header shape as the Manage <SubOrgs> list: title and subtitle on
                    the left, the headline figures on the right. Stacking the cards
                    full-width below pushed the tabs off a laptop screen there, and this
                    page carries the same amount of chrome. */}
                <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-md">
                        <h1 className="text-3xl font-bold text-neutral-900">
                            {selectedSubOrg?.name || subOrgTerm}
                        </h1>
                        <p className="mt-1 text-sm text-neutral-500">
                            {t('pageDescription', { term: subOrgTerm.toLowerCase() })}
                        </p>
                    </div>
                    {selectedSubOrg && <SubOrgStatCards subOrgId={selectedSubOrg.id} />}
                </div>

                {/* The switcher gets its own row rather than the header's right slot,
                    which now belongs to the cards. Only rendered when the caller actually
                    holds more than one sub-org. */}
                {subOrgs.length > 1 && (
                    <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
                        <span className="text-xs font-medium text-neutral-600">
                            {t('switchTerm', { term: subOrgTerm.toLowerCase() })}
                        </span>
                        <MyDropdown
                            dropdownList={dropdownList}
                            currentValue={selectedSubOrg?.name || ''}
                            placeholder={t('selectTermPlaceholder', { term: subOrgTerm.toLowerCase() })}
                            handleChange={(value: string) => setSelectedId(value)}
                            className="min-w-56"
                        />
                    </div>
                )}

                {isLoading ? (
                    <DashboardLoader />
                ) : !selectedSubOrg ? (
                    <div className="rounded-lg border border-warning-200 bg-warning-50 p-6 text-warning-800">
                        <p className="font-medium">
                            {t('noAccessTitle', { term: subOrgTerm.toLowerCase() })}
                        </p>
                        <p className="text-caption">
                            {t('noAccessBody', { term: subOrgTerm.toLowerCase() })}
                        </p>
                    </div>
                ) : (
                    <SubOrgAnalyticsPanel
                        key={selectedSubOrg.id}
                        subOrgId={selectedSubOrg.id}
                        subOrgName={selectedSubOrg.name}
                        restrictedView
                        variant="page"
                    />
                )}
            </div>
        </LayoutContainer>
    );
}
