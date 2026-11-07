import { useEffect, useId, useMemo, useRef, type ChangeEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { FileArrowUp, Info, Warning } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { MyTable, type TableData } from '@/components/design-system/table';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import type { FlashcardCard } from '../../-types/types';
import {
    FLASHCARD_LIMITS,
    mergeImportedCards,
    parseImport,
    type ImportRow,
    type ImportRowStatus,
    type ImportSeparator,
} from './flashcards-schema';

export interface FlashcardsImportResult {
    /** The whole deck after the import, ready to replace the editor's cards. */
    cards: FlashcardCard[];
    mode: 'append' | 'replace';
    /** Cards that came from the paste. */
    added: number;
}

const SEPARATORS: ImportSeparator[] = ['auto', 'tab', 'dash', 'colon', 'comma', 'custom'];

/** Preview rows shown at most; the counts below the table always cover every row. */
const PREVIEW_ROWS = 200;

/** Text files read into the paste box are capped: a deck is 50 short cards. */
const MAX_FILE_BYTES = 512 * 1024;

const STATUS_TONE: Record<ImportRowStatus, StatusType> = {
    ok: 'SUCCESS',
    duplicate: 'WARNING',
    missingFront: 'DANGER',
    missingBack: 'DANGER',
    tooLong: 'DANGER',
    tooManyLines: 'DANGER',
};

function buildSchema(t: (key: string) => string) {
    return z
        .object({
            text: z.string(),
            separator: z.enum(['auto', 'tab', 'dash', 'colon', 'comma', 'custom']),
            custom: z.string().max(10, t('composer.flashcards.importDialog.customTooLong')),
            header: z.boolean(),
            mode: z.enum(['append', 'replace']),
        })
        .superRefine((value, ctx) => {
            if (value.separator === 'custom' && value.custom === '') {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['custom'],
                    message: t('composer.flashcards.importDialog.customRequired'),
                });
            }
        });
}

type ImportForm = z.infer<ReturnType<typeof buildSchema>>;

/** True when the deck holds nothing but blank cards (a new task's starter row). */
function isBlankDeck(cards: FlashcardCard[]): boolean {
    return cards.every((card) => !card.front?.trim() && !card.back?.trim());
}

/**
 * Paste a list of cards (or read a .csv/.txt file) and add them to the deck.
 *
 * - Separator: Auto-detect, Tab, Dash (" – ", " - ", " — "), Colon, Comma (CSV) or a
 *   custom string; an optional header row is skipped. A third column is the hint.
 * - The preview table lists every row with its status. Rows with a missing face or an
 *   over-long side are skipped; a repeated front is imported but flagged.
 * - Append adds new cards (new ids). Replace swaps the deck but keeps the id of any
 *   card whose front matches exactly, so its learner stats carry over, and warns when
 *   learners have already studied the deck.
 * - Nothing past 50 cards is imported; the button says how many are left out.
 */
