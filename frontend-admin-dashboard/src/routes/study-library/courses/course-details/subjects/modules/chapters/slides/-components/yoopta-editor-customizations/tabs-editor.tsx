import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    YooptaPlugin,
    useYooptaEditor,
    useYooptaReadOnly,
    PluginElementRenderProps,
} from '@yoopta/editor';
import { commitBlockProps } from './commitBlockProps';
import {
    RichTextField,
    RichTextHtml,
    isRichTextEmpty,
    encodeBlockData,
    decodeBlockData,
} from './RichTextField';

interface TabItem {
    label: string;
    content: string; // rich-text HTML
    color?: string; // optional per-tab colour-coding (empty → default accent)
}

// Used only outside React (Yoopta's HTML deserializer parses legacy/pasted
// markup with no data-tabs attribute at all — that code path has no `t`
// available), so this fallback intentionally stays English-only.
const DEFAULT_TABS: TabItem[] = [
    { label: 'Tab 1', content: '' },
    { label: 'Tab 2', content: '' },
];

// The component-facing default, with translated tab labels.
const buildDefaultTabs = (t: TFunction): TabItem[] => [
    { label: t('defaultTabLabel', { number: 1 }), content: '' },
    { label: t('defaultTabLabel', { number: 2 }), content: '' },
];

// Curated palette for colour-coding tabs. Empty value → the default accent.
const buildTabColors = (t: TFunction): { value: string; label: string }[] => [
    { value: '', label: t('tabColors.default') },
    { value: '#2563eb', label: t('tabColors.blue') }, // design-lint-ignore: user-selectable tab colour
    { value: '#16a34a', label: t('tabColors.green') }, // design-lint-ignore: user-selectable tab colour
    { value: '#dc2626', label: t('tabColors.red') }, // design-lint-ignore: user-selectable tab colour
    { value: '#ea580c', label: t('tabColors.orange') }, // design-lint-ignore: user-selectable tab colour
    { value: '#9333ea', label: t('tabColors.purple') }, // design-lint-ignore: user-selectable tab colour
    { value: '#0d9488', label: t('tabColors.teal') }, // design-lint-ignore: user-selectable tab colour
    { value: '#db2777', label: t('tabColors.pink') }, // design-lint-ignore: user-selectable tab colour
    { value: '#4b5563', label: t('tabColors.gray') }, // design-lint-ignore: user-selectable tab colour
];

// Tab chrome colours — centralised so the file carries no scattered literal hex.
const C = {
    accent: '#007acc', // design-lint-ignore: Yoopta editor chrome — inline style required
    border: '#e0e0e0', // design-lint-ignore: Yoopta editor chrome — inline style required
    muted: '#666666', // design-lint-ignore: Yoopta editor chrome — inline style required
    surface: '#fafafa', // design-lint-ignore: Yoopta editor chrome — inline style required
    headerBg: '#f0f0f0', // design-lint-ignore: Yoopta editor chrome — inline style required
    tabBarBg: '#f5f5f5', // design-lint-ignore: Yoopta editor chrome — inline style required
    tabHover: '#ebebeb', // design-lint-ignore: Yoopta editor chrome — inline style required
    text: '#333333', // design-lint-ignore: Yoopta editor chrome — inline style required
    btnBorder: '#cccccc', // design-lint-ignore: Yoopta editor chrome — inline style required
    iconMuted: '#999999', // design-lint-ignore: Yoopta editor chrome — inline style required
    white: '#ffffff', // design-lint-ignore: Yoopta editor chrome — inline style required
};

// A tab's colour-code, falling back to the default accent when unset.
const tabColorOf = (t?: TabItem): string => (t && t.color) || C.accent;

