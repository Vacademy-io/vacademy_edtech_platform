import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { YooptaPlugin, useYooptaEditor, Elements, PluginElementRenderProps } from '@yoopta/editor';

interface TocItem {
    blockId: string;
    level: 1 | 2 | 3;
    text: string;
    order: number;
}

// Map both the block plugin type (block.type, e.g. "HeadingOne") AND the Slate
// element type (block.value[0].type, e.g. "heading-one") to a heading level.
// The previous version keyed only on the element-type strings but read
// block.type — which is "HeadingOne" — so the lookup never matched and the TOC
// always reported "No headings found". Covering both shapes makes detection
// robust across Yoopta versions.
const HEADING_LEVEL: Record<string, 1 | 2 | 3> = {
    HeadingOne: 1,
    HeadingTwo: 2,
    HeadingThree: 3,
    'heading-one': 1,
    'heading-two': 2,
    'heading-three': 3,
};

// Plugin block type to insert for each heading level (used by the add buttons).
const HEADING_BLOCK_TYPE: Record<1 | 2 | 3, string> = {
    1: 'HeadingOne',
    2: 'HeadingTwo',
    3: 'HeadingThree',
};

// Editor-chrome colours for this Yoopta custom block. Inline styles are
// unavoidable for a Slate render (and the serialized HTML below), so the hex is
// centralised here — each annotated — and the JSX itself stays literal-hex-free.
const C = {
    accent: '#007acc', // design-lint-ignore: Yoopta editor chrome — inline style required
    accentSoft: '#e8f4fd', // design-lint-ignore: Yoopta editor chrome — inline style required
    surface: '#fafafa', // design-lint-ignore: Yoopta editor chrome — inline style required
    headerBg: '#f0f0f0', // design-lint-ignore: Yoopta editor chrome — inline style required
    border: '#e0e0e0', // design-lint-ignore: Yoopta editor chrome — inline style required
    borderSoft: '#eeeeee', // design-lint-ignore: Yoopta editor chrome — inline style required
    btnBorder: '#d0d0d0', // design-lint-ignore: Yoopta editor chrome — inline style required
    white: '#ffffff', // design-lint-ignore: Yoopta editor chrome — inline style required
    title: '#333333', // design-lint-ignore: Yoopta editor chrome — inline style required
    icon: '#555555', // design-lint-ignore: Yoopta editor chrome — inline style required
    muted: '#888888', // design-lint-ignore: Yoopta editor chrome — inline style required
    mutedSoft: '#999999', // design-lint-ignore: Yoopta editor chrome — inline style required
};

function getHeadingLevel(block: any): 1 | 2 | 3 | null {
    if (!block) return null;
    const byBlock = HEADING_LEVEL[block.type];
    if (byBlock) return byBlock;
    const elType = block.value?.[0]?.type;
    return (elType && HEADING_LEVEL[elType]) || null;
}

function extractHeadings(editorChildren: Record<string, any>): TocItem[] {
    if (!editorChildren || typeof editorChildren !== 'object') return [];

    return Object.values(editorChildren)
        .map((block: any) => {
            const level = getHeadingLevel(block);
            if (!level) return null;
            let text = '';
            const el = block.value?.[0];
            if (el?.children && Array.isArray(el.children)) {
                text = el.children.map((node: any) => node.text || '').join('');
            }
            return {
                blockId: block.id,
                level,
                text: text.trim(),
                order: block.meta?.order ?? 0,
            } as TocItem;
        })
        .filter((item): item is TocItem => item !== null && item.text.length > 0)
        .sort((a, b) => a.order - b.order);
}

function sameHeadings(a: TocItem[], b: TocItem[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const x = a[i]!;
        const y = b[i]!;
        if (x.blockId !== y.blockId || x.text !== y.text || x.level !== y.level || x.order !== y.order) {
            return false;
        }
    }
    return true;
}

