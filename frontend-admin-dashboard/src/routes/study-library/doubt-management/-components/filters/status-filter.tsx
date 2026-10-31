import SelectChips from '@/components/design-system/SelectChips';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilterType } from '../../-types/filter-type';
import { useDoubtFilters } from '../../-stores/filter-store';
import { useDoubtStatuses } from '../../-services/use-doubt-statuses';

const ALL_VALUE = '';

/**
 * Status filter over the institute's configurable workflow statuses (Pending / In progress /
 * … / Resolved). Multi-select; "All" clears it. The coarse `status` filter stays pinned to
 * ACTIVE+RESOLVED so soft-deleted rows never surface, and the chosen keys go out as
 * `workflow_statuses` (legacy rows match through their coarse status on the backend).
 */
export const StatusFilter = () => {
    const { t } = useTranslation('studyLibraryStatusFilter');
    const { updateFilters } = useDoubtFilters();
    const { enabledStatuses } = useDoubtStatuses();

    const allOption = useMemo<FilterType>(
        () => ({ label: t('options.all'), value: ALL_VALUE }),
        [t]
    );
    const options = useMemo<FilterType[]>(
        () => [allOption, ...enabledStatuses.map((s) => ({ label: s.label, value: s.key }))],
        [allOption, enabledStatuses]
    );

    const [selected, setSelected] = useState<FilterType[]>([allOption]);
    // Labels come from the live option list (catalog + translations both load after mount).
    const selectedDisplay = selected.map(
        (sel) => options.find((o) => o.value === sel.value) ?? sel
    );

    const handleChange = (next: FilterType[]) => {
        if (next.length === 0) {
            setSelected([allOption]);
            return;
        }
        const hadAll = selected.some((s) => s.value === ALL_VALUE);
        const hasAll = next.some((s) => s.value === ALL_VALUE);
        // Picking "All" collapses to All; picking a status drops "All".
        if (hasAll && !hadAll) setSelected([allOption]);
        else if (hasAll && next.length > 1) setSelected(next.filter((s) => s.value !== ALL_VALUE));
        else setSelected(next);
    };

    useEffect(() => {
        const isAll = selected.some((s) => s.value === ALL_VALUE);
        const keys = isAll ? [] : selected.map((s) => s.value);
        // Narrow the coarse status from the picked kinds too: exact on the new backend, and the
        // old "Resolved / Unresolved" behaviour on a backend that predates workflow statuses.
        const coarse = new Set<string>();
        keys.forEach((key) =>
            coarse.add(
                enabledStatuses.find((s) => s.key === key)?.kind === 'RESOLVED'
                    ? 'RESOLVED'
                    : 'ACTIVE'
            )
        );
        updateFilters({
            status: coarse.size > 0 ? [...coarse] : ['ACTIVE', 'RESOLVED'],
            workflow_statuses: keys,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, enabledStatuses]);

    return (
        <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-600">{t('label.status')}</span>
            <SelectChips
                options={options}
                selected={selectedDisplay}
                onChange={handleChange}
                multiSelect={true}
                hasClearFilter={false}
                className="min-w-40"
            />
        </div>
    );
};