export function TabsBlock({
    element,
    attributes,
    children,
    blockId,
}: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryTabsEditor');
    const editor = useYooptaEditor();
    const isReadOnly = useYooptaReadOnly();
    const hasStoredTabs = Array.isArray(element?.props?.tabs) && element.props.tabs.length > 0;
    const [tabs, setTabs] = useState<TabItem[]>(
        hasStoredTabs ? element!.props!.tabs : buildDefaultTabs(t)
    );
    const [activeTab, setActiveTab] = useState(0);
    const [isEditing, setIsEditing] = useState(!isReadOnly && !hasStoredTabs);
    const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
    const renameInputRef = useRef<HTMLInputElement | null>(null);
    const tabsRef = useRef<TabItem[]>(tabs);

    const commitTabs = (nextTabs: TabItem[]) => {
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        if (isReadOnly) return;
        commitBlockProps(editor, blockId, element, {
            tabs: nextTabs,
            editorType: 'tabsEditor',
        });
    };

    // Seed Yoopta with DEFAULT_TABS on first mount if the block has no stored tabs.
    useEffect(() => {
        if (!isReadOnly && !hasStoredTabs) {
            commitTabs(tabs);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync local state when element props change (e.g. after deserialization)
    useEffect(() => {
        const propTabs = element?.props?.tabs;
        if (
            Array.isArray(propTabs) &&
            propTabs.length > 0 &&
            JSON.stringify(propTabs) !== JSON.stringify(tabs)
        ) {
            tabsRef.current = propTabs;
            setTabs(propTabs);
        }
    }, [element?.props?.tabs]);

    useEffect(() => {
        if (renamingIndex !== null && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [renamingIndex]);

    // Backspace guard for the rename <input> only (the rich editor isolates its
    // own keys). Stops Slate from deleting the void block while renaming a tab.
    const handleRenameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Backspace') {
            const target = e.target as HTMLInputElement;
            if (target.value.length > 0 || target.selectionStart !== 0) {
                e.stopPropagation();
            }
        }
        if ((e.key === 'Enter' || e.key === 'Escape') && renamingIndex !== null) {
            e.preventDefault();
            setRenamingIndex(null);
        }
    };

    const updateTabLabel = (index: number, label: string) => {
        commitTabs(tabsRef.current.map((t, i) => (i === index ? { ...t, label } : t)));
    };

    const updateTabContent = (index: number, content: string) => {
        commitTabs(tabsRef.current.map((t, i) => (i === index ? { ...t, content } : t)));
    };

    const updateTabColor = (index: number, color: string) => {
        commitTabs(tabsRef.current.map((t, i) => (i === index ? { ...t, color } : t)));
    };

    const addTab = () => {
        const current = tabsRef.current;
        commitTabs([
            ...current,
            { label: t('defaultTabLabel', { number: current.length + 1 }), content: '' },
        ]);
        setActiveTab(current.length);
    };

    const removeTab = (index: number) => {
        const current = tabsRef.current;
        if (current.length <= 1) return;
        commitTabs(current.filter((_, i) => i !== index));
        if (activeTab >= current.length - 1) {
            setActiveTab(Math.max(0, current.length - 2));
        }
        if (renamingIndex === index) setRenamingIndex(null);
    };

    return (
        <div
            {...attributes}
            contentEditable={false}
            style={{
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                margin: '8px 0',
                overflow: 'hidden',
                backgroundColor: C.surface,
            }}
        >
            {/* Header — admin chrome only (hidden on learner read-only views). */}
            {!isReadOnly && (
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        backgroundColor: C.headerBg,
                        borderBottom: `1px solid ${C.border}`,
                    }}
                >
                    <span style={{ fontSize: '14px', fontWeight: 600, color: C.text }}>
                        {t('tabbedContent')}
                    </span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {isEditing && (
                            <button
                                onClick={addTab}
                                style={{
                                    padding: '3px 10px',
                                    fontSize: '12px',
                                    border: `1px solid ${C.btnBorder}`,
                                    borderRadius: '4px',
                                    backgroundColor: C.white,
                                    color: C.muted,
                                    cursor: 'pointer',
                                }}
                            >
                                {t('addTab')}
                            </button>
                        )}
                        <button
                            onClick={() => {
                                setIsEditing(!isEditing);
                                setRenamingIndex(null);
                            }}
                            style={{
                                padding: '3px 10px',
                                fontSize: '12px',
                                border: `1px solid ${C.btnBorder}`,
                                borderRadius: '4px',
                                backgroundColor: C.white,
                                color: C.muted,
                                cursor: 'pointer',
                            }}
                        >
                            {isEditing ? t('preview') : t('edit')}
                        </button>
                    </div>
                </div>
            )}

            {/* Tab Bar */}
            <div
                style={{
                    display: 'flex',
                    gap: '2px',
                    padding: '4px 4px 0 4px',
                    backgroundColor: C.tabBarBg,
                    borderBottom: `1px solid ${C.border}`,
                    overflowX: 'auto',
                }}
            >
                {tabs.map((tab, index) => {
                    const isActive = activeTab === index;
                    const isRenaming = renamingIndex === index;
                    const tc = tabColorOf(tab);
                    return (
                        <button
                            key={index}
                            type="button"
                            onClick={() => {
                                if (!isRenaming) setActiveTab(index);
                            }}
                            onDoubleClick={() => {
                                if (isEditing) setRenamingIndex(index);
                            }}
                            title={isEditing && !isRenaming ? t('switchOrRenameHint') : undefined}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '8px 14px',
                                fontSize: '13px',
                                fontWeight: isActive ? 600 : 500,
                                color: isActive ? tc : C.muted,
                                backgroundColor: isActive ? C.white : 'transparent',
                                border: 'none',
                                // Colour-code: every tab shows its colour as a top bar;
                                // the active tab is emphasised (white bg + bold + colour).
                                borderTop: `3px solid ${tc}`,
                                borderLeft: `1px solid ${isActive ? C.border : 'transparent'}`,
                                borderRight: `1px solid ${isActive ? C.border : 'transparent'}`,
                                borderTopLeftRadius: '6px',
                                borderTopRightRadius: '6px',
                                marginBottom: '-1px',
                                cursor: isRenaming ? 'text' : 'pointer',
                                whiteSpace: 'nowrap',
                                transition: 'background-color 0.15s, color 0.15s',
                                outline: 'none',
                            }}
                            onMouseEnter={(e) => {
                                if (!isActive && !isRenaming) {
                                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.tabHover;
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isActive && !isRenaming) {
                                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                                }
                            }}
                        >
                            {isRenaming ? (
                                <input
                                    ref={renameInputRef}
                                    value={tab.label}
                                    onChange={(e) => updateTabLabel(index, e.target.value)}
                                    onKeyDown={handleRenameKeyDown}
                                    onBlur={() => setRenamingIndex(null)}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                        border: `1px solid ${C.accent}`,
                                        borderRadius: '3px',
                                        background: C.white,
                                        fontSize: '13px',
                                        fontWeight: 600,
                                        color: C.accent,
                                        outline: 'none',
                                        padding: '2px 6px',
                                        minWidth: '60px',
                                        width: `${Math.max((tab.label || '').length * 8, 60)}px`,
                                    }}
                                />
                            ) : (
                                <span style={{ userSelect: 'none' }}>{tab.label || t('untitled')}</span>
                            )}
                            {isEditing && !isRenaming && (
                                <span
                                    role="button"
                                    aria-label={t('renameTab')}
                                    title={t('renameTab')}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setRenamingIndex(index);
                                    }}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '16px',
                                        height: '16px',
                                        color: isActive ? C.accent : C.iconMuted,
                                        cursor: 'pointer',
                                        opacity: 0.75,
                                    }}
                                >
                                    <svg
                                        width="11"
                                        height="11"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M12 20h9" />
                                        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                    </svg>
                                </span>
                            )}
                            {isEditing && tabs.length > 1 && !isRenaming && (
                                <span
                                    role="button"
                                    aria-label={t('removeTab')}
                                    title={t('removeTab')}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeTab(index);
                                    }}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '16px',
                                        height: '16px',
                                        borderRadius: '50%',
                                        color: C.iconMuted,
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                        lineHeight: '13px',
                                    }}
                                    onMouseEnter={(e) => {
                                        (e.currentTarget as HTMLSpanElement).style.backgroundColor = C.border;
                                        (e.currentTarget as HTMLSpanElement).style.color = C.text;
                                    }}
                                    onMouseLeave={(e) => {
                                        (e.currentTarget as HTMLSpanElement).style.backgroundColor = 'transparent';
                                        (e.currentTarget as HTMLSpanElement).style.color = C.iconMuted;
                                    }}
                                >
                                    ×
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content — the same rich text editor as the quiz block. Top
                border echoes the active tab's colour-code. */}
            <div
                style={{
                    padding: '12px',
                    minHeight: '80px',
                    backgroundColor: C.white,
                    borderTop: `3px solid ${tabColorOf(tabs[activeTab])}`,
                }}
            >
                {isEditing ? (
                    <>
                        {/* Per-tab colour picker */}
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                marginBottom: '10px',
                                flexWrap: 'wrap',
                            }}
                        >
                            <span style={{ fontSize: '11px', color: C.muted }}>{t('tabColorLabel')}</span>
                            {buildTabColors(t).map((c) => {
                                const selected = (tabs[activeTab]?.color || '') === c.value;
                                return (
                                    <button
                                        key={c.value || 'default'}
                                        type="button"
                                        onClick={() => updateTabColor(activeTab, c.value)}
                                        title={c.label}
                                        style={{
                                            width: '18px',
                                            height: '18px',
                                            borderRadius: '50%',
                                            border: selected
                                                ? `2px solid ${C.text}`
                                                : `1px solid ${C.btnBorder}`,
                                            backgroundColor: c.value || C.accent,
                                            cursor: 'pointer',
                                            padding: 0,
                                            flexShrink: 0,
                                        }}
                                    />
                                );
                            })}
                        </div>
                        <RichTextField
                            key={activeTab}
                            value={tabs[activeTab]?.content || ''}
                            onChange={(html) => updateTabContent(activeTab, html)}
                            placeholder={t('contentPlaceholder', {
                                label: tabs[activeTab]?.label || t('genericTab'),
                            })}
                            minHeight={100}
                        />
                    </>
                ) : !isRichTextEmpty(tabs[activeTab]?.content) ? (
                    <RichTextHtml
                        html={tabs[activeTab]?.content || ''}
                        style={{ fontSize: '14px', lineHeight: 1.6, color: C.text, padding: '8px' }}
                    />
                ) : (
                    <div style={{ fontSize: '14px', color: C.iconMuted, fontStyle: 'italic', padding: '8px' }}>
                        {t('emptyTabContent')}
                    </div>
                )}
            </div>

            {/* Slate requires {children} in the DOM for the block to be valid, but
                its default "Type / for commands" placeholder overlaid the content.
                Hide it visually while keeping it mounted. */}
            <div
                aria-hidden
                style={{
                    position: 'absolute',
                    width: 0,
                    height: 0,
                    overflow: 'hidden',
                    opacity: 0,
                    pointerEvents: 'none',
                }}
            >
                {children}
            </div>
        </div>
    );
}

