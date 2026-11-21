import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, FolderOpen, Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import { useEditorStore } from '../../-stores/editor-store';
import { useFolderLibraryStore } from '../../-stores/folder-library-store';
import {
    folderLibrariesQueryKey,
    listFolderLibraries,
} from '../../-services/folder-library-service';
import {
    BADGE_TYPES,
    QUICK_FILTER_KINDS,
    badgeTypesOf,
    enableBadges,
    enableStreams,
    formatAmountList,
    moveItem,
    newQuickFilter,
    parseAmountList,
    positiveIntOrUndefined,
    readCourseLanguages,
    streamItemProblems,
    toStreamKey,
    toStreamKeyDraft,
    toggleBadgeType,
    withQuickFilterKind,
    type QuickFilterKind,
    type QuickFilterProp,
    type StreamItemProp,
} from './catalog-discovery-props';

/**
 * Courses-page discovery settings of a courseCatalog / productCourseGrid
 * section: stream tabs, extra filters, quick filters, badges and one card per
 * course. Every setting is optional — a section that never touches them keeps
 * the original grid. The learner page reads these props live (see the
 * learner app's catalog/catalog-config.ts).
 */

/** Section props are hand- or AI-written JSON: read them as unknown and narrow. */
type Props = Record<string, unknown>;

interface CatalogDiscoveryEditorProps {
    component: { id: string; type?: string; props: Props };
    pageId: string;
    updateComponent: (pageId: string, componentId: string, patch: { props: Props }) => void;
}

const isObject = (v: unknown): v is Props => !!v && typeof v === 'object' && !Array.isArray(v);
const objectOf = (v: unknown): Props => (isObject(v) ? v : {});
const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');
const numberOr = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);

const Toggle = ({
    label,
    hint,
    checked,
    onChange,
    disabled,
}: {
    label: string;
    hint?: ReactNode;
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}) => (
    <div className="flex items-start justify-between gap-3">
        <div>
            <Label className="text-xs">{label}</Label>
            {hint && <p className="text-caption text-neutral-500">{hint}</p>}
        </div>
        <Switch
            checked={checked}
            onCheckedChange={onChange}
            disabled={disabled}
            aria-label={label}
        />
    </div>
);

const Choice = <T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (v: T) => void;
}) => (
    <div>
        <Label className="text-xs">{label}</Label>
        <div className="mt-1 flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'rounded px-2.5 py-1 text-caption font-medium',
                        value === o.value
                            ? 'bg-primary-100 text-primary-500'
                            : 'bg-neutral-100 text-neutral-600'
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    </div>
);

const Section = ({
    title,
    hint,
    children,
}: {
    title: string;
    hint?: ReactNode;
    children: ReactNode;
}) => (
    <div className="space-y-3 border-t border-neutral-100 pt-4">
        <div>
            <p className="text-sm font-semibold text-neutral-700">{title}</p>
            {hint && <p className="text-caption text-neutral-500">{hint}</p>}
        </div>
        {children}
    </div>
);

const Warning = ({ children }: { children: ReactNode }) => (
    <p className="text-caption text-warning-600">{children}</p>
);

/**
 * A whole-number input that can be cleared and retyped. A valid number is
 * saved as it is typed (live preview); an empty or invalid field keeps what
 * the admin typed until it loses focus, then shows the saved value again.
 */
const NumberField = ({
    id,
    value,
    onCommit,
    className,
    ariaLabel,
}: {
    id?: string;
    /** The saved number; null shows an empty field. */
    value: number | null;
    onCommit: (n: number) => void;
    className?: string;
    ariaLabel?: string;
}) => {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <Input
            id={id}
            className={className}
            type="number"
            min={1}
            aria-label={ariaLabel}
            value={draft ?? (value === null ? '' : String(value))}
            onChange={(e) => {
                setDraft(e.target.value);
                const n = positiveIntOrUndefined(e.target.value);
                if (n !== undefined && n !== value) onCommit(n);
            }}
            onBlur={() => setDraft(null)}
        />
    );
};

/** A stored positive amount (number or numeric text, as the site reads it), else null. */
const amountOrNull = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
};

