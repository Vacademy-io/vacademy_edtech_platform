import SelectChips from '@/components/design-system/SelectChips';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInstituteAssignees } from '@/routes/dashboard/-hooks/useInstituteAssignees';
import { getInstituteId } from '@/constants/helper';
import { FilterType } from '../../-types/filter-type';
import { useDoubtFilters } from '../../-stores/filter-store';

const ALL_VALUE = '';
const UNASSIGNED_VALUE = '__unassigned__';

/**
 * "Assigned to" filter: any institute staff member (multi-select) and/or "Unassigned". Staff and
 * Unassigned combine as OR on the backend. Only EXPLICIT assignments count — the grey "Default"
 * teachers the conversation pane shows are a per-doubt lookup, not a stored assignment.
 */
export const AssigneeFilter = () => {
    const { t } = useTranslation('studyLibraryAssigneeFilter');
    const { updateFilters } = useDoubtFilters();
    const { assignees } = useInstituteAssignees(getInstituteId());

    const allOption = useMemo<FilterType>(() => ({ label: t('all'), value: ALL_VALUE }), [t]);
    const unassignedOption = useMemo<FilterType>(
        () => ({ label: t('unassigned'), value: UNASSIGNED_VALUE }),
        [t]
    );
    const options = useMemo<FilterType[]>(
        () => [
            allOption,
            unassignedOption,
            ...assignees.map((a) => ({
                label: a.subtitle ? `${a.name} · ${a.subtitle}` : a.name,
                value: a.id,
            })),
        ],
        [allOption, unassignedOption, assignees]
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
        if (hasAll && !hadAll) setSelected([allOption]);
        else if (hasAll && next.length > 1) setSelected(next.filter((s) => s.value !== ALL_VALUE));
        else setSelected(next);
    };

    useEffect(() => {
        const isAll = selected.some((s) => s.value === ALL_VALUE);
        updateFilters({
            assignee_user_ids: isAll
                ? []
                : selected.map((s) => s.value).filter((v) => v !== UNASSIGNED_VALUE),
            unassigned_only: !isAll && selected.some((s) => s.value === UNASSIGNED_VALUE),
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected]);

    return (
        <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-600">{t('label')}</span>
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