export function TableOfContentsBlock({
    element,
    attributes,
    children,
    blockId,
}: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryTableOfContents');
    const editor = useYooptaEditor();
    const [headings, setHeadings] = useState<TocItem[]>([]);
    const isFirstRender = useRef(true);

    const refreshHeadings = useCallback(() => {
        const items = extractHeadings(editor.children);
        // Replace state only when the outline actually changed, so typing inside
        // a paragraph/heading doesn't re-render this block on every keystroke.
        setHeadings((prev) => (sameHeadings(prev, items) ? prev : items));
    }, [editor]);

    // Initial scan + keep in sync with the document (no manual "Refresh").
    useEffect(() => {
        refreshHeadings();

        // Defer the refresh to the next frame instead of running setState
        // synchronously inside Yoopta's change event. Re-rendering this block
        // mid-edit can disrupt the editor's selection/scroll restoration — which
        // is what made Shift+Enter (a soft line break) jump the view to the top.
        // rAF lets the editor finish applying the change first, and coalesces
        // bursts of changes into a single refresh.
        let raf = 0;
        const handleChange = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(refreshHeadings);
        };

        editor.on('change', handleChange);
        return () => {
            cancelAnimationFrame(raf);
            editor.off('change', handleChange);
        };
    }, [editor, refreshHeadings]);

    // Persist to Yoopta store
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        Elements.updateElement(editor, blockId, {
            type: 'tableOfContents',
            props: {
                ...element.props,
                editorType: 'tocEditor',
            },
        });
    }, []);

    const scrollToBlock = (targetBlockId: string) => {
        // Try to find the block's DOM element and scroll to it
        const blockEl = document.querySelector(`[data-yoopta-block-id="${targetBlockId}"]`);
        if (blockEl) {
            blockEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Focus the block
            try {
                (editor as any).focusBlock?.(targetBlockId);
            } catch {
                // focusBlock may not exist in all versions
            }
        }
    };

    // Insert a real Heading block into the document, just below this TOC, and
    // focus it so the author can type immediately. The TOC then picks it up via
    // the editor 'change' listener once it has text. This answers the common
    // confusion — "where do I add a heading?" — since headings are separate
    // document blocks, not rows typed inside the TOC.
    const addHeading = (level: 1 | 2 | 3) => {
        try {
            const children = editor.children as Record<string, any>;
            const tocOrder = children[blockId]?.meta?.order ?? 0;
            // Append AFTER the last heading already sitting below this TOC, so
            // headings stack in the order they're added (H1, then H2, then H3…).
            // Inserting at tocOrder+1 every time would push earlier headings down
            // and reverse the sequence. Fall back to just below the TOC when none
            // exist yet.
            let insertAt = tocOrder + 1;
            Object.values(children).forEach((b: any) => {
                const order = b?.meta?.order ?? 0;
                if (getHeadingLevel(b) != null && order > tocOrder && order + 1 > insertAt) {
                    insertAt = order + 1;
                }
            });
            (editor as any).insertBlock(HEADING_BLOCK_TYPE[level], {
                at: insertAt,
                focus: true,
            });
        } catch (err) {
            console.error('[TOC] Failed to insert heading block:', err);
        }
    };

    // One compact, clearly-labelled row: "Add a heading:  H1  H2  H3".
    // withDivider draws a separating line when an outline already sits above it.
    const renderAddRow = (withDivider: boolean) => (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                marginTop: withDivider ? '12px' : '8px',
                paddingTop: withDivider ? '12px' : '0',
                borderTop: withDivider ? `1px solid ${C.borderSoft}` : 'none',
            }}
        >
            <span style={{ fontSize: '12px', color: C.muted }}>{t('block.addHeading')}</span>
            {([1, 2, 3] as const).map((lvl) => (
                <button
                    key={lvl}
                    onClick={() => addHeading(lvl)}
                    style={{
                        padding: '4px 11px',
                        fontSize: '12px',
                        fontWeight: 500,
                        border: `1px solid ${C.btnBorder}`,
                        borderRadius: '5px',
                        backgroundColor: C.white,
                        color: C.accent,
                        cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = C.accentSoft;
                        (e.currentTarget as HTMLElement).style.borderColor = C.accent;
                    }}
                    onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = C.white;
                        (e.currentTarget as HTMLElement).style.borderColor = C.btnBorder;
                    }}
                >
                    H{lvl}
                </button>
            ))}
        </div>
    );

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
            {/* Header — title + a one-line helper. No "Refresh": the outline
                auto-updates on every edit, so a manual button only confuses. */}
            <div
                style={{
                    padding: '8px 12px',
                    backgroundColor: C.headerBg,
                    borderBottom: `1px solid ${C.border}`,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'inline-flex', color: C.icon }}>
                        <TocIcon />
                    </span>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: C.title }}>
                        {t('block.title')}
                    </span>
                </div>
                <div style={{ fontSize: '11px', color: C.muted, marginTop: '3px', marginLeft: '24px' }}>
                    {t('block.subtitle')}
                </div>
            </div>

            {/* Content */}
            <div style={{ padding: '12px 16px' }}>
                {headings.length > 0 ? (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {headings.map((item) => (
                            <li
                                key={item.blockId}
                                onClick={() => scrollToBlock(item.blockId)}
                                title={t('block.jumpToHeadingTitle')}
                                style={{
                                    padding: `5px 8px 5px ${(item.level - 1) * 18 + 8}px`,
                                    fontSize: item.level === 1 ? '14px' : '13px',
                                    fontWeight: item.level === 1 ? 600 : item.level === 2 ? 500 : 400,
                                    color: C.accent,
                                    cursor: 'pointer',
                                    borderRadius: '4px',
                                    transition: 'background-color 0.15s',
                                    lineHeight: 1.6,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}
                                onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLElement).style.backgroundColor = C.accentSoft;
                                }}
                                onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                                }}
                            >
                                {item.text}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div style={{ color: C.mutedSoft, fontSize: '13px', lineHeight: 1.5 }}>
                        {t('block.emptyState')}
                    </div>
                )}

                {renderAddRow(headings.length > 0)}
            </div>

            {/* Slate requires {children} in the DOM for the block to be valid, but
                its empty-paragraph placeholder ("Type / for commands") was
                overlaying our content. Hide it visually while keeping it mounted. */}
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

