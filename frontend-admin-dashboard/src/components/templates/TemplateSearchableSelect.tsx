import * as React from 'react';
import { Check, CaretDown, CaretUpDown, MagnifyingGlass } from '@phosphor-icons/react';

import { cn } from '@/lib/utils';
import { flattenTemplateBody, humanizeTemplateText } from './template-text';
import { Button } from '@/components/ui/button';
import {
    Command,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * One searchable picker for every place a message template is chosen.
 *
 * Institutes routinely carry dozens of approved templates, and a plain `<Select>` makes you scroll a
 * list of near-identical snake_case names to find one. This is the design system's
 * `SearchableSelect` specialised for templates: it also matches on category, language and body text,
 * and shows the body preview so `reminder_v2` and `reminder_v3` are distinguishable.
 */

export interface TemplateOption {
    /** Value stored on selection — an id at some call sites, a template name at others. */
    value: string;
    /** Template name, shown as the primary label. */
    name: string;
    category?: string;
    language?: string;
    status?: string;
    /** Body/subject text, shown as a second line and included in the search. */
    preview?: string;
}

interface TemplateSearchableSelectProps {
    options: TemplateOption[];
    value: string | undefined;
    onChange: (value: string) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    disabled?: boolean;
    loading?: boolean;
    className?: string;
    /** Row expander copy, for translated callers. */
    expandLabel?: string;
    collapseLabel?: string;
    /** Rendered as the first entry, e.g. "No template" or "Custom — write from scratch". */
    noneOption?: { value: string; label: string };
    /**
     * Render the list in a body portal (default). Pass false inside a Dialog or Sheet —
     * react-remove-scroll blocks wheel/touch on portalled nodes, so a portalled list can't be
     * scrolled from within a modal.
     */
    portal?: boolean;
    id?: string;
}

const statusTone: Record<string, string> = {
    APPROVED: 'bg-success-50 text-success-600',
    PENDING: 'bg-warning-50 text-warning-600',
    REJECTED: 'bg-danger-50 text-danger-600',
    DRAFT: 'bg-neutral-100 text-neutral-500',
};

export function TemplateSearchableSelect({
    options,
    value,
    onChange,
    placeholder = 'Select a template',
    searchPlaceholder = 'Search by name, category or text…',
    emptyText = 'No templates match your search.',
    disabled = false,
    loading = false,
    className,
    expandLabel = 'Show full message',
    collapseLabel = 'Show less',
    noneOption,
    portal = true,
    id,
}: TemplateSearchableSelectProps) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    // Which rows have their message opened out. Two lines is enough to tell templates apart but not
    // enough to read one, and the body is the only thing that says what the message actually says.
    const [expandedRows, setExpandedRows] = React.useState<Record<string, boolean>>({});

    const selected = React.useMemo(
        () => options.find((option) => option.value === value),
        [options, value]
    );
    const isNoneSelected = !!noneOption && value === noneOption.value;

    /**
     * Filtering is done here rather than by cmdk's built-in matcher so the ranking is explicit.
     *
     * Name first. Body text is only searched when nothing matches by name — otherwise typing a word
     * that happens to appear inside a long marketing body returns templates whose names look
     * unrelated, and the search reads as broken even though it matched.
     */
    const { visible, matchedOnBody } = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return { visible: options, matchedOnBody: false };

        const byName = options.filter((o) => o.name.toLowerCase().includes(q));
        const byMeta = options.filter(
            (o) =>
                !byName.includes(o) &&
                [o.category, o.language, o.status].some((f) => f?.toLowerCase().includes(q))
        );
        if (byName.length || byMeta.length) {
            return { visible: [...byName, ...byMeta], matchedOnBody: false };
        }
        // Nothing matched by name or label — fall back to the message text so searching for a
        // phrase you remember from the message still finds it.
        const byBody = options.filter((o) => o.preview?.toLowerCase().includes(q));
        return { visible: byBody, matchedOnBody: byBody.length > 0 };
    }, [options, query]);

    const showNoneOption =
        !!noneOption &&
        (!query.trim() || noneOption.label.toLowerCase().includes(query.trim().toLowerCase()));

    const handleSelect = (selectedValue: string) => {
        onChange(selectedValue);
        setQuery('');
        setOpen(false);
    };

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        // Start each visit with the full list rather than the last search.
        if (!next) {
            setQuery('');
            setExpandedRows({});
        }
    };

    const toggleRow = (rowValue: string) =>
        setExpandedRows((prev) => ({ ...prev, [rowValue]: !prev[rowValue] }));

    const triggerLabel = loading
        ? 'Loading templates…'
        : isNoneSelected
          ? noneOption.label
          : selected?.name ?? placeholder;

    return (
        <Popover open={open && !disabled && !loading} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn('w-full justify-between font-normal', className)}
                    disabled={disabled || loading}
                >
                    <span
                        className={cn(
                            'truncate',
                            !selected && !isNoneSelected && 'text-muted-foreground'
                        )}
                    >
                        {triggerLabel}
                    </span>
                    <CaretUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[--radix-popover-trigger-width] p-0"
                align="start"
                portal={portal}
            >
                {/* shouldFilter={false}: the list is already narrowed above, so cmdk must render
                    exactly what we give it instead of applying its own fuzzy match on top. */}
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={searchPlaceholder}
                        value={query}
                        onValueChange={setQuery}
                    />
                    <CommandList>
                        {visible.length === 0 && !showNoneOption && (
                            <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-neutral-500">
                                <MagnifyingGlass className="size-4 shrink-0" />
                                {emptyText}
                            </div>
                        )}
                        {matchedOnBody && (
                            <p className="border-b px-3 py-2 text-2xs text-neutral-500">
                                No template name matches “{query.trim()}” — showing templates whose
                                message text contains it.
                            </p>
                        )}
                        {/* Rows carry a name, badges and two lines of body, so the old 18rem showed
                            barely two of them — an institute with a dozen templates could not see
                            past the first. 24rem shows four, but only when there is room for it:
                            whichever is smaller, 24rem or the space Radix measured between the
                            trigger and the viewport edge, so a list opening low on a short screen
                            still scrolls inside itself instead of running off the page. The
                            fallback keeps a sane cap on the frame before Radix has measured. */}
                        <CommandGroup
                            className="max-h-[min(24rem,var(--radix-popover-content-available-height,24rem))] overflow-auto" // design-lint-ignore: dynamic Radix-computed CSS var (available viewport space), not a fixed magic number a token could represent
                        >
                            {showNoneOption && noneOption && (
                                <CommandItem
                                    key={noneOption.value}
                                    value={noneOption.label}
                                    onSelect={() => handleSelect(noneOption.value)}
                                >
                                    <Check
                                        className={cn(
                                            'mr-2 size-4 shrink-0',
                                            isNoneSelected ? 'opacity-100' : 'opacity-0'
                                        )}
                                    />
                                    {noneOption.label}
                                </CommandItem>
                            )}
                            {visible.map((option) => {
                                const isExpanded = !!expandedRows[option.value];
                                // Anything past two lines is cut off mid-sentence by the clamp, and
                                // a multi-paragraph body loses every line but the first two.
                                const isTruncatable =
                                    !!option.preview &&
                                    (option.preview.length > 110 || option.preview.includes('\n'));
                                // Collapsed, the body flows as one paragraph. Keeping its line
                                // breaks spent the two clamped lines on "Dear [name]," and a blank
                                // — the reader learned nothing about the message. Expanded, the
                                // paragraphs come back.
                                const collapsedPreview = option.preview?.replace(/\s*\n+\s*/g, ' ');
                                return (
                                    <CommandItem
                                        key={option.value}
                                        // Unique per row — cmdk keys highlight/selection off this. It is
                                        // no longer what search matches against (see `visible` above).
                                        value={option.value}
                                        onSelect={() => handleSelect(option.value)}
                                        className="items-start"
                                    >
                                        <Check
                                            className={cn(
                                                'mr-2 mt-1 size-4 shrink-0',
                                                value === option.value ? 'opacity-100' : 'opacity-0'
                                            )}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="truncate font-medium">
                                                    {option.name}
                                                </span>
                                                {option.status && (
                                                    <span
                                                        className={cn(
                                                            'rounded px-1.5 py-0.5 text-2xs font-medium',
                                                            statusTone[option.status] ??
                                                                'bg-neutral-100 text-neutral-500'
                                                        )}
                                                    >
                                                        {option.status}
                                                    </span>
                                                )}
                                                {option.category && (
                                                    <span className="rounded bg-primary-50 px-1.5 py-0.5 text-2xs text-primary-500">
                                                        {option.category}
                                                    </span>
                                                )}
                                                {option.language && (
                                                    <span className="text-2xs text-neutral-400">
                                                        {option.language}
                                                    </span>
                                                )}
                                            </div>
                                            {option.preview && (
                                                <p
                                                    className={cn(
                                                        'mt-1 break-words text-xs leading-relaxed text-neutral-600',
                                                        isExpanded
                                                            ? 'whitespace-pre-wrap'
                                                            : 'line-clamp-2'
                                                    )}
                                                >
                                                    {isExpanded ? option.preview : collapsedPreview}
                                                </p>
                                            )}
                                            {isTruncatable && (
                                                // Inside a cmdk item, whose own onClick selects the row:
                                                // stop the click here so opening the message does not
                                                // also pick the template and close the list.
                                                <button
                                                    type="button"
                                                    tabIndex={-1}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        toggleRow(option.value);
                                                    }}
                                                    onPointerDown={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                    className="mt-1 inline-flex items-center gap-1 text-2xs font-medium text-primary-500 hover:underline"
                                                >
                                                    {isExpanded ? collapseLabel : expandLabel}
                                                    <CaretDown
                                                        className={cn(
                                                            'size-3 transition-transform',
                                                            isExpanded && 'rotate-180'
                                                        )}
                                                    />
                                                </button>
                                            )}
                                        </div>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

/** Shape shared by the WhatsApp DTO, the message-template type and the settings service. */
interface TemplateLike {
    id?: string;
    name: string;
    category?: string;
    templateCategory?: string;
    language?: string;
    status?: string;
    bodyText?: string;
    subject?: string;
    content?: string;
    /** Names behind a WhatsApp template's positional `{{1}}` placeholders, when it has them. */
    bodyVariableNames?: string[];
}

/**
 * Adapt any of the template shapes in this codebase to the picker's options.
 * `valueKey` picks what the caller stores — some endpoints take a template name, others an id.
 */
export const toTemplateOptions = (
    templates: TemplateLike[],
    valueKey: 'name' | 'id' = 'name'
): TemplateOption[] =>
    templates
        .map((t) => ({
            value: (valueKey === 'id' ? t.id : t.name) ?? t.name,
            name: t.name,
            category: t.category || t.templateCategory,
            language: t.language,
            status: t.status,
            // Placeholders are resolved to their names first: a Meta template's body reads
            // "Dear {{1}}, your {{2}} starts…", which tells the reader nothing about the message.
            preview: flattenTemplateBody(
                humanizeTemplateText(t.bodyText || t.subject || t.content || '', {
                    variableNames: t.bodyVariableNames,
                })
            ),
        }))
        .filter((option) => !!option.value);

export default TemplateSearchableSelect;
