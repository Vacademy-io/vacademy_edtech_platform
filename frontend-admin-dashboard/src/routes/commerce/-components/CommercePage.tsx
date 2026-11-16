import { type ReactNode, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from '@phosphor-icons/react';
import { NotInPlanPage } from '@/components/common/layout-container/route-access-guard';
import { Skeleton } from '@/components/ui/skeleton';
import type { CommerceFeatureKey, CommerceNavId } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { readCurrentInstituteIdSafely, syncCapabilitiesOnce } from '@/services/capabilities';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { CommerceNoAccessCard } from './CommerceStates';

interface CommerceGateProps {
    /** The sidebar entry this screen belongs to; its rule decides feature and role. */
    navId: CommerceNavId;
    /**
     * Extra features this screen needs beyond its sidebar entry (ANY of them),
     * for a Settings page whose endpoints check one feature: locations need
     * `commerce.stock`, the PIN needs `commerce.pos`.
     */
    anyFeature?: readonly CommerceFeatureKey[];
    children: ReactNode;
}

/**
 * The gate every commerce screen renders through. The sidebar already hides what
 * the person cannot open; this covers the deep link, the bookmark and Recent.
 *  - Feature off (the institute does not have it): the locked page.
 *  - Feature on but the role does not see the screen: "no access".
 * The commerce feature reader fails closed, so while `/capabilities/me` is still
 * on its way the answer is "off"; a skeleton is shown for that moment instead of
 * flashing the locked page at a shop that does have the module.
 *
 * A courtesy, not a control: every endpoint behind these screens runs
 * CommerceAccessGuard and refuses regardless.
 */
export function CommerceGate({ navId, anyFeature, children }: CommerceGateProps) {
    const access = useCommerceAccess();

    useEffect(() => {
        // Normally already fetched with the institute details; a no-op then.
        void syncCapabilitiesOnce(readCurrentInstituteIdSafely());
    }, []);

    if (!access.isResolved) {
        return (
            <div className="flex flex-col gap-4 p-4" aria-busy="true">
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-32 w-full" />
            </div>
        );
    }
    const denial = access.denialFor(navId);
    const extraFeatureOff =
        !!anyFeature && anyFeature.length > 0 && !anyFeature.some(access.isFeatureOn);
    if (denial === 'feature' || extraFeatureOff) return <NotInPlanPage />;
    if (denial === 'role') return <CommerceNoAccessCard className="mt-8" />;
    return <>{children}</>;
}

interface CommercePageProps extends CommerceGateProps {
    title: string;
    description?: string;
    /** Shows a "back" link above the title (Settings sub-pages). */
    backTo?: { to: string; label: string };
    /** Right side of the header: the page's one primary action. */
    actions?: ReactNode;
}

/**
 * Page frame for a commerce screen inside LayoutContainer: browser title, the
 * top-bar heading, the gate, then a header row and the content.
 */
export function CommercePage({
    navId,
    anyFeature,
    title,
    description,
    backTo,
    actions,
    children,
}: CommercePageProps) {
    const { t } = useTranslation('commerce');
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{title}</h1>);
    }, [setNavHeading, title]);

    return (
        <>
            <Helmet>
                <title>{t('meta.pageTitle', { title })}</title>
                {description && <meta name="description" content={description} />}
            </Helmet>
            <CommerceGate navId={navId} anyFeature={anyFeature}>
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        {backTo && (
                            <Link
                                to={backTo.to as never}
                                className="flex w-fit items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
                            >
                                <ArrowLeft size={14} className="rtl:rotate-180" />
                                {backTo.label}
                            </Link>
                        )}
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex max-w-2xl flex-col gap-1">
                                <h2 className="text-h3 font-medium text-foreground">{title}</h2>
                                {description && (
                                    <p className="text-body text-muted-foreground">{description}</p>
                                )}
                            </div>
                            {actions && (
                                <div className="flex flex-wrap items-center gap-2">{actions}</div>
                            )}
                        </div>
                    </div>
                    {children}
                </div>
            </CommerceGate>
        </>
    );
}
