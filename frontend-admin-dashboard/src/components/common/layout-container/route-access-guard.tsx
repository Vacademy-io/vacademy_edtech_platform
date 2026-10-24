import { useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PuzzlePiece } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { readCurrentInstituteIdSafely } from '@/services/capabilities';
import { useEntitlement, useNavSnapshotStore } from '@/lib/capabilities/use-entitlement';
import { collectNavEntries, decideRouteAccess } from '@/lib/capabilities/nav-access';

/**
 * Guards every page rendered inside LayoutContainer (INSTITUTE_MODULES spec §9):
 *  - MANAGED institute, page outside the plan → "not part of your plan" page.
 *  - Any institute, every visible sidebar entry for the page locked for this
 *    role → /locked-feature (the sidebar already does this on click; a deep
 *    link, a bookmark or Recent used to walk straight past it).
 * Unknown state (capabilities loading/failed, sidebar not computed yet) allows.
 */
export function RouteAccessGuard({ children }: { children?: ReactNode }) {
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const navigate = useNavigate();
    const entitlement = useEntitlement();
    const snapshot = useNavSnapshotStore((s) => s.snapshot);
    const currentInstituteId = readCurrentInstituteIdSafely();

    const navEntries = useMemo(() => {
        if (!snapshot) return null;
        if (currentInstituteId && snapshot.instituteId !== currentInstituteId) return null;
        return collectNavEntries(snapshot.items, {
            instituteId: snapshot.instituteId,
            sidebarCategories: snapshot.sidebarCategories,
        });
    }, [snapshot, currentInstituteId]);

    const decision = useMemo(
        () => decideRouteAccess({ pathname, entitlement, navEntries }),
        [pathname, entitlement, navEntries]
    );

    const lockedLabel = decision.kind === 'locked' ? decision.label : null;
    useEffect(() => {
        if (lockedLabel === null) return;
        navigate({ to: '/locked-feature', search: { feature: lockedLabel }, replace: true });
    }, [lockedLabel, navigate]);

    if (decision.kind === 'not-in-plan') return <NotInPlanPage />;
    if (decision.kind === 'locked') return null;
    return <>{children}</>;
}

export function NotInPlanPage() {
    const { t } = useTranslation('institutePlan');
    const navigate = useNavigate();
    return (
        <div
            role="status"
            className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center"
        >
            <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100">
                <PuzzlePiece size={32} weight="duotone" className="text-neutral-500" />
            </div>
            <div className="flex max-w-md flex-col gap-2">
                <h1 className="text-h3-semibold text-neutral-800">{t('notInPlan.title')}</h1>
                <p className="text-body text-neutral-600">{t('notInPlan.description')}</p>
            </div>
            <MyButton
                type="button"
                buttonType="primary"
                scale="medium"
                onClick={() => navigate({ to: '/dashboard' })}
            >
                {t('notInPlan.cta')}
            </MyButton>
        </div>
    );
}
