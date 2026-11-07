import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { YooptaPlugin, useYooptaEditor, PluginElementRenderProps } from '@yoopta/editor';
import { commitBlockProps } from './commitBlockProps';
import {
    RichTextField,
    RichTextHtml,
    encodeBlockData,
    decodeBlockData,
    isRichTextEmpty,
    ensureRichTextStyles,
} from './RichTextField';

interface ColumnData {
    content: string; // rich-text HTML (text and/or images)
}

const buildColumnPresets = (t: TFunction) => [
    { label: t('columnsCount', { count: 2 }), count: 2 },
    { label: t('columnsCount', { count: 3 }), count: 3 },
    { label: t('columnsCount', { count: 4 }), count: 4 },
];

// Columns colours — centralised so the file carries no scattered literal hex.
const C = {
    border: '#e0e0e0', // design-lint-ignore: Yoopta editor chrome — inline style required
    surface: '#fafafa', // design-lint-ignore: Yoopta editor chrome — inline style required
    headerBg: '#f0f0f0', // design-lint-ignore: Yoopta editor chrome — inline style required
    text: '#333333', // design-lint-ignore: Yoopta editor chrome — inline style required
    muted: '#666666', // design-lint-ignore: Yoopta editor chrome — inline style required
    controlBorder: '#cccccc', // design-lint-ignore: Yoopta editor chrome — inline style required
    accent: '#007acc', // design-lint-ignore: Yoopta editor chrome — inline style required
    white: '#ffffff', // design-lint-ignore: Yoopta editor chrome — inline style required
    cardBorder: '#e5e7eb', // design-lint-ignore: Yoopta editor chrome — inline style required
    label: '#999999', // design-lint-ignore: Yoopta editor chrome — inline style required
    placeholder: '#cccccc', // design-lint-ignore: Yoopta editor chrome — inline style required
};

export function ColumnsBlock({ element, attributes, children, blockId }: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryColumnsEditor');
    const editor = useYooptaEditor();
    const COLUMN_PRESETS = buildColumnPresets(t);
    const [columns, setColumns] = useState<ColumnData[]>(
        element?.props?.columns || [{ content: '' }, { content: '' }]
    );
    const [gap, setGap] = useState<number>(element?.props?.gap ?? 16);
    const [isEditing, setIsEditing] = useState(!element?.props?.columns?.length);
    // Refs mirror the latest committed state so the sync-from-props effect can
    // tell OUR OWN commit echoing back (skip it) from a genuine external change
    // (apply it). Comparing against React state instead let a commit bounce back
    // as a "change" → setState → re-commit → infinite loop that froze the page
    // after adding an image.
    const columnsRef = useRef<ColumnData[]>(columns);
    const gapRef = useRef<number>(gap);

    useEffect(() => {
        ensureRichTextStyles();
    }, []);

    // Sync local state ONLY on a genuine external prop change (e.g. after
    // deserialization) — never on our own commit echo (compared via the refs).
    useEffect(() => {
        const propColumns = element?.props?.columns;
        const propGap = element?.props?.gap;
        if (propColumns && JSON.stringify(propColumns) !== JSON.stringify(columnsRef.current)) {
            columnsRef.current = propColumns;
            setColumns(propColumns);
        }
        if (propGap !== undefined && propGap !== gapRef.current) {
            gapRef.current = propGap;
            setGap(propGap);
        }
    }, [element?.props?.columns, element?.props?.gap]);

    // Persist to Yoopta (Slate + block.value) so html.serialize reads fresh
    // props. Committed INLINE (not from a [columns] effect) so each edit is a
    // single render with no effect ping-pong.
    const commit = (nextColumns: ColumnData[], nextGap: number) => {
        columnsRef.current = nextColumns;
        gapRef.current = nextGap;
        setColumns(nextColumns);
        setGap(nextGap);
        commitBlockProps(editor, blockId, element, {
            columns: nextColumns,
            columnCount: nextColumns.length,
            gap: nextGap,
            editorType: 'columnsEditor',
        });
    };

    const setColumnCount = (count: number) => {
        const prev = columnsRef.current;
        const next =
            count > prev.length
                ? [...prev, ...Array.from({ length: count - prev.length }, () => ({ content: '' }))]
                : prev.slice(0, count);
        commit(next, gapRef.current);
    };

    const updateColumnContent = (index: number, content: string) => {
        const next = columnsRef.current.map((col, i) => (i === index ? { ...col, content } : col));
        commit(next, gapRef.current);
    };

    const updateGap = (nextGap: number) => commit(columnsRef.current, nextGap);

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
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    backgroundColor: C.headerBg,
                    borderBottom: `1px solid ${C.border}`,
                    flexWrap: 'wrap',
                    gap: '6px',
                }}
            >
                <span style={{ fontSize: '14px', fontWeight: 600, color: C.text }}>{t('columnsLayout')}</span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {/* Column count */}
                    {COLUMN_PRESETS.map((preset) => (
                        <button
                            key={preset.count}
                            onClick={() => setColumnCount(preset.count)}
                            style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                border: `1px solid ${C.controlBorder}`,
                                borderRadius: '4px',
                                backgroundColor: columns.length === preset.count ? C.accent : C.white,
                                color: columns.length === preset.count ? C.white : C.muted,
                                cursor: 'pointer',
                            }}
                        >
                            {preset.count}
                        </button>
                    ))}

                    {/* Gap control */}
                    <select
                        value={gap}
                        onChange={(e) => updateGap(Number(e.target.value))}
                        style={{ fontSize: '11px', padding: '3px 4px', border: `1px solid ${C.controlBorder}`, borderRadius: '4px' }}
                    >
                        <option value={8}>{t('gapTight')}</option>
                        <option value={16}>{t('gapNormal')}</option>
                        <option value={24}>{t('gapWide')}</option>
                        <option value={32}>{t('gapExtraWide')}</option>
                    </select>

                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        style={{
                            padding: '3px 10px',
                            fontSize: '12px',
                            border: `1px solid ${C.controlBorder}`,
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

            {/* Content */}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
                    gap: `${gap}px`,
                    padding: '12px',
                }}
            >
                {columns.map((col, index) =>
                    isEditing ? (
                        <div key={index} style={{ minWidth: 0 }}>
                            <div
                                style={{
                                    fontSize: '10px',
                                    color: C.label,
                                    fontWeight: 600,
                                    marginBottom: '4px',
                                }}
                            >
                                {t('columnLabel', { number: index + 1 })}
                            </div>
                            <RichTextField
                                value={col.content}
                                onChange={(html) => updateColumnContent(index, html)}
                                placeholder={t('columnPlaceholder', { number: index + 1 })}
                                minHeight={80}
                            />
                        </div>
                    ) : (
                        <div
                            key={index}
                            style={{
                                border: `1px solid ${C.cardBorder}`,
                                borderRadius: '8px',
                                background: C.white,
                                minHeight: '20px',
                                minWidth: 0,
                                padding: '14px 16px',
                            }}
                        >
                            {isRichTextEmpty(col.content) ? (
                                <span style={{ color: C.placeholder, fontStyle: 'italic', fontSize: '14px' }}>
                                    {t('emptyColumn')}
                                </span>
                            ) : (
                                <RichTextHtml
                                    html={col.content}
                                    style={{
                                        fontSize: '14px',
                                        lineHeight: 1.6,
                                        color: C.text,
                                        whiteSpace: 'pre-wrap',
                                    }}
                                />
                            )}
                        </div>
                    )
                )}
            </div>

            {children}
        </div>
    );
}

