import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { DialogButtons, TextAreaField } from '@/routes/commerce/orders/-components/order-ui';
import { createTransfer } from '../-shared/inventory-api';
import { useInvalidateInventory } from '../-shared/inventory-hooks';
import type { TabProps } from './InventoryPage';
import { InventoryErrorNotice, TOUCH } from './inventory-ui';
import { useInventoryWrite } from './use-inventory-write';

/**
 * New transfer: from a place the person works at, to any other active place.
 * Creates an empty draft and opens it (lines are added on the transfer page).
 */
export function NewTransferDialog({
    open,
    onOpenChange,
    locationId,
    places,
    allPlaces,
}: TabProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('trf');
    const fromOptions = places.filter((p) => p.status !== 'INACTIVE');
    const [from, setFrom] = useState(locationId && fromOptions.some((p) => p.id === locationId) ? locationId : '');
    const [to, setTo] = useState('');
    const [note, setNote] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);
    const toOptions = allPlaces.filter((p) => p.status !== 'INACTIVE' && p.id !== from);

    const create = async () => {
        setProblem(null);
        setError(null);
        if (!from || !to) return setProblem(t('inventory.transfers.pickBoth'));
        const body = { from_location_id: from, to_location_id: to, ...(note.trim() ? { note: note.trim() } : {}), lines: [] };
        try {
            await write.run({
                scope: 'new-transfer',
                body,
                send: (id) => createTransfer({ ...body, client_request_id: id }),
                onDone: (view) => {
                    void invalidate();
                    onOpenChange(false);
                    void navigate({ to: '/commerce/inventory/transfers/$transferId', params: { transferId: view.id } });
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    return (
        <MyDialog
            heading={t('inventory.transfers.new')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" className={TOUCH} onAsyncClick={create}>
                        {t('inventory.transfers.create')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <PlainSelect
                    label={t('inventory.transfers.from')}
                    value={from}
                    onChange={(value) => {
                        setFrom(value);
                        if (value === to) setTo('');
                    }}
                    options={fromOptions.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                />
                <PlainSelect
                    label={t('inventory.transfers.to')}
                    value={to}
                    onChange={setTo}
                    options={toOptions.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                />
                <TextAreaField id="transfer-note" label={t('inventory.transfers.note')} value={note} onChange={setNote} maxLength={500} />
                {problem && (
                    <p role="alert" className="text-caption text-danger-600">
                        {problem}
                    </p>
                )}
                <InventoryErrorNotice error={error} />
            </div>
        </MyDialog>
    );
}
