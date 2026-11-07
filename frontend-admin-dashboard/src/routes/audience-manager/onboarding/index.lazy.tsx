import { useMemo, useState } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { cn } from '@/lib/utils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { OnboardingFlowsPage } from './-components/onboarding-flows-page';
import { OnboardingDashboardPage } from './-components/onboarding-dashboard-page';
import { getTokenFromCookie, getTokenDecodedData } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';

/**
 * Building flows is admin-only server-side; working the instances on them is not — a role a
 * step's access grid names (a COUNSELLOR, a custom role) reaches the Dashboard but would get a
 * 403 from every builder call. So non-admins are shown the Dashboard only.
 *
 * Deliberately case-INSENSITIVE, unlike `isUserAdmin()`: role_id 1 is spelled "Admin" in some
 * institutes, and the backend's own admin test is equalsIgnoreCase — matching it here keeps an
 * admin from being shown the counsellor view.
 */
function callerIsInstituteAdmin(instituteId: string): boolean {
    try {
        const tokenData = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
        const roles: string[] = tokenData?.authorities?.[instituteId]?.roles ?? [];
        return roles.some((role) => String(role).trim().toUpperCase() === 'ADMIN');
    } catch {
        return false;
    }
}

export const Route = createLazyFileRoute('/audience-manager/onboarding/')({
    component: OnboardingRoute,
});

type OnboardingTab = 'flows' | 'dashboard';

function OnboardingRoute() {
    const { t } = useTranslation('audienceManagerOnboardingIndexLazy');
    const { instituteDetails } = useInstituteDetailsStore();
    const instituteId = instituteDetails?.id ?? '';
    const isAdmin = useMemo(() => callerIsInstituteAdmin(instituteId), [instituteId]);

    const [tab, setTab] = useState<OnboardingTab>(isAdmin ? 'flows' : 'dashboard');

    const tabs = (
        isAdmin
            ? [
                  { id: 'flows', label: t('tabs.flows') },
                  { id: 'dashboard', label: t('tabs.dashboard') },
              ]
            : [{ id: 'dashboard', label: t('tabs.dashboard') }]
    ) as ReadonlyArray<{ id: OnboardingTab; label: string }>;

    return (
        <LayoutContainer>
            <div className="flex flex-col gap-2 p-2">
                <div
                    role="tablist"
                    aria-label={t('tablistAriaLabel')}
                    className="flex gap-1 border-b border-neutral-200 px-2"
                >
                    {tabs.map((tabItem) => (
                        <button
                            key={tabItem.id}
                            type="button"
                            role="tab"
                            aria-selected={tab === tabItem.id}
                            onClick={() => setTab(tabItem.id)}
                            className={cn(
                                'rounded-t-md px-3.5 py-2 text-body font-medium transition-colors',
                                tab === tabItem.id
                                    ? 'border-b-2 border-primary-500 text-primary-600'
                                    : 'text-neutral-500 hover:text-neutral-800'
                            )}
                        >
                            {tabItem.label}
                        </button>
                    ))}
                </div>
                {tab === 'flows' && isAdmin ? (
                    <OnboardingFlowsPage />
                ) : (
                    <OnboardingDashboardPage instituteId={instituteId} />
                )}
            </div>
        </LayoutContainer>
    );
}