// Columns icon
const ColumnsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="18" rx="1" />
        <rect x="14" y="3" width="7" height="18" rx="1" />
    </svg>
);

// Yoopta Plugin Definition
export const ColumnsPlugin = new YooptaPlugin<{ columnsLayout: any }>({
    type: 'columnsLayout',
    elements: {
        columnsLayout: {
            render: ColumnsBlock,
        },
    },
    options: {
        display: {
            title: 'Columns Layout',
            description: 'Multi-column layout — each column supports text and images',
            icon: <ColumnsIcon />,
        },
        shortcuts: ['columns', 'cols', 'grid', 'layout'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'columnsLayout') {
                        return undefined;
                    }
                    const gap = parseInt(element.getAttribute('data-gap') || '16', 10);
                    // decodeBlockData handles both the new base64 payload and any
                    // older escaped-JSON data-columns. Normalize each column so a
                    // missing `content` can never make serialize throw.
                    const rawCols = decodeBlockData<ColumnData[]>(
                        element.getAttribute('data-columns'),
                        []
                    );
                    let columns: ColumnData[] = (Array.isArray(rawCols) ? rawCols : []).map((c) => ({
                        ...c,
                        content: String(c?.content ?? ''),
                    }));
                    if (columns.length === 0) {
                        columns = [{ content: '' }, { content: '' }];
                    }
                    return {
                        id: `cols-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'columnsLayout',
                        props: { columns, columnCount: columns.length, gap, editorType: 'columnsEditor' },
                        children: [{ text: '' }],
                    };
                },
            },
            serialize: (element, _children) => {
                // Bulletproof: must NEVER throw, or the whole-document Save aborts
                // and the per-block fallback silently drops this block. data-columns
                // (source of truth for the admin round-trip) is base64 so the
                // document-wide HTML sanitizers can't corrupt it.
                let columns: ColumnData[] = [];
                try {
                    const props = (element && element.props) || {};
                    columns = Array.isArray(props.columns) ? props.columns : [];
                } catch {
                    columns = [];
                }
                const gap = element?.props?.gap ?? 16;
                let columnsJson = '';
                try {
                    columnsJson = encodeBlockData(columns);
                } catch {
                    columnsJson = encodeBlockData([]);
                }

                const columnDivs = columns
                    .map((col) => {
                        // Rich HTML (may include images). Inserted RAW so the
                        // learner's generic HTML renderer shows formatting/images
                        // directly (columns aren't special-cased there). A real S3
                        // <img src> is safe: the document sanitizer only trims its
                        // query params (→ permanent URL) and never drops the tag.
                        const content = String(col?.content ?? '');
                        // Render each column as a distinct white card on the grey
                        // container so columns read as separate regions (otherwise
                        // adjacent columns with a tight gap blend into one block).
                        return `<div style="padding: 14px 16px; font-size: 14px; line-height: 1.6; color: ${C.text}; background: ${C.white}; border: 1px solid ${C.cardBorder}; border-radius: 8px; overflow-wrap: anywhere;">${content}</div>`;
                    })
                    .join('');

                return `<div data-yoopta-type="columnsLayout" data-editor-type="columnsEditor" data-columns="${columnsJson}" data-gap="${gap}" style="display: grid; grid-template-columns: repeat(${columns.length}, 1fr); gap: ${gap}px; padding: 12px; margin: 8px 0; border: 1px solid ${C.border}; border-radius: 8px; background: ${C.surface};">${columnDivs}</div>`;
            },
        },
    },
});
