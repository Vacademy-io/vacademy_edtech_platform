import { FilterChips } from '@/components/design-system/chips';

/**
 * `FilterChips` constrained to one value.
 *
 * The HR list endpoints take a single `status` / `departmentId` / `role`, not a
 * set, so a multi-select chip would let an admin pick three departments and get
 * results for one. Selecting the active option again clears it.
 */
export function SingleFilterChip({
    label,
    options,
    value,
    onChange,
    disabled,
}: {
    label: string;
    options: Array<{ id: string; label: string }>;
    value?: string;
    onChange: (next: string | undefined) => void;
    disabled?: boolean;
}) {
    const selected = value ? options.filter((option) => option.id === value) : [];

    return (
        <FilterChips
            label={label}
            filterList={options}
            selectedFilters={selected}
            disabled={disabled}
            closeOnSelect
            handleSelect={(option) => onChange(option.id === value ? undefined : option.id)}
            handleClearFilters={() => onChange(undefined)}
        />
    );
}
