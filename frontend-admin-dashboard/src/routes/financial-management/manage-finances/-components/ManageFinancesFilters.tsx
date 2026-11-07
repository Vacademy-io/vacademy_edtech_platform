import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Input } from '@/components/ui/input';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { FilterChips } from '@/components/design-system/chips';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { FeeSearchFilterDTO } from '@/types/manage-finances';
import {
    fetchFeeTypesForInstitute,
    getFeeTypesQueryKey,
} from '@/services/manage-finances';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface ManageFinancesFiltersProps {
    filter: FeeSearchFilterDTO;
    onFilterChange: (filter: FeeSearchFilterDTO) => void;
    onClearFilters: () => void;
    selectedSessionId: string;
}

const buildStatusOptions = (t: TFunction) => [
    { id: 'PAID', label: t('status.paid') },
    { id: 'PARTIAL', label: t('status.partial') },
    { id: 'PENDING', label: t('status.pending') },
    { id: 'OVERDUE', label: t('status.overdue') },
];

type FilterItem = { id: string; label: string };

export function ManageFinancesFilters({
    filter,
    onFilterChange,
    onClearFilters,
    selectedSessionId,
}: ManageFinancesFiltersProps) {
    const { t } = useTranslation('financialManagementManageFinancesFilters');
    const STATUS_OPTIONS = useMemo(() => buildStatusOptions(t), [t]);
    const { getCourseFromPackage, getAllLevels, instituteDetails } =
        useInstituteDetailsStore();

    const [searchInput, setSearchInput] = useState(filter.filters.studentSearchQuery || '');
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    // Keep a ref to the latest filter to avoid stale closures in effects
    const filterRef = useRef(filter);
    filterRef.current = filter;

    const [selectedPackages, setSelectedPackages] = useState<FilterItem[]>([]);
    const [selectedLevels, setSelectedLevels] = useState<FilterItem[]>([]);
    const [selectedFeeTypes, setSelectedFeeTypes] = useState<FilterItem[]>([]);
    const [selectedStatuses, setSelectedStatuses] = useState<FilterItem[]>(
        (filter.filters.statuses || []).map((s) => ({
            id: s,
            label: STATUS_OPTIONS.find((o) => o.id === s)?.label || s,
        }))
    );

    // Fetch fee types from API
    const { data: feeTypesData } = useQuery({
        queryKey: getFeeTypesQueryKey(),
        queryFn: fetchFeeTypesForInstitute,
        staleTime: 5 * 60 * 1000,
    });

    // Build fee type options — group by name, collect all IDs per name
    const feeTypeOptions: FilterItem[] = useMemo(() => {
        if (!feeTypesData) return [];
        const nameMap = new Map<string, string[]>();
        for (const ft of feeTypesData) {
            const ids = nameMap.get(ft.name) || [];
            ids.push(ft.id);
            nameMap.set(ft.name, ids);
        }
        // Use first ID as the FilterItem id, store all IDs joined with comma
        return Array.from(nameMap.entries()).map(([name, ids]) => ({
            id: ids.join(','),
            label: name,
        }));
    }, [feeTypesData]);

    // Debounced search
    useEffect(() => {
        debounceRef.current = setTimeout(() => {
            const current = filterRef.current;
            onFilterChange({
                ...current,
                page: 0,
                filters: {
                    ...current.filters,
                    studentSearchQuery: searchInput || undefined,
                },
            });
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [searchInput]);

    // Sync local input when filters are cleared externally
    useEffect(() => {
        if (!filter.filters.studentSearchQuery && searchInput) {
            setSearchInput('');
        }
    }, [filter.filters.studentSearchQuery]);

    // Clear local selections when external clear happens
    useEffect(() => {
        if (
            !filter.filters.statuses?.length &&
            !filter.filters.packageSessionIds?.length &&
            !filter.filters.feeTypeIds?.length &&
            !filter.filters.studentSearchQuery
        ) {
            setSelectedPackages([]);
            setSelectedLevels([]);
            setSelectedFeeTypes([]);
            setSelectedStatuses([]);
        }
    }, [filter.filters]);

    // Build package options from store
    const packageOptions: FilterItem[] = useMemo(() => {
        const courses = getCourseFromPackage({});
        return courses.map((c) => ({
            id: c.id,
            label: c.name || c.id,
        }));
    }, [getCourseFromPackage]);

    const levelOptions: FilterItem[] = useMemo(() => {
        return getAllLevels().map((l: any) => ({
            id: l.id,
            label: l.level_name || l.id,
        }));
    }, [getAllLevels]);

    // Handle status changes
    const handleStatusSelect = (option: FilterItem) => {
        const exists = selectedStatuses.some((s) => s.id === option.id);
        const updated = exists
            ? selectedStatuses.filter((s) => s.id !== option.id)
            : [...selectedStatuses, option];
        setSelectedStatuses(updated);
        const current = filterRef.current;
        onFilterChange({
            ...current,
            page: 0,
            filters: {
                ...current.filters,
                statuses: updated.map((s) => s.id),
            },
        });
    };

    const handlePackageSelect = (option: FilterItem) => {
        setSelectedPackages((prev) => {
            const exists = prev.some((p) => p.id === option.id);
            return exists ? prev.filter((p) => p.id !== option.id) : [...prev, option];
        });
    };

    const handleLevelSelect = (option: FilterItem) => {
        setSelectedLevels((prev) => {
            const exists = prev.some((l) => l.id === option.id);
            return exists ? prev.filter((l) => l.id !== option.id) : [...prev, option];
        });
    };

    // Handle fee type changes — send all IDs (comma-joined per option) to backend
    const handleFeeTypeSelect = (option: FilterItem) => {
        const exists = selectedFeeTypes.some((f) => f.id === option.id);
        const updated = exists
            ? selectedFeeTypes.filter((f) => f.id !== option.id)
            : [...selectedFeeTypes, option];
        setSelectedFeeTypes(updated);

        // Flatten all comma-joined IDs into a single array
        const allFeeTypeIds = updated.flatMap((f) => f.id.split(','));
        const current = filterRef.current;
        onFilterChange({
            ...current,
            page: 0,
            filters: {
                ...current.filters,
                feeTypeIds: allFeeTypeIds.length > 0 ? allFeeTypeIds : undefined,
            },
        });
    };

    // When package/level/session selection changes, compute matching packageSessionIds
    useEffect(() => {
        const current = filterRef.current;

        if (
            selectedPackages.length === 0 &&
            selectedLevels.length === 0 &&
            !selectedSessionId
        ) {
            if (current.filters.packageSessionIds?.length) {
                onFilterChange({
                    ...current,
                    page: 0,
                    filters: { ...current.filters, packageSessionIds: [] },
                });
            }
            return;
        }

        const batches = instituteDetails?.batches_for_sessions || [];
        const matchingIds = batches
            .filter((batch: any) => {
                const pkgMatch =
                    selectedPackages.length === 0 ||
                    selectedPackages.some((p) => p.id === batch.package_dto?.id);
                const lvlMatch =
                    selectedLevels.length === 0 ||
                    selectedLevels.some((l) => l.id === batch.level?.id);
                const sessMatch =
                    !selectedSessionId || batch.session?.id === selectedSessionId;
                return pkgMatch && lvlMatch && sessMatch;
            })
            .map((batch: any) => batch.id);

        onFilterChange({
            ...current,
            page: 0,
            filters: { ...current.filters, packageSessionIds: matchingIds },
        });
    }, [selectedPackages, selectedLevels, selectedSessionId]);

    const hasActiveFilters =
        !!filter.filters.studentSearchQuery ||
        selectedStatuses.length > 0 ||
        selectedPackages.length > 0 ||
        selectedLevels.length > 0 ||
        selectedFeeTypes.length > 0;

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
            <div className="flex items-center gap-3">
                {/* Search input */}
                <div className="relative w-64 flex-shrink-0">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <MagnifyingGlass className="h-4 w-4 text-gray-400" />
                    </div>
                    <Input
                        type="search"
                        placeholder={t('searchPlaceholder')}
                        className="pl-9 h-8 rounded-lg border-gray-300 bg-gray-50 text-sm font-medium text-gray-700 focus:border-blue-500 hover:bg-white"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                </div>

                {/* Package filter */}
                <FilterChips
                    label={getTerminology(ContentTerms.Package, SystemTerms.Package)}
                    filterList={packageOptions}
                    selectedFilters={selectedPackages}
                    handleSelect={handlePackageSelect}
                    handleClearFilters={() => setSelectedPackages([])}
                />

                {/* Fee Type filter */}
                <FilterChips
                    label={t('feeType')}
                    filterList={feeTypeOptions}
                    selectedFilters={selectedFeeTypes}
                    handleSelect={handleFeeTypeSelect}
                    handleClearFilters={() => {
                        setSelectedFeeTypes([]);
                        const current = filterRef.current;
                        onFilterChange({
                            ...current,
                            page: 0,
                            filters: { ...current.filters, feeTypeIds: undefined },
                        });
                    }}
                />

                {/* Status filter */}
                <FilterChips
                    label={t('status.label')}
                    filterList={STATUS_OPTIONS}
                    selectedFilters={selectedStatuses}
                    handleSelect={handleStatusSelect}
                    handleClearFilters={() => {
                        setSelectedStatuses([]);
                        const current = filterRef.current;
                        onFilterChange({
                            ...current,
                            page: 0,
                            filters: { ...current.filters, statuses: [] },
                        });
                    }}
                />

                {/* Level filter */}
                <FilterChips
                    label={getTerminology(ContentTerms.Level, SystemTerms.Level)}
                    filterList={levelOptions}
                    selectedFilters={selectedLevels}
                    handleSelect={handleLevelSelect}
                    handleClearFilters={() => setSelectedLevels([])}
                />

                {/* Spacer + Clear all */}
                <div className="flex-1" />
                {hasActiveFilters && (
                    <button
                        onClick={() => {
                            setSelectedPackages([]);
                            setSelectedLevels([]);
                            setSelectedFeeTypes([]);
                            setSelectedStatuses([]);
                            setSearchInput('');
                            onClearFilters();
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition flex-shrink-0"
                    >
                        <X size={12} weight="bold" />
                        {t('clearAll')}
                    </button>
                )}
            </div>
        </div>
    );
}
