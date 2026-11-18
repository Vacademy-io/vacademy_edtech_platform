import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDown, CaretRight, Funnel, WarningCircle, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { InputChips } from '@/components/design-system/chips';
import { MyInput } from '@/components/design-system/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { activeFacetChips, type FacetGroup, type FacetKey } from '../-utils/library-facets';
import { difficultyTone } from './library-constants';

/** Rows shown before "Show all". */
const COLLAPSED_ROWS = 6;
/** A group longer than this gets its own search box. */
const SEARCH_FROM = 8;

const FacetGroupSection = ({
    group,
    onToggle,
    onClear,
    onOpenTopic,
}: {
    group: FacetGroup;
    onToggle: (value: string) => void;
    onClear: () => void;
    /** Topics only: opens the topic instead of ticking it. */
    onOpenTopic?: (id: string) => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const [collapsed, setCollapsed] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const [query, setQuery] = useState('');

    const needle = query.trim().toLowerCase();
    const matching = needle
        ? group.items.filter((item) => item.label.toLowerCase().includes(needle))
        : group.items;
    // Ticked values stay in view even when the list is cut short.
    const visible =
        showAll || needle
            ? matching
            : matching.filter(
                  (item, i) => i < COLLAPSED_ROWS || group.selected.includes(item.value)
              );
    const hidden = matching.length - visible.length;
    const isDifficulty = group.key === 'difficulties';

    return (
        <section className="flex flex-col gap-2 border-b border-neutral-100 pb-3 last:border-b-0 last:pb-0">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setCollapsed((value) => !value)}
                    aria-expanded={!collapsed}
                    className="flex min-w-0 flex-1 items-center gap-1 text-left text-caption font-semibold uppercase text-neutral-500"
                >
                    {collapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
                    <span className="truncate">{group.title}</span>
                    {group.selected.length > 0 && (
                        <span className="rounded-full bg-primary-50 px-1.5 text-primary-500">
                            {group.selected.length}
                        </span>
                    )}
                </button>
                {group.selected.length > 0 && (
                    <MyButton type="button" buttonType="text" scale="small" onClick={onClear}>
                        {t('facets.clearGroup')}
                    </MyButton>
                )}
            </div>
            {!collapsed && (
                <>
                    {group.items.length > SEARCH_FROM && (
                        <MyInput
                            inputType="text"
                            inputPlaceholder={t('facets.searchIn', { name: group.title })}
                            input={query}
                            onChangeFunction={(e) => setQuery(e.target.value)}
                            className="sm:w-full"
                        />
                    )}
                    <ul className="flex flex-col">
                        {visible.map((item) => {
                            const checked = group.selected.includes(item.value);
                            const empty = item.count === 0 && !checked;
                            return (
                                <li key={item.value} className="flex items-center gap-1">
                                    <label
                                        className={cn(
                                            'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-neutral-50',
                                            empty && 'text-neutral-400'
                                        )}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => onToggle(item.value)}
                                        />
                                        {isDifficulty ? (
                                            <span
                                                className={cn(
                                                    'rounded-full px-2 py-0.5 text-caption font-semibold',
                                                    difficultyTone[item.value]
                                                )}
                                            >
                                                {item.label}
                                            </span>
                                        ) : (
                                            <span
                                                className={cn(
                                                    'min-w-0 flex-1 truncate text-body',
                                                    empty ? 'text-neutral-400' : 'text-neutral-700'
                                                )}
                                                title={item.label}
                                            >
                                                {item.label}
                                            </span>
                                        )}
                                        <span className="ml-auto shrink-0 text-caption text-neutral-500">
                                            {item.count ?? ''}
                                        </span>
                                    </label>
                                    {onOpenTopic && (
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            layoutVariant="icon"
                                            aria-label={t('facets.openTopic', {
                                                name: item.label,
                                            })}
                                            onClick={() => onOpenTopic(item.value)}
                                        >
                                            <CaretRight size={14} />
                                        </MyButton>
                                    )}
                                </li>
                            );
                        })}
                        {visible.length === 0 && (
                            <li className="p-1 text-caption text-neutral-500">
                                {t('facets.noMatch')}
                            </li>
                        )}
                    </ul>
                    {!needle && (hidden > 0 || showAll) && matching.length > COLLAPSED_ROWS && (
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            className="self-start"
                            onClick={() => setShowAll((value) => !value)}
                        >
                            {showAll
                                ? t('facets.showLess')
                                : t('facets.showAll', { total: matching.length })}
                        </MyButton>
                    )}
                </>
            )}
        </section>
    );
};