// TOC Icon
const TocIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="7" y1="12" x2="21" y2="12" />
        <line x1="7" y1="18" x2="21" y2="18" />
        <circle cx="3" cy="12" r="1" fill="currentColor" />
        <circle cx="3" cy="18" r="1" fill="currentColor" />
    </svg>
);

// Yoopta Plugin Definition
export const TableOfContentsPlugin = new YooptaPlugin<{ tableOfContents: any }>({
    type: 'tableOfContents',
    elements: {
        tableOfContents: {
            render: TableOfContentsBlock,
        },
    },
    options: {
        display: {
            title: 'Table of Contents',
            description: 'Auto-generated outline from headings',
            icon: <TocIcon />,
        },
        shortcuts: ['toc', 'outline', 'contents'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'tableOfContents') {
                        return undefined;
                    }
                    return {
                        id: `toc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'tableOfContents',
                        props: { editorType: 'tocEditor' },
                        children: [{ text: '' }],
                    };
                },
            },
            serialize: (element, _children) => {
                // Static placeholder only — the serializer can't read editor.children,
                // so the learner renderer (DocumentWithMermaid) detects this marker and
                // rebuilds a real, clickable outline from the document's headings.
                return `<div data-yoopta-type="tableOfContents" data-editor-type="tocEditor" style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 8px 0; background: #fafafa;"><div style="font-weight: 600; font-size: 15px; color: #333; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">Table of Contents</div><div style="color: #666; font-size: 13px;">Outline is auto-generated from document headings.</div></div>`; // design-lint-ignore: serialized HTML must carry literal colours (no Tailwind on learner output)
            },
        },
    },
});
