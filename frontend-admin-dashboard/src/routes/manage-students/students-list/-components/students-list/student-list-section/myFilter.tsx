import { FilterChips } from '@/components/design-system/chips';
import {
    FilterProps,
} from '@/routes/manage-students/students-list/-types/students-list-types';
import { useEffect, useState } from 'react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { PACKAGE_AUTOCOMPLETE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useSearch } from '@tanstack/react-router';
import { removeDefaultPrefix } from '@/utils/helpers/removeDefaultPrefix';

type SelectedFilterListType = Record<string, { id: string; label: string }[]>;

export const Filters = ({
    filterDetails,
    onFilterChange,
    clearFilters,
    filterId,
    columnFilters,
}: FilterProps) => {
    const [selectedFilterList, setSelectedFilterList] = useState<SelectedFilterListType>({});
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [dynamicFilterList, setDynamicFilterList] = useState<{ id: string; label: string }[]>(filterDetails.filters || []);
    const INSTITUTE_ID = getCurrentInstituteId();
    const searchParams = useSearch({ strict: false }) as Record<string, any>;

    // Sync local state with parent columnFilters
    useEffect(() => {
        const existingFilter = columnFilters?.find((filter) => filter.id === filterId);
        if (existingFilter) {
            const uniqueValues = Array.from(
                new Map(existingFilter.value.map(v => [v.id, v])).values()
            );
            setSelectedFilterList((prev) => ({
                ...prev,
                [filterId]: uniqueValues,
            }));
        } else if (clearFilters) {
            setSelectedFilterList((prev) => ({
                ...prev,
                [filterId]: [],
            }));
        }
    }, [columnFilters, filterId, clearFilters]);

    // Async search for batch
    useEffect(() => {
        if (filterId !== 'batch') {
            setDynamicFilterList(filterDetails.filters || []);
            return;
        }

        // Only fetch if open and we have search input
        if (!isOpen || searchTerm.length === 0) {
            if (searchTerm.length === 0) {
                setDynamicFilterList(filterDetails.filters || []);
            }
            return;
        }

        const fetchBatches = async () => {
            try {
                const response = await authenticatedAxiosInstance.get(PACKAGE_AUTOCOMPLETE_URL, {
                    params: {
                        q: searchTerm,
                        instituteId: INSTITUTE_ID,
                        session_id: searchParams.session || undefined,
                    },
                });

                const data = response.data;
                let normalizedResults: { id: string; label: string }[] = [];

                // The batch's own name wins: course + level is identical for every
                // batch of a course, so the suggestions used to be indistinguishable.
                const processItem = (item: any) => ({
                    id: item.package_session_id || item.package_id || item.id,
                    label:
                        (item.batch_name || '').trim() ||
                        `${removeDefaultPrefix(item.package_name || item.course_name || '')}${item.level_name && item.level_name !== 'DEFAULT' ? ` - ${removeDefaultPrefix(item.level_name)}` : ''}`.trim(),
                });

                if (Array.isArray(data?.suggestions)) {
                    normalizedResults = data.suggestions.map(processItem);
                } else if (Array.isArray(data?.content)) {
                    normalizedResults = data.content.map(processItem);
                } else if (Array.isArray(data)) {
                    normalizedResults = data.map(processItem);
                }

                setDynamicFilterList(normalizedResults);
            } catch (error) {
                console.error('Error fetching batches:', error);
            }
        };

        const timeoutId = setTimeout(fetchBatches, 300);
        return () => clearTimeout(timeoutId);
    }, [searchTerm, filterId, INSTITUTE_ID, searchParams.session, filterDetails.filters, isOpen]);

    const handleSelectDeSelect = (option: { id: string; label: string }) => {
        let updatedValue: { id: string; label: string }[] = [];
        const existingFilter = columnFilters?.find((filter) => filter.id === filterId);

        if (existingFilter) {
            const alreadyExists = existingFilter.value.some((filter) => filter.id === option.id);
            if (alreadyExists) {
                updatedValue = existingFilter.value.filter((filter) => filter.id !== option.id);
            } else {
                updatedValue = [...existingFilter.value, option];
            }
        } else {
            updatedValue = [option];
        }

        setSelectedFilterList((prev) => ({
            ...prev,
            [filterId]: updatedValue,
        }));

        if (onFilterChange) {
            onFilterChange(updatedValue);
        }

    };

    const handleClearFilters = () => {
        setSelectedFilterList((prev) => ({
            ...prev,
            [filterId]: [],
        }));

        if (onFilterChange) {
            onFilterChange([]);
        }
    };

    return (
        <div className="hover:scale-102 group transition-all duration-200">
            <FilterChips
                label={filterDetails.label}
                filterList={dynamicFilterList}
                selectedFilters={selectedFilterList[filterId] || []}
                clearFilters={clearFilters}
                handleSelect={handleSelectDeSelect}
                handleClearFilters={handleClearFilters}
                onSearchChange={filterId === 'batch' ? setSearchTerm : undefined}
                shouldFilter={filterId !== 'batch'}
                closeOnSelect
                onOpenChange={(open) => {
                    setIsOpen(open);
                    if (!open) {
                        setSearchTerm('');
                    }
                }}
            />
        </div>
    );
};
