import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { AudienceInvite } from './-components/audience-invite/audience-invite';
import { LeadListEnhancedHeader } from './-components/LeadListEnhancedHeader';
import { AudienceInviteFormProvider } from './-context/useAudienceInviteFormContext';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDown, CaretUp, ChartLineUp } from '@phosphor-icons/react';
import { getInstituteId } from '@/constants/helper';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { ConversionBySourceWidget } from '@/routes/sales-dashboard/-components/ConversionBySourceWidget';
import { CallsPerDayWidget } from '@/routes/sales-dashboard/-components/CallsPerDayWidget';

const PERFORMANCE_PANEL_KEY = 'crm-leads-performance-open';

export const Route = createLazyFileRoute('/audience-manager/list/')({
    component: AudienceManagerListPage,
});

export function AudienceManagerListPage() {
    const { t } = useTranslation('audienceManagerListIndexLazy');
    const { setNavHeading } = useNavHeadingStore();
    const instituteId = getInstituteId();

    useEffect(() => {
        setNavHeading(
            t('navHeading', {
                term: getTerminologyPlural(OtherTerms.AudienceList, SystemTerms.AudienceList),
            })
        );
    }, [setNavHeading, t]);

    return (
        <AudienceInviteFormProvider>
            <LayoutContainer>
                <LeadListEnhancedHeader />
                {instituteId && <PerformanceOverview instituteId={instituteId} />}
                <AudienceInvite />
            </LayoutContainer>
        </AudienceInviteFormProvider>
    );
}

/**
 * Compact performance panel above the lead list. Mirrors the widgets on
 * /sales-dashboard and /counsellors so a CSO landing on CRM → Leads can
 * see "where conversions come from" and "how many calls is my team making
 * per day" without leaving the leads context.
 *
 * Scope is the caller's RBAC subtree (a team head sees their whole
 * downstream; a leaf member sees themselves) — handled server-side when
 * no counsellor_user_id is passed.
 *
 * Collapsed state persists in localStorage so a user who hides the panel
 * doesn't see it pop back open on every navigation.
 */
function PerformanceOverview({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('audienceManagerListIndexLazy');
    const [open, setOpen] = useState<boolean>(() => {
        if (typeof window === 'undefined') return true;
        return localStorage.getItem(PERFORMANCE_PANEL_KEY) !== '0';
    });

    function toggle() {
        const next = !open;
        setOpen(next);
        localStorage.setItem(PERFORMANCE_PANEL_KEY, next ? '1' : '0');
    }

    return (
        <section className="mb-4 rounded-lg border border-neutral-200 bg-white">
            <button
                type="button"
                onClick={toggle}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-neutral-50"
                aria-expanded={open}
            >
                <span className="flex items-center gap-2">
                    <ChartLineUp size={18} className="text-primary-600" />
                    <span className="text-h4 font-medium text-neutral-900">
                        {t('performanceOverview.title')}
                    </span>
                    <span className="hidden text-caption text-neutral-500 md:inline">
                        {t('performanceOverview.description')}
                    </span>
                </span>
                {open ? (
                    <CaretUp size={16} className="text-neutral-500" />
                ) : (
                    <CaretDown size={16} className="text-neutral-500" />
                )}
            </button>
            {open && (
                <div className="grid grid-cols-1 gap-4 border-t border-neutral-100 p-4 lg:grid-cols-2">
                    <ConversionBySourceWidget instituteId={instituteId} />
                    <CallsPerDayWidget instituteId={instituteId} />
                </div>
            )}
        </section>
    );
}
