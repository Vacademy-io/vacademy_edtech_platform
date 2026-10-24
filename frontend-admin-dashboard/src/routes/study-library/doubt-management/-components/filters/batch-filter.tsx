import SelectChips from '@/components/design-system/SelectChips';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilterType } from '../../-types/filter-type';
import { useDoubtFilters } from '../../-stores/filter-store';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const BatchFilter = () => {
    const { t } = useTranslation('studyLibraryBatchFilter');
    const AllBatchOption = {
        label: t('all'),
        value: '',
    };
    const { instituteDetails } = useInstituteDetailsStore();
    const { updateFilters } = useDoubtFilters();

    const batchList: FilterType[] = [];
    batchList?.push(AllBatchOption);
    const batches =
        instituteDetails?.batches_for_sessions.map((batch) => {
            return {
                label:
                    batch.level.level_name +
                        ' ' +
                        batch.package_dto.package_name +
                        ', ' +
                        batch.session.session_name || '',
                value: batch.id,
            };
        }) || [];
    batchList?.push(...batches);

    const [selectedBatch, setSelectedBatch] = useState<FilterType[]>([AllBatchOption]);
    // Re-read labels from the live list so "All" isn't frozen as a raw key from before the
    // namespace loaded.
    const selectedDisplay = selectedBatch.map(
        (sel) => batchList.find((o) => o.value === sel.value) ?? sel
    );

    const handleBatchChange = (next: FilterType[]) => {
        if (next.length === 0) {
            setSelectedBatch([AllBatchOption]);
            return;
        }
        const hadAll = selectedBatch.some((b) => b.value === '');
        const hasAll = next.some((b) => b.value === '');
        // Picking "All" collapses to All; picking a specific batch drops "All" so the selection
        // isn't silently swallowed.
        if (hasAll && !hadAll) {
            setSelectedBatch([AllBatchOption]);
        } else if (hasAll && next.length > 1) {
            setSelectedBatch(next.filter((b) => b.value !== ''));
        } else {
            setSelectedBatch(next);
        }
    };

    useEffect(() => {
        // "All" (value '') → no batch filter. The inbox is already scoped by institute_id, so an
        // empty batch list returns every doubt in the institute — including general (batchless)
        // queries that wouldn't match an enumerated batch list.
        const isAll = selectedBatch.some((b) => b.value === '');
        updateFilters({
            batch_ids: isAll ? [] : selectedBatch.map((batch) => batch.value),
        });
    }, [selectedBatch]);

    return (
        <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-600">
                {getTerminology(ContentTerms.Batch, SystemTerms.Batch)}
            </span>
            <SelectChips
                options={batchList}
                selected={selectedDisplay}
                onChange={handleBatchChange}
                multiSelect={true}
                hasClearFilter={false}
                className="min-w-40"
            />
        </div>
    );
};
