import { useState, useEffect, useRef } from 'react';
import { YooptaPlugin, useYooptaEditor, PluginElementRenderProps } from '@yoopta/editor';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { commitBlockProps } from './commitBlockProps';
import { RichTextField, RichTextHtml, isRichTextEmpty, ensureRichTextStyles } from './RichTextField';

interface AccordionItem {
    heading: string; // plain-text section title
    content: string; // rich-text HTML (text and/or images)
}

const DEFAULT_ITEMS: AccordionItem[] = [{ heading: '', content: '' }];

// Accordion colours — centralised so the file carries no scattered literal hex.
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
    controlBorder: '#cccccc', // design-lint-ignore: Yoopta editor chrome — inline style required
    cardBorder: '#e5e7eb', // design-lint-ignore: Yoopta editor chrome — inline style required
    placeholder: '#999999', // design-lint-ignore: Yoopta editor chrome — inline style required
};

const escapeText = (s: string): string =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Pull { heading, content } out of a <details> node (both new rich accordions and
// legacy built-in accordions serialize to <details><summary>…</summary>…</details>).
const parseDetails = (d: Element): AccordionItem => {
    const summary = d.querySelector('summary');
    const heading = (summary?.textContent || '').trim();
    // Content = everything inside <details> except the <summary>.
    const clone = d.cloneNode(true) as Element;
    const s = clone.querySelector('summary');
    if (s) s.remove();
    return { heading, content: (clone as HTMLElement).innerHTML.trim() };
};

export function AccordionBlock({ element, attributes, children, blockId }: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryAccordionEditor');
    const editor = useYooptaEditor();
    const [items, setItems] = useState<AccordionItem[]>(
        element?.props?.items?.length ? element.props.items : DEFAULT_ITEMS
    );
    const [isEditing, setIsEditing] = useState(!element?.props?.items?.length);
    // Ref mirrors the latest committed state so the sync-from-props effect can tell
    // OUR OWN commit echoing back (skip it) from a genuine external change (apply
    // it) — comparing against React state instead can loop and freeze the page.
    const itemsRef = useRef<AccordionItem[]>(items);

    useEffect(() => {
        ensureRichTextStyles();
    }, []);

    // Sync local state ONLY on a genuine external prop change (deserialize).
    useEffect(() => {
        const p = element?.props?.items;
        if (p && JSON.stringify(p) !== JSON.stringify(itemsRef.current)) {
            itemsRef.current = p;
            setItems(p);
        }
    }, [element?.props?.items]);

    // Persist to Yoopta (Slate + block.value) so html.serialize reads fresh props.
    // Committed inline (not from an [items] effect) so each edit is a single
    // render with no effect ping-pong.
    const commit = (next: AccordionItem[]) => {
        itemsRef.current = next;
        setItems(next);
        commitBlockProps(editor, blockId, element, { items: next, editorType: 'accordionEditor' });
    };
    const updateHeading = (i: number, heading: string) =>
        commit(itemsRef.current.map((it, idx) => (idx === i ? { ...it, heading } : it)));
    const updateContent = (i: number, content: string) =>
        commit(itemsRef.current.map((it, idx) => (idx === i ? { ...it, content } : it)));
    const addItem = () => commit([...itemsRef.current, { heading: '', content: '' }]);
    const removeItem = (i: number) => {
        if (itemsRef.current.length <= 1) return;
        commit(itemsRef.current.filter((_, idx) => idx !== i));
    };

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        // Keep Backspace/Enter inside the heading input from reaching the outer
        // Slate editor (which would try to delete/split this void block).
        e.stopPropagation();
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
                    flexWrap: 'wrap',
                    gap: '6px',
                }}
            >
                <span style={{ fontSize: '14px', fontWeight: 600, color: C.text }}>{t('heading')}</span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {isEditing && (
                        <button
                            onClick={addItem}
                            style={{
                                padding: '3px 10px',
                                fontSize: '12px',
                                border: `1px dashed ${C.controlBorder}`,
                                borderRadius: '4px',
                                backgroundColor: C.white,
                                color: C.muted,
                                cursor: 'pointer',
                            }}
                        >
                            + {t('addSection')}
                        </button>
                    )}
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
                        {isEditing ? t('tabs.preview') : t('tabs.edit')}
                    </button>
                </div>
            </div>

            {/* Content */}
            <div style={{ padding: '12px' }}>
                {isEditing
                    ? items.map((item, index) => (
                          <div
                              key={index}
                              style={{
                                  border: `1px solid ${C.cardBorder}`,
                                  borderRadius: '8px',
                                  padding: '10px',
                                  marginBottom: '10px',
                                  backgroundColor: C.white,
                              }}
                          >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                  <span style={{ fontSize: '11px', fontWeight: 600, color: C.placeholder, flexShrink: 0 }}>
                                      {t('sectionNumber', { number: index + 1 })}
                                  </span>
                                  <input
                                      type="text"
                                      value={item.heading}
                                      onChange={(e) => updateHeading(index, e.target.value)}
                                      onKeyDown={handleInputKeyDown}
                                      placeholder={t('sectionTitlePlaceholder')}
                                      style={{
                                          flex: 1,
                                          minWidth: 0,
                                          padding: '6px 10px',
                                          fontSize: '14px',
                                          fontWeight: 600,
                                          border: `1px solid ${C.controlBorder}`,
                                          borderRadius: '4px',
                                          backgroundColor: C.white,
                                          color: C.text,
                                          outline: 'none',
                                      }}
                                  />
                                  <button
                                      onClick={() => removeItem(index)}
                                      disabled={items.length <= 1}
                                      title={t('removeSection')}
                                      style={{
                                          padding: '4px 8px',
                                          fontSize: '12px',
                                          border: `1px solid ${C.controlBorder}`,
                                          borderRadius: '4px',
                                          backgroundColor: C.white,
                                          color: C.muted,
                                          cursor: items.length <= 1 ? 'default' : 'pointer',
                                          opacity: items.length <= 1 ? 0.4 : 1,
                                          flexShrink: 0,
                                      }}
                                  >
                                      ✕
                                  </button>
                              </div>
                              <RichTextField
                                  value={item.content}
                                  onChange={(html) => updateContent(index, html)}
                                  placeholder={t('sectionContentPlaceholder')}
                                  minHeight={70}
                              />
                          </div>
                      ))
                    : /* Preview — native <details> (matches the learner render exactly) */
                      items.map((item, index) => (
                          <details
                              key={index}
                              open={index === 0}
                              style={{
                                  border: `1px solid ${C.cardBorder}`,
                                  borderRadius: '8px',
                                  marginBottom: '8px',
                                  overflow: 'hidden',
                                  backgroundColor: C.white,
                              }}
                          >
                              <summary
                                  style={{
                                      padding: '10px 14px',
                                      fontSize: '15px',
                                      fontWeight: 600,
                                      color: C.text,
                                      cursor: 'pointer',
                                      backgroundColor: C.surface,
                                  }}
                              >
                                  {item.heading || t('sectionNumber', { number: index + 1 })}
                              </summary>
                              <div style={{ padding: '10px 14px' }}>
                                  {isRichTextEmpty(item.content) ? (
                                      <span style={{ color: C.placeholder, fontStyle: 'italic', fontSize: '14px' }}>
                                          {t('emptySection')}
                                      </span>
                                  ) : (
                                      <RichTextHtml
                                          html={item.content}
                                          style={{ fontSize: '14px', lineHeight: 1.6, color: C.text, whiteSpace: 'pre-wrap' }}
                                      />
                                  )}
                              </div>
                          </details>
                      ))}
            </div>

            {children}
        </div>
    );
}

