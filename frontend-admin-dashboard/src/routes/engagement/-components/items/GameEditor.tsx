import { useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useController, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Cards, Copy, UploadSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Textarea } from '@/components/ui/textarea';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { MAX_POINTS, type ComposerForm } from '../forms/composer-schema';
import { extractLegacyDeck, type FlashcardsDeck } from '../flashcards/flashcards-schema';
import {
    FieldBlock,
    loose,
    numberInputValue,
    parseNumberInput,
    useFieldError,
    type ItemPath,
} from './item-fields';

/**
 * The message a game posts to report its result; the same protocol the HTML slide
 * renderer speaks. A string constant because written inline its braces read as a hex
 * colour to the design linter.
 */
const GAME_SCORE_SNIPPET = "postMessage({ type: 'vacademy:complete', score, maxScore })";

/** Uploads above this are refused: a daily game this big is almost always a mistake. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What the legacy-deck banner offers, decided by ItemEditor. */
export type LegacyDeckAction =
    /** Nobody has finished the game: the task becomes a Flashcards task in place. */
    | { kind: 'convert'; run: (deck: FlashcardsDeck) => void }
    /** Learners finished it, so its type is locked: add a Flashcards copy instead. */
    | { kind: 'duplicate'; run: (deck: FlashcardsDeck) => void };

/**
 * A game: the teacher's own HTML page, run sandboxed on the learner's device. It asks
 * for the top score the page can report (required; the server caps at it), takes the
 * page as pasted text or an uploaded .html file, and explains the score protocol.
 *
 * An old AI flashcard deck saved as a game page (`var cards=[…]`) is recognised and
 * offered in the card editor, by `legacyAction`.
 */