/**
 * The filter panel beside the question list: the topics inside the open one, difficulty,
 * type and each kind of tag, every value with how many questions it gives. Any value inside a
 * group, every group.
 */
export const LibraryFacetPanel = ({
    groups,
    loading,
    failed = false,
    onRetry,
    onToggle,
    onClearGroup,
    onClearAll,
    onOpenTopic,
}: {
    groups: FacetGroup[];
    /** First load only: later refreshes keep the old numbers on screen. */
    loading: boolean;
    /** The counts failed. The filters still work, without numbers. */
    failed?: boolean;
    onRetry?: () => void;
    onToggle: (key: FacetKey, value: string) => void;
    onClearGroup: (key: FacetKey) => void;
    onClearAll?: () => void;
    onOpenTopic?: (id: string) => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    return (
        <aside
            aria-label={t('facets.title')}
            className="flex w-full flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 lg:sticky lg:top-4 lg:max-h-screen lg:w-72 lg:shrink-0 lg:overflow-y-auto"
        >
            <div className="flex items-center gap-2">
                <Funnel size={16} className="text-neutral-500" />
                <span className="flex-1 text-subtitle font-semibold text-neutral-700">
                    {t('facets.title')}
                </span>
                {onClearAll && (
                    <MyButton type="button" buttonType="text" scale="small" onClick={onClearAll}>
                        {t('facets.clearAll')}
                    </MyButton>
                )}
            </div>
            {failed && (
                <div className="flex items-center gap-2 rounded-md bg-warning-50 px-2 py-1 text-caption text-warning-600">
                    <WarningCircle size={14} className="shrink-0" />
                    <span className="flex-1">{t('facets.countsFailed')}</span>
                    {onRetry && (
                        <MyButton type="button" buttonType="text" scale="small" onClick={onRetry}>
                            {t('common.retry')}
                        </MyButton>
                    )}
                </div>
            )}
            {loading ? (
                <div className="flex flex-col gap-2">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-6 w-full rounded-md" />
                    ))}
                </div>
            ) : (
                groups.map((group) => (
                    <FacetGroupSection
                        key={group.key}
                        group={group}
                        onToggle={(value) => onToggle(group.key, value)}
                        onClear={() => onClearGroup(group.key)}
                        onOpenTopic={group.key === 'topics' ? onOpenTopic : undefined}
                    />
                ))
            )}
        </aside>
    );
};

/** What is ticked, as chips that untick on click, and "Clear all". Nothing when nothing is ticked. */
export const ActiveFacetChips = ({
    groups,
    onToggle,
    onClearAll,
}: {
    groups: FacetGroup[];
    onToggle: (key: FacetKey, value: string) => void;
    onClearAll: () => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const chips = activeFacetChips(groups);
    if (chips.length === 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
                <button
                    key={`${chip.key}-${chip.value}`}
                    type="button"
                    onClick={() => onToggle(chip.key, chip.value)}
                    aria-label={t('facets.remove', { name: chip.label })}
                >
                    <InputChips label={chip.label} trailingIcon={X} selected />
                </button>
            ))}
            <MyButton type="button" buttonType="text" scale="small" onClick={onClearAll}>
                {t('facets.clearAll')}
            </MyButton>
        </div>
    );
};
