import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { Field, inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { fetchLabelPrintData, markLabelsPrinted } from '../-shared/inventory-api';
import { useInvalidateInventory, useLabels } from '../-shared/inventory-hooks';
import {
    LABEL_LANGUAGES,
    LABEL_TEMPLATES,
    type LabelLanguage,
    type LabelPrintData,
    type LabelRow,
    type LabelTemplate,
    type ReceiptLine,
} from '../-shared/inventory-types';
import {
    A4_POSITIONS,
    endLabelPrint,
    labelCount,
    labelsNotQueued,
    markPrintedBatches,
    MAX_LABELS_PER_PRINT,
    nextStartPosition,
    MAX_RECEIPT_LINE_LABELS,
    printLabels,
    printProblem,
    printRounds,
    readLabelChoice,
    rememberLabelChoice,
    splitByPrice,
} from '../-shared/label-print';
import { ChoiceGroup, InventoryErrorNotice, TOUCH } from './inventory-ui';
import { LabelPrintView } from './LabelPrintView';
import { useInventoryWrite } from './use-inventory-write';

/** One paint after the labels are in the page, before the print dialog opens. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

/**
 * Print labels from the browser (owner decision 2026-11-18; labels carry Hindi
 * names): the label stock (50 × 25 mm sticker roll, or an A4 sheet of 65 with
 * the first free label), the language (Hindi with English small below, Hindi,
 * English). Print reads what to draw from the server, draws every label with
 * its QR code and Code 128 barcode, and opens the browser's print dialog with
 * an exact page size and no margins. When the dialog closes it asks "Did the
 * labels print correctly?": only Yes marks them printed; No keeps them waiting.
 *
 * Either the chosen queue rows (`rows`) or a whole receipt (`receiptId`:
 * all its waiting rows, drawn by the server). Rows of an item without a price
 * are not drawn: they are listed and stay waiting. "Yes" marks exactly the
 * rows that were drawn, in batches the server takes.
 *
 * One print takes at most 500 labels. More (a receipt line of 1,200 units,
 * or many lines) print in rounds: the server draws 500 and says what was
 * left out; "Yes" marks what was drawn (a row drawn in part keeps waiting
 * with the rest) and the dialog stays open, saying how many labels still
 * wait, so Print draws the next round.
 */
export function PrintLabelsDialog({
    open,
    onOpenChange,
    rows,
    receiptId,
    receiptLines,
    onPrinted,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    rows?: LabelRow[];
    receiptId?: string;
    /** The receipt's lines: a counted line of more than 10,000 units says how many units got no label. */
    receiptLines?: ReceiptLine[];
    /** The place the labels are for (rows carry their own). */
    locationId?: string | null;
    onPrinted?: () => void;
}) {
    const { t } = useTranslation('commerce');
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('lbl');
    const [choice, setChoice] = useState(readLabelChoice);
    const [startText, setStartText] = useState('1');
    const [phase, setPhase] = useState<'choose' | 'ask'>('choose');
    const [data, setData] = useState<LabelPrintData | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);
    /** After a round that left labels out: those rows (the next print of chosen rows) and how many labels wait. */
    const [rest, setRest] = useState<{ ids: string[]; copies: number } | null>(null);
    /** One token per print-data answer: "Yes" for that answer keeps its request ids; the next round gets new ones. */
    const [round, setRound] = useState('');
    const rounds = useRef(0);

    const receiptRows = useLabels({
        sourceType: receiptId ? 'STOCK_RECEIPT' : undefined,
        sourceId: receiptId,
        status: 'PENDING',
        page: 0,
        size: 100,
    });
    const loaded: LabelRow[] = receiptId ? (receiptRows.data?.rows ?? []) : (rows ?? []);
    const { priced: chosen, unpriced } = splitByPrice(loaded);
    const count = rest ? rest.copies : labelCount(chosen);
    // A receipt with more waiting rows than one page: the server counts them as it draws them.
    const allLoaded = !!rest || !receiptId || (receiptRows.data ? receiptRows.data.total <= loaded.length : false);
    const notQueued = labelsNotQueued(receiptLines ?? []);
    const a4 = choice.template === 'A4_65';

    // The print screen closed before the browser said the print was over: end it now.
    useEffect(() => () => endLabelPrint(), []);

    const print = async () => {
        setProblem(null);
        setError(null);
        const current = { ...choice, startPosition: Number(startText) };
        const blocked = printProblem(allLoaded ? count : Math.max(1, count), current);
        if (blocked) {
            setProblem(t(`inventory.labels.problems.${blocked}`, { max: MAX_LABELS_PER_PRINT, positions: A4_POSITIONS }));
            return;
        }
        rememberLabelChoice(current);
        try {
            const answer = await fetchLabelPrintData({
                ...(receiptId ? { receipt_id: receiptId } : { request_ids: rest ? rest.ids : chosen.map((r) => r.id) }),
                size: current.template,
            });
            if (answer.labels.length === 0) {
                setProblem(t('inventory.labels.problems.nothing'));
                return;
            }
            setData(answer);
            rounds.current += 1;
            setRound(`${Date.now().toString(36)}-${rounds.current}`);
            await nextFrame();
            await printLabels(current.template);
            setPhase('ask');
        } catch (e) {
            setError(e);
        }
    };

    const markPrinted = async () => {
        setError(null);
        if (!data) return;
        // Exactly what was drawn (a receipt can hold more than one page of rows), in batches of ≤ 200;
        // each batch has its own request id, so pressing Yes again after a failure resends the same ones.
        // A row drawn in part says how many of its labels were drawn: the rest keeps waiting.
        const batches = markPrintedBatches(data);
        try {
            for (const batch of batches) {
                await write.run({
                    // Per round: a request id left from an unanswered earlier round is never reused here.
                    scope: `mark-printed:${round}:${batch.request_ids[0]}:${batch.request_ids.length}`,
                    body: batch,
                    send: (id) => markLabelsPrinted({ client_request_id: id, ...batch }),
                    onDone: () => undefined,
                });
            }
            toast.success(t('inventory.labels.markedPrinted'));
            onPrinted?.();
            if (data.left_out.length > 0) {
                // The next round: the labels left out of this print, still waiting.
                setRest({ ids: data.left_out.map((l) => l.request_id), copies: data.left_out_copies });
                // On a used A4 sheet the next round starts at the first label this round left free.
                if (a4) setStartText(String(nextStartPosition(Number(startText), data.total_copies)));
                setData(null);
                setPhase('choose');
                return;
            }
            onOpenChange(false);
        } catch (e) {
            setError(e);
        } finally {
            void invalidate();
        }
    };

    return (
        <>
            <MyDialog
                heading={t('inventory.labels.printTitle')}
                open={open}
                onOpenChange={onOpenChange}
                dialogWidth="max-w-lg"
                footer={
                    phase === 'choose' ? (
                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onClick={() => onOpenChange(false)}>
                                {t('common.cancel')}
                            </MyButton>
                            <MyButton type="button" buttonType="primary" scale="medium" className={TOUCH} onAsyncClick={print} data-testid="labels-print">
                                {t('inventory.labels.print')}
                            </MyButton>
                        </div>
                    ) : (
                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                className={TOUCH}
                                onClick={() => onOpenChange(false)}
                                data-testid="labels-keep-pending"
                            >
                                {t('inventory.labels.keepPending')}
                            </MyButton>
                            <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onClick={() => setPhase('choose')}>
                                {t('inventory.labels.printAgain')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                className={TOUCH}
                                onAsyncClick={markPrinted}
                                data-testid="labels-mark-printed"
                            >
                                {t('inventory.labels.markPrinted')}
                            </MyButton>
                        </div>
                    )
                }
            >
                {phase === 'ask' ? (
                    <div className="flex flex-col gap-3">
                        {data && (
                            <p className="text-body text-foreground" data-testid="labels-drawn">
                                {t('inventory.labels.drawn', { count: data.total_copies })}
                            </p>
                        )}
                        {data && data.left_out_copies > 0 && (
                            <p className="text-caption text-warning-600" data-testid="labels-left-out">
                                {t('inventory.labels.leftOut', { count: data.left_out_copies, max: MAX_LABELS_PER_PRINT })}
                            </p>
                        )}
                        <SkippedNote
                            skus={(data?.skipped ?? []).filter((x) => x.reason !== 'NOT_PENDING').map((x) => x.sku ?? x.request_id)}
                        />
                        <ElsewhereNote
                            skus={(data?.skipped ?? []).filter((x) => x.reason === 'NOT_PENDING').map((x) => x.sku ?? x.request_id)}
                        />
                        <p className="text-subtitle text-foreground">{t('inventory.labels.cameOutWell')}</p>
                        <p className="text-body text-muted-foreground">{t('inventory.labels.cameOutWellHelp')}</p>
                        <InventoryErrorNotice error={error} />
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {receiptId && receiptRows.isLoading ? (
                            <CommerceLoadingRows rows={1} />
                        ) : (
                            <p className="text-body text-foreground" data-testid="labels-count">
                                {allLoaded ? t('inventory.labels.count', { count }) : t('inventory.labels.countReceipt')}
                            </p>
                        )}
                        {rest ? (
                            <p className="text-caption text-warning-600" data-testid="labels-rest">
                                {t('inventory.labels.restWaiting', { count: rest.copies, max: MAX_LABELS_PER_PRINT })}
                            </p>
                        ) : (
                            allLoaded &&
                            count > MAX_LABELS_PER_PRINT && (
                                <p className="text-caption text-muted-foreground" data-testid="labels-rounds">
                                    {t('inventory.labels.inRounds', { count, max: MAX_LABELS_PER_PRINT, rounds: printRounds(count) })}
                                </p>
                            )
                        )}
                        {notQueued.map((line) => (
                            <p key={line.item} className="text-caption text-warning-600" data-testid="labels-not-queued">
                                {t('inventory.labels.notQueued', { count: line.units, item: line.item, max: MAX_RECEIPT_LINE_LABELS })}
                            </p>
                        ))}
                        <SkippedNote skus={unpriced.map((r) => r.sku ?? r.item_name ?? r.id)} />
                        <ChoiceGroup<LabelTemplate>
                            name="label-template"
                            label={t('inventory.labels.template')}
                            value={choice.template}
                            onChange={(template) => setChoice({ ...choice, template })}
                            options={LABEL_TEMPLATES.map((value) => ({ value, label: t(`inventory.labels.template${value}`) }))}
                        />
                        <ChoiceGroup<LabelLanguage>
                            name="label-language"
                            label={t('inventory.labels.language')}
                            value={choice.language}
                            onChange={(language) => setChoice({ ...choice, language })}
                            columns={3}
                            options={LABEL_LANGUAGES.map((value) => ({ value, label: t(`inventory.labels.languages.${value}`) }))}
                        />
                        {a4 && (
                            <Field
                                label={t('inventory.labels.startAt')}
                                htmlFor="label-start"
                                hint={t('inventory.labels.startAtHint', { positions: A4_POSITIONS })}
                            >
                                <input
                                    id="label-start"
                                    className={inputClass}
                                    inputMode="numeric"
                                    value={startText}
                                    onChange={(event) => setStartText(event.target.value)}
                                />
                            </Field>
                        )}
                        <p className="text-caption text-muted-foreground">{t('inventory.labels.printHint')}</p>
                        {problem && (
                            <p role="alert" className="text-caption text-danger-600">
                                {problem}
                            </p>
                        )}
                        <InventoryErrorNotice error={error} />
                    </div>
                )}
                {write.dialog}
            </MyDialog>
            {data && (
                <LabelPrintView
                    labels={data.labels}
                    template={choice.template}
                    language={choice.language}
                    startPosition={Number(startText) || 1}
                />
            )}
        </>
    );
}

/** "N labels were left out: printed or cancelled elsewhere meanwhile" — the rest of the round printed. */
function ElsewhereNote({ skus }: { skus: string[] }) {
    const { t } = useTranslation('commerce');
    if (skus.length === 0) return null;
    return (
        <p className="text-caption text-warning-600" data-testid="labels-elsewhere">
            {t('inventory.labels.skippedElsewhere', { count: skus.length, items: Array.from(new Set(skus)).join(', ') })}
        </p>
    );
}

/** "N labels wait for a price: SKU-1, SKU-2" — they are not printed and stay in the queue. */
function SkippedNote({ skus }: { skus: string[] }) {
    const { t } = useTranslation('commerce');
    if (skus.length === 0) return null;
    return (
        <p className="text-caption text-warning-600" data-testid="labels-skipped">
            {t('inventory.labels.skippedNoPrice', { count: skus.length, items: Array.from(new Set(skus)).join(', ') })}
        </p>
    );
}
