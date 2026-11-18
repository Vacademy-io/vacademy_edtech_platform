import { useState } from 'react';
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
} from '../-shared/inventory-types';
import {
    A4_POSITIONS,
    labelCount,
    MAX_LABELS_PER_PRINT,
    printLabels,
    printProblem,
    readLabelChoice,
    rememberLabelChoice,
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
 * its waiting rows).
 */
export function PrintLabelsDialog({
    open,
    onOpenChange,
    rows,
    receiptId,
    onPrinted,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    rows?: LabelRow[];
    receiptId?: string;
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

    const receiptRows = useLabels({
        sourceType: receiptId ? 'STOCK_RECEIPT' : undefined,
        sourceId: receiptId,
        status: 'PENDING',
        page: 0,
        size: 100,
    });
    const chosen: LabelRow[] = receiptId ? (receiptRows.data?.rows ?? []) : (rows ?? []);
    const count = labelCount(chosen);
    const a4 = choice.template === 'A4_65';

    const print = async () => {
        setProblem(null);
        setError(null);
        const current = { ...choice, startPosition: Number(startText) };
        const blocked = printProblem(count, current);
        if (blocked) {
            setProblem(t(`inventory.labels.problems.${blocked}`, { max: MAX_LABELS_PER_PRINT, positions: A4_POSITIONS }));
            return;
        }
        rememberLabelChoice(current);
        try {
            const answer = await fetchLabelPrintData({
                ...(receiptId ? { receipt_id: receiptId } : { request_ids: chosen.map((r) => r.id) }),
                size: current.template,
            });
            if (answer.labels.length === 0) {
                setProblem(t('inventory.labels.problems.nothing'));
                return;
            }
            setData(answer);
            await nextFrame();
            await printLabels(current.template);
            setPhase('ask');
        } catch (e) {
            setError(e);
        }
    };

    const markPrinted = async () => {
        setError(null);
        const ids = chosen.map((r) => r.id);
        try {
            await write.run({
                scope: 'mark-printed',
                body: { request_ids: ids },
                send: (id) => markLabelsPrinted({ client_request_id: id, request_ids: ids }),
                onDone: () => {
                    toast.success(t('inventory.labels.markedPrinted'));
                    void invalidate();
                    onPrinted?.();
                    onOpenChange(false);
                },
            });
        } catch (e) {
            setError(e);
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
                                {t('inventory.labels.count', { count })}
                            </p>
                        )}
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