const RowButtons = ({
    index,
    count,
    onMove,
    onRemove,
    noun,
}: {
    index: number;
    count: number;
    onMove: (delta: number) => void;
    onRemove: () => void;
    noun: string;
}) => (
    <div className="flex shrink-0 items-center gap-0.5">
        <MyButton
            type="button"
            buttonType="text"
            layoutVariant="icon"
            scale="small"
            aria-label={`Move ${noun} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
        >
            <ArrowUp className="size-3.5" />
        </MyButton>
        <MyButton
            type="button"
            buttonType="text"
            layoutVariant="icon"
            scale="small"
            aria-label={`Move ${noun} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
        >
            <ArrowDown className="size-3.5" />
        </MyButton>
        <MyButton
            type="button"
            buttonType="text"
            layoutVariant="icon"
            scale="small"
            aria-label={`Remove ${noun}`}
            onClick={onRemove}
        >
            <Trash className="size-3.5 text-danger-600" />
        </MyButton>
    </div>
);

const selectClass = 'w-full rounded border px-2 py-1.5 text-xs';

export const CatalogDiscoveryEditor = ({
    component,
    pageId,
    updateComponent,
}: CatalogDiscoveryEditorProps) => {
    const instituteId = getCurrentInstituteId();
    // Whole-store read on purpose (no selector): render tests mock the store as a plain function.
    const { config } = useEditorStore();
    const courseLanguages = readCourseLanguages(config?.globalSettings);
    const openForSection = useFolderLibraryStore((s) => s.openForSection);
    const { props } = component;

    const patch = (next: Props) =>
        updateComponent(pageId, component.id, { props: { ...props, ...next } });
    const setNested = (key: string, next: Props) =>
        patch({ [key]: { ...objectOf(props[key]), ...next } });

    /* ── streams ── */
    const streams = objectOf(props.streams);
    const streamsOn = streams.enabled === true;
    const source: 'folderLibrary' | 'tags' = streams.source === 'tags' ? 'tags' : 'folderLibrary';
    const streamItems = (Array.isArray(streams.items) ? streams.items : []) as StreamItemProp[];
    const setStreams = (next: Props) => setNested('streams', next);
    const setStreamItems = (items: StreamItemProp[]) => setStreams({ items });
    const updateStreamItem = (index: number, next: Partial<StreamItemProp>) =>
        setStreamItems(streamItems.map((it, i) => (i === index ? { ...it, ...next } : it)));
    // Tabs the site would drop: no usable URL key, or the key of an earlier tab.
    const streamProblems = streamItemProblems(streamItems);

    const { data: libraries, isLoading: librariesLoading } = useQuery({
        queryKey: folderLibrariesQueryKey(instituteId),
        queryFn: () => listFolderLibraries(instituteId!),
        enabled: !!instituteId && streamsOn && source === 'folderLibrary',
        staleTime: 30_000,
    });
    const libraryId = textOf(streams.libraryId);
    const selectedLibrary = (libraries || []).find((l) => l.id === libraryId);

    /* ── filters ── */
    const priceFilter = objectOf(props.priceFilter);
    const languageFilter = objectOf(props.languageFilter);
    const categoryFilter = objectOf(props.categoryFilter);

    /* ── quick filters ── */
    const quickFilters = (
        Array.isArray(props.quickFilters) ? props.quickFilters : []
    ) as QuickFilterProp[];
    const setQuickFilters = (list: QuickFilterProp[]) => patch({ quickFilters: list });
    const updateQuick = (index: number, next: QuickFilterProp) =>
        setQuickFilters(quickFilters.map((q, i) => (i === index ? next : q)));
    const kindLabel = (kind: QuickFilterKind) =>
        QUICK_FILTER_KINDS.find((k) => k.value === kind)?.label ?? kind;

    /* ── badges ── */
    const badges = objectOf(props.badges);
    const badgesOn = badges.enabled === true;
    const badgeTypes = badgeTypesOf(badges.types);

    const languagesNote = !courseLanguages.enabled && (
        <Warning>
            Turn on Course languages in Site settings first — until then this stays off on the site.
        </Warning>
    );

    return (
        <div className="space-y-4 rounded border border-neutral-200 p-3">
            <div>
                <p className="text-sm font-semibold text-neutral-700">
                    Courses page: tabs, filters &amp; badges
                </p>
                <p className="text-caption text-neutral-500">
                    Optional extras for a Courses page. Leave them off and the grid looks exactly as
                    before.
                </p>
            </div>

            {/* Stream tabs */}
            <Section title="Stream tabs">
                <Toggle
                    label="Stream tabs"
                    hint="Tabs above the grid that show one stream at a time. The page address follows the tab (…?stream=shiksha), so menus can link straight to one."
                    checked={streamsOn}
                    onChange={(v) =>
                        patch({
                            streams: v
                                ? enableStreams(props.streams)
                                : { ...streams, enabled: false },
                        })
                    }
                />
                {streamsOn && (
                    <>
                        <Choice
                            label="Tabs come from"
                            value={source}
                            options={[
                                { value: 'folderLibrary', label: 'Folder library' },
                                { value: 'tags', label: 'Course tags' },
                            ]}
                            onChange={(v) => setStreams({ source: v })}
                        />

                        {source === 'folderLibrary' ? (
                            <div className="space-y-2">
                                <Label className="text-xs" htmlFor={`${component.id}-library`}>
                                    Folder library
                                </Label>
                                <select
                                    id={`${component.id}-library`}
                                    className={selectClass}
                                    value={libraryId}
                                    onChange={(e) => setStreams({ libraryId: e.target.value })}
                                >
                                    <option value="">
                                        {librariesLoading
                                            ? 'Loading libraries…'
                                            : 'Select a library'}
                                    </option>
                                    {(libraries || []).map((l) => (
                                        <option key={l.id} value={l.id}>
                                            {l.name}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-caption text-neutral-500">
                                    Top-level folders become the tabs and their sub-folders the
                                    categories. Each folder shows the courses carrying its course
                                    tag (set in the folder manager; it defaults to the
                                    folder&rsquo;s URL key).
                                </p>
                                {libraryId &&
                                    !librariesLoading &&
                                    libraries &&
                                    !selectedLibrary && (
                                        <Warning>
                                            This library was deleted. Pick another one — no tabs
                                            show until you do.
                                        </Warning>
                                    )}
                                <div className="flex flex-wrap gap-2">
                                    {selectedLibrary && (
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            scale="small"
                                            onClick={() =>
                                                openForSection(libraryId, (id) =>
                                                    setStreams({ libraryId: id })
                                                )
                                            }
                                        >
                                            <FolderOpen className="size-4" /> Manage folders
                                        </MyButton>
                                    )}
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() =>
                                            openForSection(null, (id) =>
                                                setStreams({ libraryId: id })
                                            )
                                        }
                                    >
                                        <Plus className="size-4" />{' '}
                                        {libraries?.length
                                            ? 'New or other library'
                                            : 'Create a library'}
                                    </MyButton>
                                </div>
                                <Choice
                                    label="Tab text"
                                    value={
                                        (streams.labelMode as 'title' | 'subtitle' | 'both') ||
                                        'title'
                                    }
                                    options={[
                                        { value: 'title', label: 'Title' },
                                        { value: 'subtitle', label: 'Subtitle' },
                                        { value: 'both', label: 'Both' },
                                    ]}
                                    onChange={(v) => setStreams({ labelMode: v })}
                                />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-caption text-neutral-500">
                                    One tab per course tag. The URL key is what links use
                                    (…?stream=key).
                                </p>
                                {streamItems.map((item, index) => {
                                    const problem = streamProblems[index];
                                    return (
                                        <div
                                            key={index}
                                            className="space-y-1.5 rounded border border-neutral-200 p-2"
                                        >
                                            <div className="flex items-center gap-1">
                                                <Input
                                                    className="h-8 text-xs"
                                                    value={item.label || ''}
                                                    placeholder="Tab text"
                                                    aria-label={`Tab ${index + 1} text`}
                                                    onChange={(e) =>
                                                        updateStreamItem(index, {
                                                            label: e.target.value,
                                                        })
                                                    }
                                                />
                                                <RowButtons
                                                    index={index}
                                                    count={streamItems.length}
                                                    noun="tab"
                                                    onMove={(d) =>
                                                        setStreamItems(
                                                            moveItem(streamItems, index, d)
                                                        )
                                                    }
                                                    onRemove={() =>
                                                        setStreamItems(
                                                            streamItems.filter(
                                                                (_, i) => i !== index
                                                            )
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-1.5">
                                                <Input
                                                    className="h-8 text-xs"
                                                    value={item.tag || ''}
                                                    placeholder="Course tag"
                                                    aria-label={`Tab ${index + 1} course tag`}
                                                    onChange={(e) =>
                                                        updateStreamItem(index, {
                                                            tag: e.target.value,
                                                            // Follow the tag until the key is edited by hand.
                                                            slug:
                                                                !item.slug ||
                                                                item.slug ===
                                                                    toStreamKey(item.tag || '')
                                                                    ? toStreamKey(e.target.value)
                                                                    : item.slug,
                                                        })
                                                    }
                                                />
                                                <Input
                                                    className="h-8 text-xs"
                                                    value={item.slug || ''}
                                                    placeholder="URL key"
                                                    aria-label={`Tab ${index + 1} URL key`}
                                                    // A trailing dash survives typing ("vedic-" → "vedic-maths");
                                                    // the key is tidied once the field loses focus.
                                                    onChange={(e) =>
                                                        updateStreamItem(index, {
                                                            slug: toStreamKeyDraft(e.target.value),
                                                        })
                                                    }
                                                    onBlur={(e) => {
                                                        const key = toStreamKey(e.target.value);
                                                        if (key !== (item.slug || ''))
                                                            updateStreamItem(index, { slug: key });
                                                    }}
                                                />
                                            </div>
                                            {problem?.kind === 'noKey' && (
                                                <Warning>
                                                    This tab needs a URL key in English letters or
                                                    digits (e.g. shiksha) — until then it
                                                    doesn&rsquo;t show on the site.
                                                </Warning>
                                            )}
                                            {problem?.kind === 'duplicate' && (
                                                <Warning>
                                                    Same URL key as tab {problem.firstIndex + 1} —
                                                    only that tab shows on the site. Give this one
                                                    its own key.
                                                </Warning>
                                            )}
                                        </div>
                                    );
                                })}
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() =>
                                        setStreamItems([
                                            ...streamItems,
                                            { label: '', slug: '', tag: '' },
                                        ])
                                    }
                                >
                                    <Plus className="size-4" /> Add tab
                                </MyButton>
                            </div>
                        )}

                        <div>
                            <Label className="text-xs" htmlFor={`${component.id}-all-label`}>
                                First tab
                            </Label>
                            <Input
                                id={`${component.id}-all-label`}
                                className="mt-1"
                                value={typeof streams.allLabel === 'string' ? streams.allLabel : ''}
                                placeholder="All courses"
                                onChange={(e) => setStreams({ allLabel: e.target.value })}
                            />
                        </div>
                        <Toggle
                            label="Stick under the header"
                            hint="The tabs stay in view while the visitor scrolls the grid"
                            checked={streams.sticky !== false}
                            onChange={(v) => setStreams({ sticky: v })}
                        />
                    </>
                )}
                <Toggle
                    label="Keep the view in the page address"
                    hint="Tabs, filters, sort and search go into the URL, so a filtered view can be shared or linked. On by default with stream tabs. A link only applies the filters this section offers (or shows as applied-filter chips)."
                    checked={typeof props.syncUrl === 'boolean' ? props.syncUrl : streamsOn}
                    onChange={(v) => patch({ syncUrl: v })}
                />
            </Section>

            {/* Filters */}
            <Section
                title="Filters"
                hint="Extra sidebar filters. Options inside one filter combine with OR, different filters with AND."
            >
                <Toggle
                    label="Category filter"
                    hint="The sub-folders of the selected stream tab. Menu links that open one category (…&category=…) need it."
                    checked={categoryFilter.enabled === true}
                    onChange={(v) => setNested('categoryFilter', { enabled: v })}
                />
                {categoryFilter.enabled === true && (
                    <>
                        {!(streamsOn && source === 'folderLibrary') && (
                            <Warning>
                                Needs stream tabs from a folder library — until then this stays off
                                on the site.
                            </Warning>
                        )}
                        <Input
                            value={
                                typeof categoryFilter.label === 'string' ? categoryFilter.label : ''
                            }
                            placeholder="Categories"
                            aria-label="Category filter heading"
                            onChange={(e) => setNested('categoryFilter', { label: e.target.value })}
                        />
                    </>
                )}

                <Toggle
                    label="Language filter"
                    hint="English, Hindi… read from each course's level names"
                    checked={languageFilter.enabled === true}
                    onChange={(v) => setNested('languageFilter', { enabled: v })}
                />
                {languageFilter.enabled === true && (
                    <>
                        {languagesNote}
                        <Input
                            value={
                                typeof languageFilter.label === 'string' ? languageFilter.label : ''
                            }
                            placeholder="Language"
                            aria-label="Language filter heading"
                            onChange={(e) => setNested('languageFilter', { label: e.target.value })}
                        />
                    </>
                )}

                <Toggle
                    label="Price filter"
                    hint="Free, Paid and “Under” amounts"
                    checked={priceFilter.enabled === true}
                    onChange={(v) => setNested('priceFilter', { enabled: v })}
                />
                {priceFilter.enabled === true && (
                    <div className="space-y-2">
                        <Input
                            value={typeof priceFilter.label === 'string' ? priceFilter.label : ''}
                            placeholder="Price"
                            aria-label="Price filter heading"
                            onChange={(e) => setNested('priceFilter', { label: e.target.value })}
                        />
                        <Toggle
                            label="Offer “Free”"
                            checked={priceFilter.showFree !== false}
                            onChange={(v) => setNested('priceFilter', { showFree: v })}
                        />
                        <div>
                            <Label className="text-xs" htmlFor={`${component.id}-price-amounts`}>
                                “Under” amounts
                            </Label>
                            <Input
                                id={`${component.id}-price-amounts`}
                                className="mt-1"
                                // Re-mount when the stored list changes so the box shows it normalised.
                                key={formatAmountList(priceFilter.maxOptions)}
                                defaultValue={formatAmountList(priceFilter.maxOptions)}
                                placeholder="500, 1000"
                                onBlur={(e) =>
                                    setNested('priceFilter', {
                                        maxOptions: parseAmountList(e.target.value),
                                    })
                                }
                            />
                            <p className="mt-1 text-caption text-neutral-500">
                                Comma-separated, in the course currency.
                            </p>
                        </div>
                    </div>
                )}

                <Toggle
                    label="Counts next to options"
                    hint="How many courses each option would show, updated live"
                    checked={props.showFilterCounts === true}
                    onChange={(v) => patch({ showFilterCounts: v })}
                />
                <Toggle
                    label="Applied filters as chips"
                    hint="Removable chips above the grid, with Clear all"
                    checked={props.showAppliedChips === true}
                    onChange={(v) => patch({ showAppliedChips: v })}
                />
                <Toggle
                    label="Phones: filters in a bottom sheet"
                    hint="Below desktop width the filters open from a Filters button"
                    checked={props.mobileFilterSheet === true}
                    onChange={(v) => patch({ mobileFilterSheet: v })}
                />
            </Section>

            {/* Quick filters */}
            <Section
                title="Quick filters"
                hint="One-tap chips above the grid. Each one switches the same filter or sort the sidebar does. Leave the text empty to use the standard wording in the visitor's language."
            >
                {quickFilters.map((qf, index) => (
                    <div
                        key={qf.id || index}
                        className="space-y-1.5 rounded border border-neutral-200 p-2"
                    >
                        <div className="flex items-center gap-1">
                            <select
                                className={selectClass}
                                value={qf.kind}
                                aria-label={`Quick filter ${index + 1} type`}
                                onChange={(e) =>
                                    updateQuick(
                                        index,
                                        withQuickFilterKind(
                                            qf,
                                            e.target.value as QuickFilterKind,
                                            courseLanguages.languages
                                        )
                                    )
                                }
                            >
                                {QUICK_FILTER_KINDS.map((k) => (
                                    <option key={k.value} value={k.value}>
                                        {k.label} — {k.hint}
                                    </option>
                                ))}
                            </select>
                            <RowButtons
                                index={index}
                                count={quickFilters.length}
                                noun="quick filter"
                                onMove={(d) => setQuickFilters(moveItem(quickFilters, index, d))}
                                onRemove={() =>
                                    setQuickFilters(quickFilters.filter((_, i) => i !== index))
                                }
                            />
                        </div>
                        <Input
                            className="h-8 text-xs"
                            value={qf.label || ''}
                            placeholder={kindLabel(qf.kind)}
                            aria-label={`Quick filter ${index + 1} text`}
                            onChange={(e) => updateQuick(index, { ...qf, label: e.target.value })}
                        />
                        {qf.kind === 'language' && (
                            <>
                                <select
                                    className={selectClass}
                                    value={typeof qf.value === 'string' ? qf.value : ''}
                                    aria-label={`Quick filter ${index + 1} language`}
                                    onChange={(e) =>
                                        updateQuick(index, { ...qf, value: e.target.value })
                                    }
                                >
                                    {courseLanguages.languages.map((l) => (
                                        <option key={l.code} value={l.code}>
                                            {l.label}
                                        </option>
                                    ))}
                                </select>
                                {languagesNote}
                            </>
                        )}
                        {qf.kind === 'priceMax' && (
                            <NumberField
                                className="h-8 text-xs"
                                ariaLabel={`Quick filter ${index + 1} amount`}
                                value={amountOrNull(qf.value)}
                                onCommit={(n) => updateQuick(index, { ...qf, value: n })}
                            />
                        )}
                    </div>
                ))}
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={() => setQuickFilters([...quickFilters, newQuickFilter(quickFilters)])}
                >
                    <Plus className="size-4" /> Add quick filter
                </MyButton>
            </Section>

            {/* Badges */}
            <Section
                title="Badges"
                hint="Live from enrolments and course dates — never typed by hand."
            >
                <Toggle
                    label="Badges on cards"
                    checked={badgesOn}
                    onChange={(v) =>
                        patch({
                            badges: v ? enableBadges(props.badges) : { ...badges, enabled: false },
                        })
                    }
                />
                {badgesOn && (
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            {BADGE_TYPES.map((b) => {
                                const checked = badgeTypes.includes(b.value);
                                // The last ticked type stays ticked: switch badges off above instead.
                                const locked = checked && badgeTypes.length === 1;
                                return (
                                    <label
                                        key={b.value}
                                        className={cn(
                                            'flex items-start gap-2 text-xs',
                                            locked ? 'cursor-not-allowed' : 'cursor-pointer'
                                        )}
                                    >
                                        <Checkbox
                                            className="mt-0.5"
                                            checked={checked}
                                            disabled={locked}
                                            onCheckedChange={() =>
                                                setNested('badges', {
                                                    types: toggleBadgeType(badges.types, b.value),
                                                })
                                            }
                                        />
                                        <span>
                                            <span className="font-medium text-neutral-700">
                                                {b.label}
                                            </span>
                                            <span className="block text-caption text-neutral-500">
                                                {b.hint}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                            {badgeTypes.length === 1 && (
                                <p className="text-caption text-neutral-500">
                                    Keep at least one type — to hide every badge, switch
                                    &ldquo;Badges on cards&rdquo; off.
                                </p>
                            )}
                            {badgeTypes.length === 0 && (
                                <Warning>
                                    No badge type is ticked, so cards show no badges. Tick at least
                                    one.
                                </Warning>
                            )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {(
                                [
                                    ['newDays', 'New for (days)', 60],
                                    ['bestsellerTop', 'Bestsellers: top', 3],
                                    ['max', 'Most per card', 2],
                                ] as const
                            ).map(([key, label, fallback]) => (
                                <div key={key}>
                                    <Label
                                        className="text-caption"
                                        htmlFor={`${component.id}-badge-${key}`}
                                    >
                                        {label}
                                    </Label>
                                    <NumberField
                                        id={`${component.id}-badge-${key}`}
                                        className="mt-1 h-8 text-xs"
                                        value={numberOr(badges[key], fallback)}
                                        onCommit={(n) => setNested('badges', { [key]: n })}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Section>

            {/* Language versions */}
            <Section title="Language versions">
                <Toggle
                    label="One card per course"
                    hint="A course's Hindi and English versions show as one card with EN / हिं chips; the visitor picks the language on the course page."
                    checked={props.groupLanguageVersions === true}
                    onChange={(v) => patch({ groupLanguageVersions: v })}
                />
                {props.groupLanguageVersions === true && languagesNote}
            </Section>
        </div>
    );
};
