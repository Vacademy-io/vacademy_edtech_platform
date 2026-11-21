import { FilterChips } from '@/components/design-system/chips';
import type { FacetGroup, FacetKey } from '../-utils/library-facets';

const withCount = (label: string, count?: number) =>
    count === undefined ? label : `${label} · ${count}`;

/**
 * The same filters as the library page's side panel, as one row of dropdown chips: for the
 * test picker, where the folder tree already takes the side. Each chip lists its values with
 * how many questions they give and has its own search.
 */
export const LibraryFacetChips = ({
    groups,
    onToggle,
    onClearGroup,
}: {
    groups: FacetGroup[];
    onToggle: (key: FacetKey, value: string) => void;
    onClearGroup: (key: FacetKey) => void;
}) => (
    <div className="flex flex-wrap items-center gap-2">
        {groups.map((group) => {
            const options = group.items.map((item) => ({
                id: item.value,
                label: withCount(item.label, item.count),
            }));
            return (
                <FilterChips
                    key={group.key}
                    label={group.title}
                    filterList={options}
                    selectedFilters={options.filter((option) => group.selected.includes(option.id))}
                    handleSelect={(option) => onToggle(group.key, option.id)}
                    handleClearFilters={() => onClearGroup(group.key)}
                />
            );
        })}
    </div>
);
