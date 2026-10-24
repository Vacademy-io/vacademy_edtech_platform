import { useMemo, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { useController, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { TipTapEditor } from '@/components/tiptap/TipTapEditor';
import { cn } from '@/lib/utils';
import type { ComposerForm } from '../forms/composer-schema';
import { FieldError, loose, useFieldError, type ItemPath } from './item-fields';

/** Words a learner reads per minute, for the "~2 min read" estimate. */
const WORDS_PER_MINUTE = 200;

function readMinutes(html: string): number {
    const text = html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .trim();
    if (!text) return 0;
    const words = text.split(/\s+/).length;
    return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/**
 * HTML the rich-text editor cannot represent. TipTap normalises content on mount, so
 * opening such a task used to rewrite an SVG visual note into flattened text — and
 * the next Save stored the damage. These stay in a raw HTML editor.
 */
function needsRawHtml(html: string): boolean {
    return /<(svg|style|script|iframe|html|body|head|table|canvas|math)\b|\sstyle\s*=|<div\b/i.test(
        html
    );
}

/**
 * Body of a Reading or Visual note task: rich text the learner reads in the task sheet.
 * Only `contentHtml` is edited here; the task's title and points live in ItemEditor.
 */
export function ReadingEditor({
    control,
    name,
    variant,
}: {
    control: Control<ComposerForm>;
    name: ItemPath;
    variant: 'READING_HTML' | 'VISUAL_NOTE';
}) {
    const { t } = useTranslation('engagement');
    const c = loose(control);
    const path = `${name}.contentHtml`;
    const { field } = useController({ control: c, name: path });
    const error = useFieldError(c, path);
    const html = typeof field.value === 'string' ? field.value : '';
    const minutes = useMemo(() => readMinutes(html), [html]);
    const labelId = `${name}-content-label`;
    // Decided once, from the stored content: flipping modes mid-edit would lose markup.
    const [raw] = useState(() => variant === 'VISUAL_NOTE' || needsRawHtml(html));
    // TipTap emits a normalised copy right after mount; only accept changes once the
    // teacher has actually interacted, so merely opening a task never edits it.
    const touched = useRef(false);

    return (
        <div className="flex flex-col gap-1.5" role="group" aria-labelledby={labelId}>
            <div className="flex items-end justify-between gap-2">
                <span id={labelId} className="text-body font-medium text-neutral-700">
                    {variant === 'VISUAL_NOTE'
                        ? t('items.reading.noteLabel')
                        : t('composer.content')}
                </span>
                {minutes > 0 && (
                    <span className="text-caption text-neutral-500">
                        {t('items.reading.minutes', { count: minutes })}
                    </span>
                )}
            </div>
            <div
                className={cn(
                    'rounded-md border',
                    error ? 'border-danger-600' : 'border-transparent'
                )}
            >
                {raw ? (
                    <Textarea
                        aria-labelledby={labelId}
                        value={html}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                        rows={10}
                        className="font-mono text-caption"
                        placeholder={
                            variant === 'VISUAL_NOTE'
                                ? t('items.reading.notePlaceholder')
                                : t('composer.contentPlaceholder')
                        }
                    />
                ) : (
                    <div
                        onKeyDownCapture={() => (touched.current = true)}
                        onPointerDownCapture={() => (touched.current = true)}
                        onPasteCapture={() => (touched.current = true)}
                    >
                        <TipTapEditor
                            value={html}
                            onChange={(next) => {
                                if (touched.current) field.onChange(next);
                            }}
                            onBlur={field.onBlur}
                            placeholder={t('composer.contentPlaceholder')}
                            minHeight={200}
                        />
                    </div>
                )}
            </div>
            <p className="text-caption text-neutral-500">
                {variant === 'VISUAL_NOTE' ? t('items.reading.noteHint') : t('items.reading.hint')}
            </p>
            <FieldError message={error} />
        </div>
    );
}
