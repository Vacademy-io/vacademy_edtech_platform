import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
    encodeBlockData,
    decodeBlockData,
    isRichTextEmpty,
    ensureRichTextStyles,
} from './RichTextField';

interface FlashcardData {
    front: string; // rich-text HTML (text and/or images)
    back: string; // rich-text HTML (text and/or images)
    aspectRatio?: string; // 'original' | '1:1' | '4:3' | '16:9' — image fit
}

const DEFAULT_FLASHCARD: FlashcardData = { front: '', back: '', aspectRatio: 'original' };

// Image aspect-ratio presets. Choosing one fits every <img> in the card into that
// ratio box (contained — never cropped or stretched) via the CSS injected below.
const ASPECT_RATIOS: { value: string; label: string; ratio: string; className: string }[] = [
    { value: 'original', label: 'Original', ratio: '', className: '' },
    { value: '1:1', label: '1:1', ratio: '1 / 1', className: 'fc-ar-1-1' },
    { value: '4:3', label: '4:3', ratio: '4 / 3', className: 'fc-ar-4-3' },
    { value: '16:9', label: '16:9', ratio: '16 / 9', className: 'fc-ar-16-9' },
];
const ratioClassFor = (value?: string): string =>
    ASPECT_RATIOS.find((r) => r.value === value)?.className || '';

// Inject the aspect-ratio image rules once (idempotent). Each rule fits images
// into a fixed-ratio box while preserving the image's own proportions (contain).
function ensureFlashcardRatioStyles() {
    if (typeof document === 'undefined') return;
    const ratioRules = ASPECT_RATIOS.filter((r) => r.className)
        .map((r) => `.${r.className} img { aspect-ratio: ${r.ratio}; width: 100%; }`)
        .join('\n');
    // Base rule bounds EVERY flashcard image so a card never gets oversized
    // ("too lengthy"). The ratio rules add the chosen shape on top; the card
    // itself is width-capped in the render, so a ratio box can't run wide.
    const css =
        `.fc-card-img img { max-width: 100%; max-height: 300px; height: auto; object-fit: contain; display: block; margin: 4px auto; }\n` +
        ratioRules;
    let style = document.getElementById('flashcard-ratio-styles') as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = 'flashcard-ratio-styles';
        document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
}

// Flashcard colours — centralised so the file carries no scattered literal hex.
const C = {
    border: '#e0e0e0', // design-lint-ignore: Yoopta editor chrome — inline style required
    surface: '#fafafa', // design-lint-ignore: Yoopta editor chrome — inline style required
    headerBg: '#f0f0f0', // design-lint-ignore: Yoopta editor chrome — inline style required
    text: '#333333', // design-lint-ignore: Yoopta editor chrome — inline style required
    muted: '#666666', // design-lint-ignore: Yoopta editor chrome — inline style required
    label: '#555555', // design-lint-ignore: Yoopta editor chrome — inline style required
    accent: '#007acc', // design-lint-ignore: Yoopta editor chrome — inline style required
    accentSoft: '#f0f7ff', // design-lint-ignore: Yoopta editor chrome — inline style required
    white: '#ffffff', // design-lint-ignore: Yoopta editor chrome — inline style required
    placeholder: '#cccccc', // design-lint-ignore: Yoopta editor chrome — inline style required
    hint: '#999999', // design-lint-ignore: Yoopta editor chrome — inline style required
};