export function FlashcardsImportDialog({
    open,
    onOpenChange,
    existingCards,
    completedCount,
    onImport,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    existingCards: FlashcardCard[];
    /** Learners who finished the task; Replace warns when above 0. */
    completedCount?: number | null;
    onImport: (result: FlashcardsImportResult) => void;
}) {
    const { t } = useTranslation('engagement');
    const k = (key: string) => `composer.flashcards.importDialog.${key}`;
    const schema = useMemo(() => buildSchema(t), [t]);
    const blankDeck = isBlankDeck(existingCards);
    const form = useForm<ImportForm>({
        resolver: zodResolver(schema),
        defaultValues: {
            text: '',
            separator: 'auto',
            custom: '',
            header: false,
            mode: blankDeck ? 'replace' : 'append',
        },
    });
    const fileRef = useRef<HTMLInputElement | null>(null);
    const modeLabelId = useId();

    // Every open starts clean; the mode defaults to Append when the deck has cards.
    useEffect(() => {
        if (!open) return;
        form.reset({
            text: '',
            separator: 'auto',
            custom: '',
            header: false,
            mode: isBlankDeck(existingCards) ? 'replace' : 'append',
        });
        // Only on open: the deck changing underneath must not wipe a paste.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const values = useWatch({ control: form.control });
    const mode = values.mode ?? 'append';
    const appending = mode === 'append' && !blankDeck;
    const parsed = useMemo(
        () =>
            parseImport(values.text ?? '', {
                separator: values.separator ?? 'auto',
                custom: values.custom ?? '',
                header: Boolean(values.header),
                existingCount: appending ? existingCards.length : 0,
                existingFronts: appending ? existingCards.map((card) => card.front) : [],
            }),
        [values.text, values.separator, values.custom, values.header, appending, existingCards]
    );

    const importCount = parsed.cards.length;
    const hasText = Boolean(values.text?.trim());
    const warnStudied = mode === 'replace' && !blankDeck && (completedCount ?? 0) > 0;

    // A phone has room for three columns: the back goes under the front there.
    const compact = useIsMobile();
    const columns = useMemo<ColumnDef<ImportRow>[]>(() => {
        const rowColumn: ColumnDef<ImportRow> = {
            id: 'row',
            header: '#',
            size: compact ? 36 : 44,
            cell: ({ row }) => (
                <span className="text-caption tabular-nums text-neutral-500">
                    {row.original.row}
                </span>
            ),
        };
        const statusColumn: ColumnDef<ImportRow> = {
            id: 'status',
            header: t(k('status')),
            size: compact ? 124 : 148,
            cell: ({ row }) => (
                <StatusChip
                    text={t(k(`row_${row.original.status}`))}
                    textSize="text-caption"
                    status={STATUS_TONE[row.original.status]}
                />
            ),
        };
        if (compact) {
            return [
                rowColumn,
                {
                    id: 'card',
                    header: t(k('front')),
                    size: 182,
                    cell: ({ row }) => (
                        <span className="flex min-w-0 flex-col" dir="auto">
                            <span className="line-clamp-2 break-words text-body text-neutral-800">
                                {row.original.front || '—'}
                            </span>
                            <span className="line-clamp-2 break-words text-caption text-neutral-500">
                                {row.original.back || '—'}
                            </span>
                        </span>
                    ),
                },
                statusColumn,
            ];
        }
        return [
            rowColumn,
            {
                id: 'front',
                header: t(k('front')),
                size: 210,
                cell: ({ row }) => (
                    <span
                        dir="auto"
                        className="line-clamp-2 break-words text-body text-neutral-800"
                    >
                        {row.original.front || '—'}
                    </span>
                ),
            },
            {
                id: 'back',
                header: t(k('back')),
                size: 316,
                cell: ({ row }) => (
                    <span
                        dir="auto"
                        className="line-clamp-2 break-words text-body text-neutral-700"
                    >
                        {row.original.back || '—'}
                    </span>
                ),
            },
            statusColumn,
        ];
        // `k` only prefixes keys; `t` covers the language.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, compact]);

    const tableData: TableData<ImportRow> = useMemo(() => {
        const content = parsed.rows.slice(0, PREVIEW_ROWS);
        return {
            content,
            total_pages: 1,
            page_no: 0,
            page_size: content.length,
            total_elements: parsed.rows.length,
            last: true,
        };
    }, [parsed.rows]);

    async function onFile(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) {
            toast.error(t(k('fileTooBig')));
            return;
        }
        try {
            const text = await file.text();
            form.setValue('text', text, { shouldDirty: true });
            if (/\.csv$/i.test(file.name)) form.setValue('separator', 'comma');
            else if (/\.tsv$/i.test(file.name)) form.setValue('separator', 'tab');
        } catch {
            toast.error(t(k('fileFailed')));
        }
    }

    function submit(value: ImportForm) {
        if (importCount === 0) return;
        const mergeMode = value.mode === 'append' && !blankDeck ? 'append' : 'replace';
        const merged = mergeImportedCards(existingCards, parsed.cards, mergeMode);
        onImport({
            cards: merged.cards,
            mode: mergeMode,
            added: parsed.cards.length - merged.dropped,
        });
        onOpenChange(false);
    }

    const separatorOptions = SEPARATORS.map((sep) => ({
        _id: sep,
        value: sep,
        label: t(k(`sep_${sep}`)),
    }));

    const confirmLabel =
        parsed.notImported > 0
            ? t(k('confirmCapped'), { count: importCount, left: parsed.notImported })
            : t(k('confirm'), { count: importCount });

    return (
        <MyDialog
            heading={t(k('title'))}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-3xl"
            footerLeft={
                hasText ? (
                    <p className="text-caption text-neutral-600">
                        {t(k('counts'), { count: parsed.rows.length })}
                        {parsed.invalidCount > 0 && (
                            <span className="text-danger-600">
                                {' · '}
                                {t(k('skipped'), { count: parsed.invalidCount })}
                            </span>
                        )}
                    </p>
                ) : undefined
            }
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={() => onOpenChange(false)}
                    >
                        {t(k('cancel'))}
                    </MyButton>
                    <MyButton
                        type="button"
                        disable={importCount === 0}
                        onClick={() => void form.handleSubmit(submit)()}
                    >
                        {confirmLabel}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form
                    className="flex flex-col gap-4"
                    onSubmit={(e) => {
                        // The dialog renders through a portal, so React would bubble this
                        // submit up to the composer's own form.
                        e.preventDefault();
                        e.stopPropagation();
                        void form.handleSubmit(submit)();
                    }}
                >
                    <FormField
                        control={form.control}
                        name="text"
                        render={({ field }) => (
                            <FormItem>
                                <div className="flex items-end justify-between gap-2">
                                    <FormLabel className="text-body font-medium text-neutral-700">
                                        {t(k('paste'))}
                                    </FormLabel>
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        scale="small"
                                        onClick={() => fileRef.current?.click()}
                                    >
                                        <FileArrowUp size={14} aria-hidden /> {t(k('chooseFile'))}
                                    </MyButton>
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
                                        className="hidden"
                                        tabIndex={-1}
                                        aria-hidden
                                        onChange={(e) => void onFile(e)}
                                    />
                                </div>
                                <FormControl>
                                    <Textarea
                                        {...field}
                                        rows={7}
                                        dir="auto"
                                        spellCheck={false}
                                        placeholder={t(k('pastePlaceholder'))}
                                        className="resize-y border-neutral-300 font-mono text-caption"
                                    />
                                </FormControl>
                                <p className="text-caption text-neutral-500">{t(k('pasteHint'))}</p>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <SelectField
                            control={form.control}
                            name="separator"
                            label={t(k('separator'))}
                            options={separatorOptions}
                            labelStyle="text-body font-medium text-neutral-700"
                            className="sm:w-56"
                        />
                        {values.separator === 'custom' && (
                            <FormField
                                control={form.control}
                                name="custom"
                                render={({ field, fieldState }) => (
                                    <FormItem className="sm:w-40">
                                        <FormLabel className="text-body font-medium text-neutral-700">
                                            {t(k('customLabel'))}
                                        </FormLabel>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                input={field.value}
                                                onChangeFunction={(e) =>
                                                    field.onChange(e.target.value)
                                                }
                                                onBlur={field.onBlur}
                                                ref={field.ref}
                                                inputPlaceholder="|"
                                                className={cn(
                                                    'sm:w-full',
                                                    fieldState.error && 'border-danger-600'
                                                )}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}
                        <FormField
                            control={form.control}
                            name="header"
                            render={({ field }) => (
                                <FormItem className="flex h-9 items-center gap-2 space-y-0">
                                    <FormControl>
                                        <Checkbox
                                            checked={field.value}
                                            onCheckedChange={(v) => field.onChange(v === true)}
                                        />
                                    </FormControl>
                                    <FormLabel className="text-body font-normal text-neutral-700">
                                        {t(k('header'))}
                                    </FormLabel>
                                </FormItem>
                            )}
                        />
                    </div>
                    {values.separator === 'auto' && hasText && (
                        <p className="-mt-2 text-caption text-neutral-500">
                            {t(k('detected'), { separator: t(k(`sep_${parsed.separator}`)) })}
                        </p>
                    )}

                    {!blankDeck && (
                        <FormField
                            control={form.control}
                            name="mode"
                            render={({ field }) => (
                                <FormItem className="space-y-1.5">
                                    <span
                                        id={modeLabelId}
                                        className="text-body font-medium text-neutral-700"
                                    >
                                        {t(k('modeLabel'), { count: existingCards.length })}
                                    </span>
                                    <FormControl>
                                        <RadioGroup
                                            value={field.value}
                                            onValueChange={field.onChange}
                                            aria-labelledby={modeLabelId}
                                            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                                        >
                                            {(['append', 'replace'] as const).map((option) => {
                                                const id = `${modeLabelId}-${option}`;
                                                return (
                                                    <div
                                                        key={option}
                                                        className={cn(
                                                            'flex items-start gap-2 rounded-lg border p-3 transition-colors',
                                                            field.value === option
                                                                ? 'border-primary-400 bg-primary-50'
                                                                : 'border-neutral-200 hover:border-neutral-300'
                                                        )}
                                                    >
                                                        <RadioGroupItem
                                                            id={id}
                                                            value={option}
                                                            aria-describedby={`${id}-hint`}
                                                            className="mt-0.5 shrink-0"
                                                        />
                                                        <Label
                                                            htmlFor={id}
                                                            className="min-w-0 flex-1 cursor-pointer space-y-0.5"
                                                        >
                                                            <span className="block text-body font-medium text-neutral-900">
                                                                {t(k(option))}
                                                            </span>
                                                            <span
                                                                id={`${id}-hint`}
                                                                className="block text-caption font-normal text-neutral-500"
                                                            >
                                                                {t(k(`${option}Hint`))}
                                                            </span>
                                                        </Label>
                                                    </div>
                                                );
                                            })}
                                        </RadioGroup>
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    )}

                    {warnStudied && (
                        <p
                            role="alert"
                            className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-caption text-warning-700"
                        >
                            <Warning size={16} className="shrink-0" aria-hidden />
                            <span>{t(k('replaceWarning'))}</span>
                        </p>
                    )}

                    {parsed.notImported > 0 && (
                        <p className="flex items-start gap-2 rounded-md border border-info-200 bg-info-50 px-3 py-2 text-caption text-info-700">
                            <Info size={16} className="shrink-0" aria-hidden />
                            <span>
                                {t(k('tooMany'), {
                                    max: FLASHCARD_LIMITS.maxCards,
                                    count: parsed.notImported,
                                })}
                            </span>
                        </p>
                    )}

                    <div className="flex flex-col gap-2">
                        <span className="text-body font-medium text-neutral-700">
                            {t(k('preview'))}
                        </span>
                        {hasText && parsed.rows.length > 0 ? (
                            <div className="max-h-80 overflow-auto">
                                <MyTable<ImportRow>
                                    data={tableData}
                                    columns={columns}
                                    isLoading={false}
                                    error={null}
                                    currentPage={0}
                                    enableColumnResizing={false}
                                    enableColumnPinning={false}
                                />
                                {parsed.rows.length > PREVIEW_ROWS && (
                                    <p className="px-3 py-2 text-caption text-neutral-500">
                                        {t(k('previewCapped'), {
                                            shown: PREVIEW_ROWS,
                                            count: parsed.rows.length,
                                        })}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-6 text-center text-caption text-neutral-500">
                                {t(k('previewEmpty'))}
                            </div>
                        )}
                    </div>
                </form>
            </Form>
        </MyDialog>
    );
}