export function GameEditor({
    control,
    name,
    legacyAction,
}: {
    control: Control<ComposerForm>;
    name: ItemPath;
    legacyAction?: LegacyDeckAction | null;
}) {
    const { t } = useTranslation('engagement');
    const c = loose(control);
    const htmlPath = `${name}.contentHtml`;
    const maxPath = `${name}.maxScore`;
    const { field: htmlField } = useController({ control: c, name: htmlPath });
    const { field: maxField } = useController({ control: c, name: maxPath });
    const htmlError = useFieldError(c, htmlPath);
    const maxError = useFieldError(c, maxPath);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [confirmConvert, setConfirmConvert] = useState(false);
    const snippetId = useId();

    const html = typeof htmlField.value === 'string' ? htmlField.value : '';
    const size = useMemo(() => new Blob([html]).size, [html]);
    const legacyDeck = useMemo(
        () => (legacyAction ? extractLegacyDeck(html) : null),
        [html, legacyAction]
    );

    async function onFile(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
            toast.error(t('items.game.uploadType'));
            return;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            toast.error(t('items.game.uploadTooBig', { size: formatSize(MAX_UPLOAD_BYTES) }));
            return;
        }
        let text: string;
        try {
            text = await file.text();
        } catch {
            toast.error(t('items.game.uploadFailed'));
            return;
        }
        const previous = html;
        htmlField.onChange(text);
        toast.success(t('items.game.uploaded', { name: file.name }), {
            action: previous.trim()
                ? { label: t('items.undo'), onClick: () => htmlField.onChange(previous) }
                : undefined,
        });
    }

    return (
        <div className="flex flex-col gap-4">
            {legacyDeck && legacyAction && (
                <div className="flex flex-col gap-3 rounded-lg border border-info-200 bg-info-50 p-4 sm:flex-row sm:items-center">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-card text-info-600">
                        <Cards size={22} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-body font-semibold text-neutral-900">
                            {t('items.game.legacyTitle', { count: legacyDeck.cards.length })}
                        </p>
                        <p className="text-caption text-neutral-600">
                            {legacyAction.kind === 'convert'
                                ? t('items.game.legacyConvertHint')
                                : t('items.game.legacyDuplicateHint')}
                        </p>
                    </div>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        className="shrink-0"
                        onClick={() =>
                            legacyAction.kind === 'convert'
                                ? setConfirmConvert(true)
                                : legacyAction.run(legacyDeck)
                        }
                    >
                        {legacyAction.kind === 'convert' ? (
                            <>
                                <Cards size={16} aria-hidden /> {t('items.game.openInCardEditor')}
                            </>
                        ) : (
                            <>
                                <Copy size={16} aria-hidden />{' '}
                                {t('items.game.duplicateAsFlashcards')}
                            </>
                        )}
                    </MyButton>
                </div>
            )}

            <FieldBlock
                label={t('items.game.maxScore')}
                required
                hint={t('items.game.maxScoreHint')}
                error={maxError}
                className="sm:max-w-xs"
            >
                {(a11y) => (
                    <MyInput
                        {...a11y}
                        ref={maxField.ref}
                        inputType="number"
                        min={1}
                        max={MAX_POINTS}
                        step={1}
                        inputMode="numeric"
                        input={String(numberInputValue(maxField.value))}
                        onChangeFunction={(e) =>
                            maxField.onChange(
                                e.target.value.trim() === ''
                                    ? null
                                    : parseNumberInput(e.target.value)
                            )
                        }
                        onBlur={maxField.onBlur}
                        className={cn('sm:w-full', maxError && 'border-danger-600')}
                    />
                )}
            </FieldBlock>

            <FieldBlock
                label={t('composer.gameHtml')}
                required
                error={htmlError}
                aside={
                    <div className="flex items-center gap-2">
                        {size > 0 && (
                            <span className="text-caption text-neutral-500">
                                {formatSize(size)}
                            </span>
                        )}
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => fileRef.current?.click()}
                        >
                            <UploadSimple size={14} aria-hidden /> {t('items.game.upload')}
                        </MyButton>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".html,.htm,text/html"
                            className="hidden"
                            tabIndex={-1}
                            aria-hidden
                            onChange={(e) => void onFile(e)}
                        />
                    </div>
                }
            >
                {(a11y) => (
                    // A game is a whole document with its own scripts and styles; a rich-text
                    // editor would rewrite it, so it is edited as raw HTML.
                    <Textarea
                        {...a11y}
                        aria-describedby={[a11y['aria-describedby'], snippetId]
                            .filter(Boolean)
                            .join(' ')}
                        ref={htmlField.ref}
                        value={html}
                        onChange={(e) => htmlField.onChange(e.target.value)}
                        onBlur={htmlField.onBlur}
                        rows={16}
                        dir="ltr"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        placeholder="<!DOCTYPE html> …"
                        className={cn(
                            'min-h-40 resize-y font-mono text-caption leading-relaxed',
                            htmlError && 'border-danger-600'
                        )}
                    />
                )}
            </FieldBlock>

            <div id={snippetId} className="flex flex-col gap-1.5 rounded-md bg-neutral-50 p-3">
                <p className="text-caption text-neutral-600">{t('items.game.protocol')}</p>
                <code
                    dir="ltr"
                    className="block overflow-x-auto whitespace-pre rounded bg-card px-2 py-1 font-mono text-caption text-neutral-800"
                >
                    {GAME_SCORE_SNIPPET}
                </code>
                <p className="text-caption text-neutral-500">{t('items.game.protocolNote')}</p>
            </div>

            <AlertDialog open={confirmConvert} onOpenChange={setConfirmConvert}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-start">
                            {t('items.game.convertTitle')}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-start">
                            {t('items.game.convertDescription', {
                                count: legacyDeck?.cards.length ?? 0,
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('items.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="gap-2 bg-primary-500 text-neutral-50 hover:bg-primary-400"
                            onClick={() => {
                                setConfirmConvert(false);
                                if (legacyDeck && legacyAction) legacyAction.run(legacyDeck);
                            }}
                        >
                            <Cards size={16} aria-hidden /> {t('items.game.convertConfirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
