import { useMemo } from 'react';
import { ChipToggleGroup, type ChipToggleOption } from '@/components/design-system/chips';
import {
    SearchableSelect,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { useReportT } from '../../-components/daily-report/range-context';
import {
    listFilter,
    listIdOf,
    TEMPLATE_CATEGORY_FILTERS,
    TEMPLATE_MOVED_FILTER,
    TEMPLATE_STATUS_FILTERS,
    type OutcomeTab,
} from '../../-utils/outcomes-params';
import type { ReportTerms } from '../../-utils/report-terms';

/** Value of the "all lists" option (the picker has no empty value). */
const ALL_LISTS = 'all';

interface OutcomesFiltersProps {
    tab: OutcomeTab;
    /** The URL's filter for this tab, already checked against what the tab understands. */
    filter: string | undefined;
    onFilterChange: (filter: string | undefined) => void;
    /** Leads added: the lists people joined, from the report. */
    listOptions: SearchableSelectOption[];
    /** Name of the selected list when it is not among the options (the report did not load). */
    selectedListName?: string;
    terms: ReportTerms;
}

/**
 * The filter chips of a tab: new or already in the CRM and a list picker for leads added,
 * booked or scheduled demos (with what happened to the scheduled ones), who made each status
 * change, and for new templates their category or where they stand. Conversions has none. The
 * choice lives in the URL's `filter`.
 */
export function OutcomesFilters({
    tab,
    filter,
    onFilterChange,
    listOptions,
    selectedListName,
    terms,
}: OutcomesFiltersProps) {
    const t = useReportT();
    const label = (key: string) => t(`outcomesPage.filter.${key}`);
    const chips = (keys: string[]): ChipToggleOption[] =>
        keys.map((value) => ({ value, label: label(value) }));

    const listId = listIdOf(filter);
    const lists = useMemo<SearchableSelectOption[]>(() => {
        const all = {
            value: ALL_LISTS,
            label: t('outcomesPage.filter.allLists', { lists: terms.lists.toLowerCase() }),
        };
        const known = listOptions.some((o) => o.value === listId);
        return [
            all,
            ...listOptions,
            ...(listId && !known
                ? [
                      {
                          value: listId,
                          label:
                              selectedListName ||
                              t('outcomesPage.filter.selectedList', {
                                  list: terms.list.toLowerCase(),
                              }),
                      },
                  ]
                : []),
        ];
    }, [listOptions, listId, selectedListName, t, terms]);

    if (tab === 'leads') {
        return (
            <div className="flex flex-wrap items-center gap-3">
                <ChipToggleGroup
                    ariaLabel={t('outcomesPage.filterLabel')}
                    size="md"
                    variant="outline"
                    // A list picked in the dropdown replaces the chips: none of them is active.
                    value={listId ? '' : filter ?? 'all'}
                    onChange={(value) => onFilterChange(value === 'all' ? undefined : value)}
                    options={chips(['all', 'new', 'existing'])}
                />
                <div className="w-full sm:w-72">
                    <SearchableSelect
                        options={lists}
                        value={listId ?? ALL_LISTS}
                        onChange={(value) =>
                            onFilterChange(value === ALL_LISTS ? undefined : listFilter(value))
                        }
                        placeholder={t('outcomesPage.filter.byList', {
                            list: terms.list.toLowerCase(),
                        })}
                        searchPlaceholder={t('outcomesPage.filter.searchLists', {
                            lists: terms.lists.toLowerCase(),
                        })}
                        emptyText={t('outcomesPage.filter.noLists', {
                            lists: terms.lists.toLowerCase(),
                        })}
                        triggerClassName="h-9"
                    />
                </div>
            </div>
        );
    }

    if (tab === 'demos') {
        const scheduled = !!filter;
        return (
            <div className="flex flex-col gap-2">
                <ChipToggleGroup
                    ariaLabel={t('outcomesPage.filter.demosMode')}
                    size="md"
                    variant="outline"
                    value={scheduled ? 'scheduled' : 'booked'}
                    onChange={(value) =>
                        onFilterChange(value === 'booked' ? undefined : 'scheduled')
                    }
                    options={chips(['booked', 'scheduled'])}
                />
                {scheduled && (
                    <ChipToggleGroup
                        ariaLabel={t('outcomesPage.filter.demosOutcome')}
                        size="md"
                        variant="outline"
                        value={filter ?? 'scheduled'}
                        onChange={(value) => onFilterChange(value)}
                        options={[
                            { value: 'scheduled', label: label('allScheduled') },
                            ...chips(['done', 'no_show', 'not_marked']),
                        ]}
                    />
                )}
            </div>
        );
    }

    if (tab === 'status') {
        return (
            <ChipToggleGroup
                ariaLabel={t('outcomesPage.filterLabel')}
                size="md"
                variant="outline"
                value={filter ?? 'all'}
                onChange={(value) => onFilterChange(value === 'all' ? undefined : value)}
                options={chips(['all', 'engine', 'team', 'automation'])}
            />
        );
    }

    if (tab === 'templates') {
        // One filter at a time: a category (or "moved to marketing") in the first row, or a
        // review state in the second. The row that does not hold the choice has none active.
        const categories = [...TEMPLATE_CATEGORY_FILTERS, TEMPLATE_MOVED_FILTER] as string[];
        const statuses = TEMPLATE_STATUS_FILTERS as readonly string[];
        return (
            <div className="flex flex-col gap-2">
                <ChipToggleGroup
                    ariaLabel={t('outcomesPage.filter.templatesCategory')}
                    size="md"
                    variant="outline"
                    value={!filter ? 'all' : categories.includes(filter) ? filter : ''}
                    onChange={(value) => onFilterChange(value === 'all' ? undefined : value)}
                    options={[
                        { value: 'all', label: label('all') },
                        ...TEMPLATE_CATEGORY_FILTERS.map((value) => ({
                            value: value as string,
                            label: t(`whatsappCategory.${value}`),
                        })),
                        { value: TEMPLATE_MOVED_FILTER, label: label(TEMPLATE_MOVED_FILTER) },
                    ]}
                />
                <ChipToggleGroup
                    ariaLabel={t('outcomesPage.filter.templatesStatus')}
                    size="md"
                    variant="outline"
                    value={filter && statuses.includes(filter) ? filter : ''}
                    onChange={(value) => onFilterChange(value)}
                    options={TEMPLATE_STATUS_FILTERS.map((value) => ({
                        value: value as string,
                        label: t(`templateStatus.${value}`),
                    }))}
                />
            </div>
        );
    }

    return null;
}