// Tabs Icon
const TabsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="6" width="20" height="14" rx="2" />
        <path d="M2 6h6V3h4v3" />
    </svg>
);

// Yoopta Plugin Definition
export const TabsPlugin = new YooptaPlugin<{ tabbedContent: any }>({
    type: 'tabbedContent',
    elements: {
        tabbedContent: {
            render: TabsBlock,
        },
    },
    options: {
        display: {
            title: 'Tabbed Content',
            description: 'Organize content in switchable tabs',
            icon: <TabsIcon />,
        },
        shortcuts: ['tabs', 'tabbed'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'tabbedContent') {
                        return undefined;
                    }
                    // decodeBlockData handles BOTH the new base64 payload and any
                    // older raw/escaped-JSON data-tabs, so existing slides keep
                    // working.
                    let tabs: TabItem[] = decodeBlockData<TabItem[]>(
                        element.getAttribute('data-tabs'),
                        []
                    );
                    if (!Array.isArray(tabs) || tabs.length === 0) {
                        tabs = DEFAULT_TABS.map((t) => ({ ...t }));
                    }
                    return {
                        id: `tabs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'tabbedContent',
                        props: { tabs, editorType: 'tabsEditor' },
                        children: [{ text: '' }],
                    };
                },
            },
            serialize: (element, _children) => {
                // Bulletproof: must never throw, or it breaks the whole-document
                // Save ("Could not read editor content"). data-tabs (source of
                // truth) is always emitted; the static body is best-effort.
                let tabs: TabItem[];
                try {
                    const props = (element && element.props) || {};
                    const raw = Array.isArray(props.tabs) ? props.tabs : [];
                    tabs = raw.length > 0 ? raw : DEFAULT_TABS.map((t) => ({ ...t }));
                } catch {
                    tabs = DEFAULT_TABS.map((t) => ({ ...t }));
                }

                // base64 so the document-wide HTML sanitizers can never corrupt
                // the JSON (e.g. an S3 image URL inside a tab used to truncate it).
                let tabsJson: string;
                try {
                    tabsJson = encodeBlockData(tabs);
                } catch {
                    tabsJson = encodeBlockData(DEFAULT_TABS);
                }

                let headers = '';
                let contents = '';
                try {
                    headers = tabs
                        .map((tab, i) => {
                            const label = (tab && tab.label ? String(tab.label) : `Tab ${i + 1}`)
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;');
                            const tc = tabColorOf(tab);
                            return `<div style="padding: 8px 16px; font-size: 13px; font-weight: ${i === 0 ? 600 : 400}; color: ${i === 0 ? tc : C.muted}; border-top: 3px solid ${tc}; cursor: pointer;">${label}</div>`;
                        })
                        .join('');
                    contents = tabs
                        .map((tab, i) => {
                            // Content is already rich-text HTML → emit as-is.
                            const html = (tab && tab.content) || '';
                            return `<div data-tab-index="${i}" style="display: ${i === 0 ? 'block' : 'none'}; padding: 12px; font-size: 14px; line-height: 1.6; color: ${C.text};">${html}</div>`;
                        })
                        .join('');
                } catch {
                    headers = '';
                    contents = '';
                }

                return `<div data-yoopta-type="tabbedContent" data-editor-type="tabsEditor" data-tabs="${tabsJson}" style="border: 1px solid ${C.border}; border-radius: 8px; margin: 8px 0; overflow: hidden; background: ${C.surface};"><div style="display: flex; border-bottom: 1px solid ${C.border}; background: ${C.white};">${headers}</div><div>${contents}</div></div>`;
            },
        },
    },
});