// Strip HTML tags to plain text — used only for the legacy data-front/data-back
// fallback attributes (kept for renderers that predate the base64 payload). We
// strip tags so no S3 image URL ever lands in a data-* attribute the document
// sanitizer could truncate; the rich payload lives safely in base64 data-flashcard.
const htmlToText = (html: string): string =>
    (html || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();

const escapeAttr = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function FlashcardBlock({ element, attributes, children, blockId }: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryFlashcardEditor');
    const editor = useYooptaEditor();
    const isReadOnly = useYooptaReadOnly();

    const [data, setData] = useState<FlashcardData>({
        front: element?.props?.front || '',
        back: element?.props?.back || '',
        aspectRatio: element?.props?.aspectRatio || 'original',
    });
    const dataRef = useRef<FlashcardData>(data);
    const [isFlipped, setIsFlipped] = useState(false);
    const [isEditing, setIsEditing] = useState(
        !isReadOnly && isRichTextEmpty(element?.props?.front || '')
    );

    useEffect(() => {
        ensureRichTextStyles();
        ensureFlashcardRatioStyles();
    }, []);

    // Sync local state when element props change (e.g. after deserialization).
    useEffect(() => {
        const pf = element?.props?.front || '';
        const pb = element?.props?.back || '';
        const par = element?.props?.aspectRatio || 'original';
        if (
            pf !== dataRef.current.front ||
            pb !== dataRef.current.back ||
            par !== (dataRef.current.aspectRatio || 'original')
        ) {
            const next = { front: pf, back: pb, aspectRatio: par };
            dataRef.current = next;
            setData(next);
        }
    }, [element?.props?.front, element?.props?.back, element?.props?.aspectRatio]);

    // Persist to Yoopta (Slate + block.value) so html.serialize reads fresh props.
    const commit = (next: FlashcardData) => {
        dataRef.current = next;
        setData(next);
        if (isReadOnly) return;
        commitBlockProps(editor, blockId, element, {
            front: next.front,
            back: next.back,
            aspectRatio: next.aspectRatio || 'original',
            editorType: 'flashcardEditor',
        });
    };
    const updateFront = (html: string) => commit({ ...dataRef.current, front: html });
    const updateBack = (html: string) => commit({ ...dataRef.current, back: html });
    const updateAspectRatio = (aspectRatio: string) => commit({ ...dataRef.current, aspectRatio });

    const ratioClass = ratioClassFor(data.aspectRatio);
    // Always bound flashcard images (fc-card-img); add the chosen ratio on top.
    const imgWrapClass = `fc-card-img ${ratioClass}`.trim();

    const labelStyle: React.CSSProperties = {
        fontSize: '12px',
        fontWeight: 600,
        color: C.label,
        marginBottom: '6px',
        textTransform: 'uppercase',
    };

    // A single flip face. Both faces share grid-area 1/1 so the card grows to the
    // taller of the two — text OR image content — without a fixed height or spacer.
    const face = (side: 'front' | 'back') => {
        const isFront = side === 'front';
        const html = isFront ? data.front : data.back;
        const empty = isRichTextEmpty(html);
        return (
            <div
                style={{
                    gridArea: '1 / 1',
                    position: 'relative',
                    minHeight: '150px',
                    backfaceVisibility: 'hidden',
                    transform: isFront ? undefined : 'rotateY(180deg)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '28px 24px',
                    backgroundColor: isFront ? C.white : C.accent,
                    borderRadius: '8px',
                    border: `2px solid ${C.accent}`,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                }}
            >
                <div
                    style={{
                        position: 'absolute',
                        top: '8px',
                        left: '12px',
                        fontSize: '10px',
                        color: isFront ? C.accent : 'rgba(255,255,255,0.7)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                    }}
                >
                    {isFront ? t('front') : t('back')}
                </div>
                {empty ? (
                    <span
                        style={{
                            color: isFront ? C.placeholder : 'rgba(255,255,255,0.5)',
                            fontStyle: 'italic',
                        }}
                    >
                        {t('noContent')}
                    </span>
                ) : (
                    <div className={imgWrapClass} style={{ width: '100%', maxWidth: '100%' }}>
                        <RichTextHtml
                            html={html}
                            style={{
                                fontSize: '16px',
                                color: isFront ? C.text : C.white,
                                textAlign: 'center',
                                maxWidth: '100%',
                                // Keeps line breaks in legacy plain-text cards; harmless
                                // for rich HTML (which uses block elements for newlines).
                                whiteSpace: 'pre-wrap',
                            }}
                        />
                    </div>
                )}
                <div
                    style={{
                        position: 'absolute',
                        bottom: '8px',
                        fontSize: '11px',
                        color: isFront ? C.hint : 'rgba(255,255,255,0.6)',
                    }}
                >
                    {isFront ? t('clickToFlip') : t('clickToFlipBack')}
                </div>
            </div>
        );
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
            {/* Header */}
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
                <span style={{ fontSize: '14px', fontWeight: 600, color: C.text }}>{t('flashcard')}</span>
                {!isReadOnly && (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {isEditing && (
                            <select
                                value={data.aspectRatio || 'original'}
                                onChange={(e) => updateAspectRatio(e.target.value)}
                                title={t('imageAspectRatioTitle')}
                                style={{
                                    fontSize: '11px',
                                    padding: '3px 4px',
                                    border: `1px solid ${C.border}`,
                                    borderRadius: '4px',
                                    backgroundColor: C.white,
                                    color: C.muted,
                                    cursor: 'pointer',
                                }}
                            >
                                {ASPECT_RATIOS.map((r) => (
                                    <option key={r.value} value={r.value}>
                                        {r.value === 'original'
                                            ? t('imageAspectRatioOriginal')
                                            : t('imageAspectRatioValue', { label: r.label })}
                                    </option>
                                ))}
                            </select>
                        )}
                        <button
                            onClick={() => {
                                setIsEditing(!isEditing);
                                setIsFlipped(false);
                            }}
                            style={{
                                padding: '3px 10px',
                                fontSize: '12px',
                                border: `1px solid ${C.border}`,
                                borderRadius: '4px',
                                backgroundColor: C.white,
                                color: C.muted,
                                cursor: 'pointer',
                            }}
                        >
                            {isEditing ? t('preview') : t('edit')}
                        </button>
                    </div>
                )}
            </div>

            {/* Content */}
            <div style={{ padding: '12px' }}>
                {isEditing ? (
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {/* Front side */}
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={labelStyle}>{t('frontLabel')}</div>
                            <div className={imgWrapClass}>
                                <RichTextField
                                    value={data.front}
                                    onChange={updateFront}
                                    placeholder={t('frontPlaceholder')}
                                    minHeight={80}
                                />
                            </div>
                        </div>
                        {/* Back side */}
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={labelStyle}>{t('backLabel')}</div>
                            <div className={imgWrapClass}>
                                <RichTextField
                                    value={data.back}
                                    onChange={updateBack}
                                    placeholder={t('backPlaceholder')}
                                    minHeight={80}
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Preview — flip card. Width-capped + centered so it stays a
                       compact card instead of spanning the whole editor. */
                    <div style={{ maxWidth: '420px', margin: '0 auto' }}>
                        <div
                            style={{ perspective: '1000px', cursor: 'pointer' }}
                            onClick={() => setIsFlipped(!isFlipped)}
                        >
                            <div
                                style={{
                                    display: 'grid',
                                    transition: 'transform 0.6s',
                                    transformStyle: 'preserve-3d',
                                    transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                                }}
                            >
                                {face('front')}
                                {face('back')}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {children}
        </div>
    );
}

// Flashcard Icon
const FlashcardIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="3 3" />
    </svg>
);

// Yoopta Plugin Definition
export const FlashcardPlugin = new YooptaPlugin<{ flashcard: any }>({
    type: 'flashcard',
    elements: {
        flashcard: {
            render: FlashcardBlock,
        },
    },
    options: {
        display: {
            title: 'Flashcard',
            description: 'Flip card with front and back — supports text and images',
            icon: <FlashcardIcon />,
        },
        shortcuts: ['flashcard', 'flip', 'card'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'flashcard') {
                        return undefined;
                    }
                    // Prefer the base64 payload (rich HTML, survives the document
                    // sanitizers). Fall back to legacy plain-text data-front/data-back
                    // for flashcards created before image support.
                    const encoded = element.getAttribute('data-flashcard');
                    let front = '';
                    let back = '';
                    let aspectRatio = 'original';
                    if (encoded) {
                        const d = decodeBlockData<FlashcardData>(encoded, DEFAULT_FLASHCARD);
                        front = d.front || '';
                        back = d.back || '';
                        aspectRatio = d.aspectRatio || 'original';
                    } else {
                        front = element.getAttribute('data-front') || '';
                        back = element.getAttribute('data-back') || '';
                        aspectRatio = element.getAttribute('data-aspect-ratio') || 'original';
                    }
                    return {
                        id: `fc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'flashcard',
                        props: { front, back, aspectRatio, editorType: 'flashcardEditor' },
                        children: [{ text: '' }],
                    };
                },
            },
            serialize: (element, _children) => {
                // Must never throw — a throwing serializer aborts the whole-document
                // Save Draft / Publish. encodeBlockData already swallows its errors.
                const props = element.props || {};
                const front = props.front || '';
                const back = props.back || '';
                const aspectRatio = props.aspectRatio || 'original';

                // base64 payload (source of truth) so the document-wide HTML
                // sanitizers can never corrupt an S3 image URL inside the rich text.
                const payload = encodeBlockData({ front, back, aspectRatio });

                // Legacy plain-text fallback for renderers that predate data-flashcard.
                const frontText = escapeAttr(htmlToText(front));
                const backText = escapeAttr(htmlToText(back));

                // Static visible body (rich HTML incl. images) for any renderer that
                // just dumps the HTML. Real <img src> is safe here — the document
                // sanitizer only trims S3 query params, it doesn't drop the tag.
                let body = '';
                try {
                    body =
                        `<div style="padding: 16px; text-align: center; background: ${C.white};">` +
                        `<div style="font-size: 10px; color: ${C.accent}; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">Front</div>` +
                        `<div style="font-size: 16px; color: ${C.text};">${front}</div></div>` +
                        `<div style="border-top: 2px dashed ${C.accent}; padding: 16px; text-align: center; background: ${C.accentSoft};">` +
                        `<div style="font-size: 10px; color: ${C.accent}; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">Back</div>` +
                        `<div style="font-size: 16px; color: ${C.text};">${back}</div></div>`;
                } catch {
                    body = '';
                }

                return `<div data-yoopta-type="flashcard" data-editor-type="flashcardEditor" data-flashcard="${payload}" data-front="${frontText}" data-back="${backText}" data-aspect-ratio="${escapeAttr(aspectRatio)}" style="border: 2px solid ${C.accent}; border-radius: 8px; margin: 8px 0; overflow: hidden;">${body}</div>`;
            },
        },
    },
});
