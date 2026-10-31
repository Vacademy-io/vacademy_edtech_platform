import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    $getSelection,
    $isRangeSelection,
    $createParagraphNode,
    type ElementNode,
    type LexicalEditor,
    type TextNode,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
    LexicalTypeaheadMenuPlugin,
    MenuOption,
    useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text';
import {
    INSERT_ORDERED_LIST_COMMAND,
    INSERT_UNORDERED_LIST_COMMAND,
    INSERT_CHECK_LIST_COMMAND,
} from '@lexical/list';
import { INSERT_TABLE_COMMAND } from '@lexical/table';
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode';
import {
    TextAa,
    TextHOne,
    TextHTwo,
    TextHThree,
    Quotes,
    ListBullets,
    ListNumbers,
    CheckSquare,
    Table,
    Minus,
    type Icon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export class SlashMenuOption extends MenuOption {
    title: string;
    description: string;
    menuIcon: Icon;
    keywords: string[];
    onSelect: (editor: LexicalEditor, queryString: string) => void;

    constructor(
        title: string,
        options: {
            description: string;
            menuIcon: Icon;
            keywords?: string[];
            onSelect: (editor: LexicalEditor, queryString: string) => void;
        }
    ) {
        super(title);
        this.title = title;
        this.description = options.description;
        this.menuIcon = options.menuIcon;
        this.keywords = options.keywords ?? [];
        this.onSelect = options.onSelect;
    }
}

const formatBlock = (editor: LexicalEditor, createNode: () => ElementNode) => {
    editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
            $setBlocksType(selection, createNode);
        }
    });
};

/** Core (standard rich-text) options. Custom block options are appended by
 *  buildSlashMenuOptions callers as they are implemented. */
export function buildCoreSlashOptions(t: TFunction): SlashMenuOption[] {
    return [
        new SlashMenuOption(t('options.text.title'), {
            description: t('options.text.description'),
            menuIcon: TextAa,
            keywords: ['paragraph', 'text', 'plain'],
            onSelect: (editor) => formatBlock(editor, () => $createParagraphNode()),
        }),
        ...(['1', '2', '3'] as const).map(
            (level) =>
                new SlashMenuOption(t(`options.heading${level}.title`), {
                    description: t(`options.heading${level}.description`),
                    menuIcon: level === '1' ? TextHOne : level === '2' ? TextHTwo : TextHThree,
                    keywords: ['heading', `h${level}`, 'title'],
                    onSelect: (editor) =>
                        formatBlock(editor, () =>
                            $createHeadingNode(`h${level}` as HeadingTagType)
                        ),
                })
        ),
        new SlashMenuOption(t('options.quote.title'), {
            description: t('options.quote.description'),
            menuIcon: Quotes,
            keywords: ['quote', 'blockquote'],
            onSelect: (editor) => formatBlock(editor, () => $createQuoteNode()),
        }),
        new SlashMenuOption(t('options.bulletedList.title'), {
            description: t('options.bulletedList.description'),
            menuIcon: ListBullets,
            keywords: ['list', 'bullet', 'ul'],
            onSelect: (editor) => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
        }),
        new SlashMenuOption(t('options.numberedList.title'), {
            description: t('options.numberedList.description'),
            menuIcon: ListNumbers,
            keywords: ['list', 'numbered', 'ol'],
            onSelect: (editor) => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
        }),
        new SlashMenuOption(t('options.todoList.title'), {
            description: t('options.todoList.description'),
            menuIcon: CheckSquare,
            keywords: ['todo', 'check', 'task'],
            onSelect: (editor) => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
        }),
        new SlashMenuOption(t('options.table.title'), {
            description: t('options.table.description'),
            menuIcon: Table,
            keywords: ['table', 'grid'],
            onSelect: (editor) =>
                editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: '3', rows: '3' }),
        }),
        new SlashMenuOption(t('options.divider.title'), {
            description: t('options.divider.description'),
            menuIcon: Minus,
            keywords: ['divider', 'hr', 'separator', 'line'],
            onSelect: (editor) => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
        }),
    ];
}

