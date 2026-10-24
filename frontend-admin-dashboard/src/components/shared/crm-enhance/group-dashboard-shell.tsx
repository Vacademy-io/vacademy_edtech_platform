import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Skeleton } from '@/components/ui/skeleton';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { EmptyChart } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';

export const useIsInstituteAdmin = () =>
    useMemo(() => getRolesForCurrentInstitute().includes('ADMIN'), []);

/**
 * Page frame for the admin group dashboards: heading, actions, and the admin-only,
 * loading and error states. The numbers inside cover the whole institute, so
 * anyone who is not an admin sees a short note instead.
 */
export function GroupDashboardShell({
    title,
    subtitle,
    actions,
    isAdmin,
    isLoading,
    isError,
    children,
}: {
    title: string;
    subtitle: string;
    actions?: React.ReactNode;
    isAdmin: boolean;
    isLoading: boolean;
    isError: boolean;
    children: React.ReactNode;
}) {
    const { t } = useTranslation('crmPages');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="font-medium">{title}</h1>);
    }, [setNavHeading, title]);
    return (
        <LayoutContainer>
            <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="font-semibold text-neutral-900">
                            <span className="text-h2">{title}</span>
                        </h1>
                        <p className="text-neutral-500">
                            <span className="text-body">{subtitle}</span>
                        </p>
                    </div>
                    {isAdmin && actions && <div className="flex flex-wrap gap-2">{actions}</div>}
                </div>
                {!isAdmin ? (
                    <EmptyChart text={t('groupDash.adminOnly')} className="h-32" />
                ) : isLoading ? (
                    <div className="flex flex-col gap-4">
                        <Skeleton className="h-52 rounded-xl" />
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {[0, 1, 2, 3].map((i) => (
                                <Skeleton key={i} className="h-28 rounded-xl" />
                            ))}
                        </div>
                        <Skeleton className="h-64 rounded-xl" />
                    </div>
                ) : isError ? (
                    <EmptyChart text={t('groupDash.error')} className="h-32" />
                ) : (
                    children
                )}
            </div>
        </LayoutContainer>
    );
}

/** A static row list in the shape MyTable expects (no server paging). */
export const staticTableData = <T,>(rows: T[]) => ({
    content: rows,
    total_pages: 1,
    page_no: 0,
    page_size: rows.length,
    total_elements: rows.length,
    last: true,
});

/** Backend timestamps arrive as epoch millis or ISO without a zone (UTC). */
export const toDate = (v: string | number | null | undefined): Date | null => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return new Date(v);
    const hasTz = /Z$|[+-]\d{2}:?\d{2}$/i.test(v);
    const d = new Date(hasTz ? v : `${v.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
};
