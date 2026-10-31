import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { PackageStatusCounts } from './PackageStatusCounts';
import { MyButton } from '@/components/design-system/button';
import { CountChip, ScreenHeader } from '@/components/shared/crm-enhance/screen-header';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { DashboardLoader, ErrorBoundary } from '@/components/core/dashboard-loader';
import { SmartErrorPage } from '@/components/core/SmartErrorPage';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { Package, Rows, SealPercent } from '@phosphor-icons/react';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { usePackageFilters } from '../-hooks/usePackageFilters';
import { usePackageTable, useBatchesSummary } from '../-hooks/usePackageTable';
import { PackageFilters } from './package-filters';
import { getPackageTableColumns, PACKAGE_TABLE_COLUMN_WIDTHS } from './package-table';
import { PackageSessionSidebar } from './package-session-sidebar';
import { PackageSessionDTO } from '../-types/package-types';

export function PackageManagementSection() {
    const { t } = useTranslation('adminPackageManagement');
    const navigate = useNavigate();
    const { setNavHeading } = useNavHeadingStore();
    const isMobile = useIsMobile();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [selectedPackage, setSelectedPackage] = useState<{ id: string; name: string } | null>(
        null
    );
    const tableRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setNavHeading(
            <h1 className="text-lg">
                {t('title', { package: getTerminology(ContentTerms.Package, SystemTerms.Package) })}
            </h1>
        );
    }, [setNavHeading, t]);

    useEffect(() => {
        // On mobile the sidebar renders as a Sheet in a portal — outside `tableRef`.
        // The Sheet handles its own backdrop dismiss, and running this handler
        // would close it immediately on any tap inside the sheet.
        if (isMobile) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (
                tableRef.current &&
                !tableRef.current.contains(event.target as Node) &&
                isSidebarOpen
            ) {
                setIsSidebarOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isSidebarOpen, isMobile]);

    const {
        columnFilters,
        appliedFilters,
        clearFilters,
        searchInput,
        searchFilter,
        page,
        getActiveFiltersState,
        handleFilterChange,
        handleFilterClick,
        handleClearFilters,
        handleSearchInputChange,
        handleSearchEnter,
        handleClearSearch,
        handlePageChange,
        handleSort,
    } = usePackageFilters();

    const { packageData, isLoading, error } = usePackageTable(appliedFilters);
    const { summaryData, isLoading: summaryLoading } = useBatchesSummary(appliedFilters.statuses);

    const handlePackageClick = (packageInfo: { id: string; name: string }) => {
        setSelectedPackage(packageInfo);
        setIsSidebarOpen(true);
    };

    const columns = getPackageTableColumns({ onPackageClick: handlePackageClick });
    const packageTerm = getTerminology(ContentTerms.Package, SystemTerms.Package);
    const packagesTerm = getTerminologyPlural(ContentTerms.Package, SystemTerms.Package);

    if (error) return <SmartErrorPage />;

    const EmptyState = () => (
        <div className="animate-fadeIn flex flex-col items-center justify-center px-3 py-8 text-center">
            <div className="mb-3 rounded-full bg-gradient-to-br from-neutral-100 to-neutral-200 p-3 shadow-inner">
                <Package className="size-12 opacity-50" />
            </div>
            <h3 className="mb-2 text-base font-semibold text-neutral-700">
                {t('empty.title', { packages: packagesTerm })}
            </h3>
            <p className="mb-4 max-w-md text-xs leading-relaxed text-neutral-500">
                {t('empty.text', { packages: packagesTerm.toLowerCase() })}
            </p>
            <MyButton buttonType="secondary" scale="medium" onClick={handleClearFilters}>
                {t('empty.clear')}
            </MyButton>
        </div>
    );

    return (
        <ErrorBoundary>
            <section className="animate-fadeIn flex max-w-full flex-col gap-4 overflow-visible">
                <ScreenHeader
                    icon={Package}
                    title={t('title', { package: packageTerm })}
                    badge={
                        summaryData?.packages ? (
                            <CountChip>
                                {t('badge', {
                                    count: summaryData.packages.length,
                                    packages: packagesTerm.toLocaleLowerCase(),
                                })}
                            </CountChip>
                        ) : null
                    }
                    subtitle={t('subtitle', {
                        packages: packagesTerm.toLocaleLowerCase(),
                        batch: getTerminology(
                            ContentTerms.Batch,
                            SystemTerms.Batch
                        ).toLocaleLowerCase(),
                    })}
                    actions={
                        <>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                className="gap-2"
                                onClick={() => navigate({ to: '/admin-package-management/offers' })}
                            >
                                <SealPercent size={18} />
                                {t('actions.offers')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                className="gap-2"
                                onClick={() =>
                                    navigate({ to: '/admin-package-management/bulk-create' })
                                }
                            >
                                <Rows size={18} />
                                {t('actions.bulkCreate')}
                            </MyButton>
                        </>
                    }
                />
                <PackageStatusCounts activeStatuses={appliedFilters.statuses} />
                <div className="flex flex-col gap-3">
                    <PackageFilters
                        summaryData={summaryData}
                        searchInput={searchInput}
                        searchFilter={searchFilter}
                        columnFilters={columnFilters}
                        clearFilters={clearFilters}
                        appliedFilters={appliedFilters}
                        totalElements={packageData?.total_elements || 0}
                        getActiveFiltersState={getActiveFiltersState}
                        onSearchChange={handleSearchInputChange}
                        onSearchEnter={handleSearchEnter}
                        onClearSearch={handleClearSearch}
                        onFilterChange={handleFilterChange}
                        onFilterClick={handleFilterClick}
                        onClearFilters={handleClearFilters}
                        onSort={handleSort}
                    />

                    {isLoading || summaryLoading ? (
                        <div className="flex w-full flex-col items-center gap-2 py-6">
                            <DashboardLoader />
                            <p className="animate-pulse text-xs text-neutral-500">
                                {t('loading', { packages: packagesTerm.toLowerCase() })}
                            </p>
                        </div>
                    ) : !packageData || packageData.content.length === 0 ? (
                        <EmptyState />
                    ) : (
                        <div className="animate-slideInRight flex flex-col gap-2">
                            <div className="overflow-hidden rounded-lg border border-neutral-200/50 bg-gradient-to-br from-white to-neutral-50/30 shadow-sm">
                                <div className="max-w-full" ref={tableRef}>
                                    <SidebarProvider
                                        style={{ ['--sidebar-width' as string]: '450px' }}
                                        defaultOpen={false}
                                        open={isSidebarOpen}
                                        onOpenChange={setIsSidebarOpen}
                                    >
                                        <MyTable<PackageSessionDTO>
                                            data={{
                                                content: packageData.content,
                                                total_pages: packageData.total_pages,
                                                page_no: packageData.page_number,
                                                page_size: packageData.page_size,
                                                total_elements: packageData.total_elements,
                                                last: packageData.last,
                                            }}
                                            columns={columns}
                                            isLoading={isLoading}
                                            error={error}
                                            columnWidths={PACKAGE_TABLE_COLUMN_WIDTHS}
                                            currentPage={page}
                                        />
                                        <PackageSessionSidebar selectedPackage={selectedPackage} />
                                    </SidebarProvider>
                                </div>
                            </div>

                            <div className="flex flex-col justify-between gap-2 rounded-lg border border-neutral-200/50 bg-gradient-to-r from-neutral-50/50 to-white px-3 py-2 lg:flex-row lg:items-center">
                                <div className="text-sm text-neutral-500">
                                    {t('showing', {
                                        from: packageData.page_size * packageData.page_number + 1,
                                        to: Math.min(
                                            packageData.page_size * (packageData.page_number + 1),
                                            packageData.total_elements
                                        ),
                                        total: packageData.total_elements,
                                        packages: packagesTerm.toLowerCase(),
                                    })}
                                </div>
                                <div className="flex justify-center lg:justify-end">
                                    <MyPagination
                                        currentPage={page}
                                        totalPages={packageData.total_pages}
                                        onPageChange={handlePageChange}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </section>
        </ErrorBoundary>
    );
}