export function SlashMenuPlugin({ extraOptions = [] }: { extraOptions?: SlashMenuOption[] }) {
    const { t } = useTranslation('studyLibrarySlashMenuPlugin');
    const [editor] = useLexicalComposerContext();
    const [queryString, setQueryString] = useState<string | null>(null);

    const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', { minLength: 0 });

    const options = useMemo(() => {
        const all = [...buildCoreSlashOptions(t), ...extraOptions];
        if (!queryString) return all;
        const q = queryString.toLowerCase();
        return all.filter(
            (o) =>
                o.title.toLowerCase().includes(q) ||
                o.keywords.some((k) => k.toLowerCase().includes(q))
        );
    }, [queryString, extraOptions, t]);

    const onSelectOption = useCallback(
        (
            option: SlashMenuOption,
            nodeToRemove: TextNode | null,
            closeMenu: () => void,
            matchingString: string
        ) => {
            editor.update(() => {
                nodeToRemove?.remove();
            });
            option.onSelect(editor, matchingString);
            closeMenu();
        },
        [editor]
    );

    return (
        <LexicalTypeaheadMenuPlugin<SlashMenuOption>
            onQueryChange={setQueryString}
            onSelectOption={onSelectOption}
            triggerFn={checkForTriggerMatch}
            options={options}
            menuRenderFn={(
                anchorElementRef,
                { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
            ) =>
                anchorElementRef.current && options.length > 0
                    ? ReactDOM.createPortal(
                          <SlashMenuList
                              anchorEl={anchorElementRef.current}
                              options={options}
                              selectedIndex={selectedIndex}
                              selectOptionAndCleanUp={selectOptionAndCleanUp}
                              setHighlightedIndex={setHighlightedIndex}
                          />,
                          anchorElementRef.current
                      )
                    : null
            }
        />
    );
}

/** The dropdown list: keeps the keyboard-highlighted option scrolled into
 *  view, flips above the caret when there isn't enough room below, and clamps
 *  its height to the available viewport space so the list always scrolls
 *  instead of clipping off-screen. */
function SlashMenuList({
    anchorEl,
    options,
    selectedIndex,
    selectOptionAndCleanUp,
    setHighlightedIndex,
}: {
    anchorEl: HTMLElement;
    options: SlashMenuOption[];
    selectedIndex: number | null;
    selectOptionAndCleanUp: (option: SlashMenuOption) => void;
    setHighlightedIndex: (index: number) => void;
}) {
    const listRef = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<{ flipUp: boolean; maxHeight: number }>({
        flipUp: false,
        maxHeight: 320,
    });

    // Decide direction + height from the space around the caret anchor.
    useLayoutEffect(() => {
        const rect = anchorEl.getBoundingClientRect();
        const margin = 12;
        const spaceBelow = window.innerHeight - rect.bottom - margin;
        const spaceAbove = rect.top - margin;
        const flipUp = spaceBelow < 240 && spaceAbove > spaceBelow;
        const maxHeight = Math.min(320, Math.max(160, flipUp ? spaceAbove : spaceBelow));
        setPlacement({ flipUp, maxHeight });
    }, [anchorEl, options.length]);

    // Keep the keyboard-highlighted option visible while arrowing through.
    useEffect(() => {
        if (selectedIndex === null) return;
        listRef.current
            ?.querySelector(`[data-menu-index="${selectedIndex}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    return (
        <div
            ref={listRef}
            className={cn(
                'absolute z-50 w-72 overflow-y-auto overscroll-contain rounded-lg border border-neutral-200 bg-white py-2 shadow-lg',
                placement.flipUp ? 'bottom-full mb-1' : 'top-full mt-1'
            )}
            style={{ maxHeight: placement.maxHeight }}
        >
            {options.map((option, i) => {
                const IconComp = option.menuIcon;
                return (
                    <button
                        key={option.key}
                        type="button"
                        tabIndex={-1}
                        role="option"
                        aria-selected={selectedIndex === i}
                        data-menu-index={i}
                        className={cn(
                            'flex w-full items-center gap-3 px-3 py-2 text-left',
                            selectedIndex === i && 'bg-neutral-100'
                        )}
                        ref={option.setRefElement}
                        onMouseEnter={() => setHighlightedIndex(i)}
                        onClick={() => {
                            setHighlightedIndex(i);
                            selectOptionAndCleanUp(option);
                        }}
                    >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white">
                            <IconComp size={18} />
                        </span>
                        <span className="flex flex-col">
                            <span className="text-subtitle font-medium text-neutral-700">
                                {option.title}
                            </span>
                            <span className="text-caption text-neutral-500">
                                {option.description}
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
