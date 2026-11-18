import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { PlainSelect, useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { DialogButtons, TextAreaField } from '@/routes/commerce/orders/-components/order-ui';
import { requestLabels } from '../-shared/inventory-api';
import { useInvalidateInventory } from '../-shared/inventory-hooks';
import { type LabelRequestLine, REPRINT_REASONS, type ReprintReason } from '../-shared/inventory-types';
import { type StockScan, useStockScan } from '../-shared/use-stock-scan';
import { pickName } from './ItemPicker';
import { InventoryErrorNotice, ItemCell, TOUCH, useInventoryErrorText } from './inventory-ui';
import { type ScanMessage, StockScanBox } from './StockScanBox';
import { useInventoryWrite } from './use-inventory-write';

interface ReprintLine {
    key: string;
    name: string | null;
    sku: string | null;
    piece_id: string | null;
    piece_code: string | null;
    package_session_id: string;
    quantity: number;
}

export const reprintProblem = (reason: ReprintReason | '', note: string, lines: number): string | null => {
    if (lines === 0) return 'lines';
    if (!reason) return 'reason';
    if (reason === 'OTHER' && !note.trim()) return 'note';
    return null;
};

/**
 * Reprint (contract §4.3, §7.3): scan or pick an item or a piece, a quantity
 * for an item, why (torn, lost, price changed, never printed, other with a
 * note). Queues REPRINT rows at this place; the code on a label never changes.
 */
export function ReprintDialog({
    open,
    onOpenChange,
    locationId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locationId: string;
}) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    const errorText = useInventoryErrorText();
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('rpr');
    const [lines, setLines] = useState<ReprintLine[]>([]);
    const [reason, setReason] = useState<ReprintReason | ''>('');
    const [note, setNote] = useState('');
    const [message, setMessage] = useState<ScanMessage | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);

    const add = (line: ReprintLine) => {
        if (lines.some((l) => l.key === line.key)) {
            if (line.piece_id) return setMessage({ tone: 'danger', text: t('inventory.reprint.alreadyOn') });
            setLines(lines.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l)));
        } else {
            setLines([...lines, line]);
        }
        setMessage({ tone: 'success', text: t('inventory.receive.added', { item: line.name ?? line.sku ?? '' }) });
    };

    const onScan = (scan: StockScan) => {
        if (scan.kind === 'PIECE' && scan.result.piece) {
            const v = scan.result.variant;
            add({
                key: `p:${scan.result.piece.id}`,
                name: v.product_name,
                sku: v.sku,
                piece_id: scan.result.piece.id,
                piece_code: scan.result.piece.code,
                package_session_id: v.package_session_id,
                quantity: 1,
            });
        } else if (scan.kind === 'VARIANT' || scan.kind === 'PIECE') {
            const v = scan.result.variant;
            if ((v.stock_mode ?? '').toUpperCase() === 'PIECE') {
                return setMessage({ tone: 'danger', text: t('inventory.countSheet.scanPieceLabels') });
            }
            add({ key: `v:${v.package_session_id}`, name: v.product_name, sku: v.sku, piece_id: null, piece_code: null, package_session_id: v.package_session_id, quantity: 1 });
        } else if (scan.kind === 'NOT_FOUND') {
            stock.setValue(scan.code);
            setMessage({ tone: 'info', text: t('inventory.scan.notFound') });
        } else {
            setMessage({ tone: 'danger', text: errorText(scan.error) });
        }
    };
    const stock = useStockScan(onScan, { paused: write.pinOpen });

    const save = async () => {
        setProblem(null);
        setError(null);
        const blocked = reprintProblem(reason, note, lines.length);
        if (blocked) return setProblem(t(`inventory.reprint.problems.${blocked}`));
        const body = {
            location_id: locationId,
            reason: 'REPRINT' as const,
            reprint_reason: reason as ReprintReason,
            ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}),
            lines: lines.map(
                (l): LabelRequestLine =>
                    l.piece_id ? { piece_id: l.piece_id } : { package_session_id: l.package_session_id, quantity: l.quantity }
            ),
        };
        try {
            await write.run({
                scope: 'reprint',
                body,
                send: (id) => requestLabels({ ...body, client_request_id: id }),
                onDone: () => {
                    toast.success(t('inventory.reprint.done'));
                    void invalidate();
                    onOpenChange(false);
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    return (
        <MyDialog
            heading={t('inventory.labels.reprint')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" className={TOUCH} onAsyncClick={save} data-testid="reprint-save">
                        {t('inventory.reprint.queue')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <StockScanBox
                    scan={stock}
                    message={message}
                    locationId={locationId}
                    testId="reprint-scan"
                    onPick={(item) => {
                        if ((item.stock_mode ?? '').toUpperCase() === 'PIECE') {
                            return setMessage({ tone: 'danger', text: t('inventory.countSheet.scanPieceLabels') });
                        }
                        add({
                            key: `v:${item.package_session_id}`,
                            name: pickName(item, lang),
                            sku: item.sku,
                            piece_id: null,
                            piece_code: null,
                            package_session_id: item.package_session_id,
                            quantity: 1,
                        });
                    }}
                />
                {lines.length > 0 && (
                    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                        {lines.map((line) => (
                            <li key={line.key} className="flex items-center justify-between gap-2 p-2">
                                <ItemCell name={line.name} sku={line.sku} code={line.piece_code} />
                                <span className="flex items-center gap-2">
                                    {!line.piece_id && (
                                        <input
                                            aria-label={t('inventory.reprint.quantity')}
                                            inputMode="numeric"
                                            value={String(line.quantity)}
                                            onChange={(event) => {
                                                const n = Math.max(1, Math.min(10000, Number(event.target.value) || 1));
                                                setLines(lines.map((l) => (l.key === line.key ? { ...l, quantity: n } : l)));
                                            }}
                                            className="h-12 w-20 rounded-md border border-neutral-300 px-2 text-end text-body tabular-nums"
                                        />
                                    )}
                                    <button
                                        type="button"
                                        aria-label={t('inventory.receive.remove')}
                                        onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
                                        className="flex size-12 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                                    >
                                        <Trash size={18} />
                                    </button>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                <PlainSelect
                    label={t('inventory.reprint.reason')}
                    value={reason}
                    onChange={(value) => setReason(value as ReprintReason | '')}
                    placeholder={t('inventory.adjust.reasonPlaceholder')}
                    options={REPRINT_REASONS.map((value) => ({ value, label: t(`inventory.labels.reprintReason.${value}`) }))}
                />
                <TextAreaField
                    id="reprint-note"
                    label={t('inventory.reprint.note')}
                    value={note}
                    onChange={setNote}
                    required={reason === 'OTHER'}
                    maxLength={200}
                />
                {problem && (
                    <p role="alert" className="text-caption text-danger-600">
                        {problem}
                    </p>
                )}
                <InventoryErrorNotice error={error} />
            </div>
            {write.dialog}
        </MyDialog>
    );
}