// Accordion icon
const AccordionIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="6" rx="1" />
        <rect x="3" y="14" width="18" height="6" rx="1" />
        <path d="M8 7h2M8 17h6" />
    </svg>
);

// Yoopta Plugin Definition — replaces the built-in @yoopta/accordion so sections
// can hold rich text + images (the built-in only supported plain text).
export const AccordionPlugin = new YooptaPlugin<{ accordion: any }>({
    type: 'accordion',
    elements: {
        accordion: {
            render: AccordionBlock,
        },
    },
    options: {
        display: {
            title: 'Accordion',
            description: 'Collapsible sections — each supports text and images',
            icon: <AccordionIcon />,
        },
        shortcuts: ['accordion', 'collapse', 'toggle', 'faq'],
    },
    parsers: {
        html: {
            deserialize: {
                // Claim our own wrapper AND legacy bare <details> (old built-in
                // accordions), so existing accordion slides stay editable.
                nodeNames: ['DIV', 'DETAILS'],
                parse: (element) => {
                    const build = (items: AccordionItem[]) => ({
                        id: `acc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'accordion',
                        props: {
                            items: items.length ? items : DEFAULT_ITEMS,
                            editorType: 'accordionEditor',
                        },
                        children: [{ text: '' }],
                    });

                    if (element.nodeName === 'DIV') {
                        if (element.getAttribute?.('data-yoopta-type') !== 'accordion') {
                            return undefined;
                        }
                        const details = Array.from(element.querySelectorAll(':scope > details'));
                        return build(details.map(parseDetails));
                    }

                    if (element.nodeName === 'DETAILS') {
                        // Skip <details> already inside our wrapper — the DIV above
                        // handles those (prevents double-parsing).
                        if (element.closest?.('[data-yoopta-type="accordion"]')) {
                            return undefined;
                        }
                        return build([parseDetails(element)]);
                    }

                    return undefined;
                },
            },
            serialize: (element, _children) => {
                // Must never throw — a throwing serializer aborts the whole-document
                // Save Draft / Publish.
                let items: AccordionItem[] = [];
                try {
                    const props = (element && element.props) || {};
                    items = Array.isArray(props.items) ? props.items : [];
                } catch {
                    items = [];
                }

                // Emit native <details> per section. The learner renders these
                // directly (native toggle + its themed CSS), so no learner change is
                // needed, and images in the content are safe — the document
                // sanitizer only trims S3 query params, it never drops the tag.
                // Peel any padding wrappers a previous serialize already added, so
                // we never nest them. Without this, each Save wraps the content
                // (which was read back WITH last save's wrapper) in yet another
                // `<div style="padding: 4px 0;">`, stacking dead vertical space in
                // the expanded panel a little more every time. This also self-heals
                // slides that already accumulated the nesting.
                const stripPaddingWrappers = (raw: string): string => {
                    let inner = String(raw || '');
                    let prev: string;
                    do {
                        prev = inner;
                        inner = inner.replace(
                            /^\s*<div style="padding: 4px 0;">([\s\S]*)<\/div>\s*$/,
                            '$1'
                        );
                    } while (inner !== prev);
                    return inner;
                };

                const sections = items
                    .map((item, i) => {
                        const heading = escapeText(
                            item?.heading ||
                                i18next.t('studyLibraryAccordionEditor:sectionNumber', {
                                    number: i + 1,
                                })
                        );
                        const content = stripPaddingWrappers(String(item?.content || ''));
                        return `<details${i === 0 ? ' open' : ''}><summary>${heading}</summary><div style="padding: 4px 0;">${content}</div></details>`;
                    })
                    .join('');

                return `<div data-yoopta-type="accordion" data-editor-type="accordionEditor" style="margin: 8px 0;">${sections}</div>`;
            },
        },
    },
});
