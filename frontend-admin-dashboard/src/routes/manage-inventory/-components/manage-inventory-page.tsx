import { useState, useMemo } from 'react';
import { LayoutGrid, List, Package, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InventoryTableView } from './inventory-table-view';
import { InventoryCardView } from './inventory-card-view';
import { InventoryFilters as InventoryFiltersComponent } from './inventory-filters';
import { InventoryStatsCards } from './inventory-stats-cards';
import {
    usePaginatedBatches,
    useBatchInventoryAvailability,
    useBatchesSummary,
} from '../-hooks/use-inventory-data';
import { InventoryFilters, ViewMode, PackageSessionInventory } from '../-types/inventory-types';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const PAGE_SIZE = 20;

const ManageInventoryPage = () => {
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    const [filters, setFilters] = useState<InventoryFilters>({});
    const [page, setPage] = useState(0);

    // Fetch paginated batches with server-side filtering
    const {
        data: batchesResponse,
        isLoading: isLoadingBatches,
        refetch: refetchBatches,
    } = usePaginatedBatches(filters, page, PAGE_SIZE);

    const batches = batchesResponse?.content ?? [];

    // Extract IDs for current page to fetch inventory
    const currentPageIds = useMemo(() => batches.map((b) => b.id), [batches]);

    // Fetch inventory for current page items only (1 API call)
    const {
        data: inventoryMap,
        isLoading: isLoadingInventory,
        refetch: refetchInventory,
    } = useBatchInventoryAvailability(currentPageIds);

    // Fetch summary for filter dropdowns
    const { data: summary } = useBatchesSummary();

    // Transform batches + inventory into display items
    const inventoryItems: PackageSessionInventory[] = useMemo(() => {
        return batches.map((batch) => {
            const inventory = inventoryMap?.[batch.id];
            return {
                id: batch.id,
                packageName: batch.package_dto.package_name,
                levelName: batch.level.level_name,
                sessionName: batch.session.session_name,
                status: batch.status,
                startTime: batch.start_time,
                maxSeats: inventory?.maxSeats ?? undefined,
                availableSlots: inventory?.availableSlots ?? undefined,
                isUnlimited: inventory?.isUnlimited ?? undefined,
                heldSlots: inventory?.heldSlots ?? undefined,
                isLoadingInventory: isLoadingInventory,
            };
        });
    }, [batches, inventoryMap, isLoadingInventory]);

    // Filter options from summary endpoint
    const filterOptions = useMemo(() => {
        if (!summary) return { courses: [], levels: [], sessions: [] };
        return {
            courses: summary.packages.map((p) => ({ id: p.id, name: p.name })),
            levels: summary.levels.map((l) => ({ id: l.id, name: l.name })),
            sessions: summary.sessions.map((s) => ({ id: s.id, name: s.name })),
        };
    }, [summary]);

    const handleFiltersChange = (newFilters: InventoryFilters) => {
        setFilters(newFilters);
        setPage(0); // Reset to first page on filter change
    };

    const handleRefresh = () => {
        refetchBatches();
        refetchInventory();
    };

    return (
        <div className="container mx-auto space-y-4 px-3 py-4 sm:px-4 sm:py-6 lg:space-y-6 lg:px-8">
            {/* Header */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                    <div className="shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-2 shadow-lg">
                        <Package className="size-5 text-white sm:size-6" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="truncate bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-xl font-bold text-transparent dark:from-white dark:to-gray-400 sm:text-2xl lg:text-3xl">
                            {`Manage ${getTerminology(OtherTerms.Inventory, SystemTerms.Inventory)}`}
                        </h1>
                        <p className="text-xs text-muted-foreground sm:text-sm">
                            {`Manage seats and capacity for your ${getTerminologyPlural(ContentTerms.Package, SystemTerms.Package).toLowerCase()} ${getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch).toLowerCase()}`}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefresh}
                        disabled={isLoadingBatches || isLoadingInventory}
                        className="gap-2"
                    >
                        <RefreshCw
                            className={`size-4 ${isLoadingBatches || isLoadingInventory ? 'animate-spin' : ''}`}
                        />
                        Refresh
                    </Button>

                    {/* View Toggle */}
                    <div className="flex items-center rounded-lg border bg-muted/50 p-1">
                        <Button
                            variant={viewMode === 'table' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => setViewMode('table')}
                            className="gap-2"
                        >
                            <List className="size-4" />
                            Table
                        </Button>
                        <Button
                            variant={viewMode === 'card' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => setViewMode('card')}
                            className="gap-2"
                        >
                            <LayoutGrid className="size-4" />
                            Cards
                        </Button>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <InventoryStatsCards />

            {/* Filters */}
            <InventoryFiltersComponent
                filters={filters}
                onFiltersChange={handleFiltersChange}
                filterOptions={filterOptions}
            />

            {/* Content */}
            {isLoadingBatches && batches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Loader2 className="text-primary mb-4 size-12 animate-spin" />
                    <p className="text-muted-foreground">Loading package sessions...</p>
                </div>
            ) : batches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="mb-4 rounded-full bg-muted p-4">
                        <Package className="size-12 text-muted-foreground" />
                    </div>
                    <h3 className="mb-2 text-lg font-semibold text-foreground">
                        No Package Sessions Found
                    </h3>
                    <p className="max-w-md text-muted-foreground">
                        {filters.levelId || filters.sessionId || filters.search
                            ? 'No results match your filters. Try adjusting your search criteria.'
                            : "You don't have any package sessions configured yet. Create package sessions to manage their inventory."}
                    </p>
                </div>
            ) : viewMode === 'table' ? (
                <InventoryTableView
                    items={inventoryItems}
                    isLoading={isLoadingInventory}
                    page={page}
                    totalPages={batchesResponse?.total_pages ?? 0}
                    totalElements={batchesResponse?.total_elements ?? 0}
                    onPageChange={setPage}
                />
            ) : (
                <InventoryCardView items={inventoryItems} isLoading={isLoadingInventory} />
            )}
        </div>
    );
};

export default ManageInventoryPage;
