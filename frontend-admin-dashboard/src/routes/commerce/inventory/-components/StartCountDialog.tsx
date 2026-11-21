import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { PlainSelect, useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { useCollections } from '@/routes/commerce/-shared/commerce-hooks';
import { DialogButtons, TextAreaField } from '@/routes/commerce/orders/-components/order-ui';
import { openCount } from '../-shared/inventory-api';
import { useInvalidateInventory, useInventoryAccess } from '../-shared/inventory-hooks';
import type { TabProps } from './InventoryPage';
import { ChoiceGroup, collectionName, InventoryErrorNotice, TOUCH } from './inventory-ui';
import { useInventoryWrite } from './use-inventory-write';

type Scope = 'WHOLE' | 'COLLECTION';

/**
 * Start a count: a place the person works at, the whole place or (managers,
 * who can read the collections) one collection there. One open count per place.
 */
export function StartCountDialog({
    open,
    onOpenChange,
    locationId,
    places,
}: TabProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    const navigate = useNavigate();
    const access = useInventoryAccess();
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('cnt');
    const active = places.filter((p) => p.status !== 'INACTIVE');
    const [place, setPlace] = useState(locationId && active.some((p) => p.id === locationId) ? locationId : '');
    const [scope, setScope] = useState<Scope>('WHOLE');
    const [collectionId, setCollectionId] = useState('');
    const [note, setNote] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);
    const collections = useCollections(0, 100, access.enabled && access.isManager);

    const start = async () => {
        setProblem(null);
        setError(null);
        if (!place) return setProblem(t('inventory.counts.pickPlace'));
        if (scope === 'COLLECTION' && !collectionId) return setProblem(t('inventory.counts.pickCollection'));
        const body = {
            location_id: place,
            kind: 'COUNT' as const,
            ...(scope === 'COLLECTION' ? { scope_collection_id: collectionId } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
        };
        try {
            await write.run({
                scope: 'start-count',
                body,
                send: (id) => openCount({ ...body, client_request_id: id }),
                onDone: (view) => {
                    void invalidate();
                    onOpenChange(false);
                    void navigate({ to: '/commerce/inventory/counts/$countId', params: { countId: view.id } });
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    return (
        <MyDialog
            heading={t('inventory.counts.start')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" className={TOUCH} onAsyncClick={start}>
                        {t('inventory.counts.start')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <PlainSelect
                    label={t('inventory.location.label')}
                    value={place}
                    onChange={setPlace}
                    options={active.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                />
                {access.isManager && (
                    <ChoiceGroup<Scope>
                        name="count-scope"
                        label={t('inventory.counts.scope')}
                        value={scope}
                        onChange={setScope}
                        options={[
                            { value: 'WHOLE', label: t('inventory.counts.wholePlace') },
                            { value: 'COLLECTION', label: t('inventory.counts.oneCollection') },
                        ]}
                    />
                )}
                {scope === 'COLLECTION' && (
                    <PlainSelect
                        label={t('inventory.stock.collection')}
                        value={collectionId}
                        onChange={setCollectionId}
                        options={(collections.data?.content ?? []).map((c) => ({ value: c.id, label: collectionName(c, lang) }))}
                    />
                )}
                <TextAreaField id="count-note" label={t('inventory.transfers.note')} value={note} onChange={setNote} maxLength={500} />
                <p className="text-caption text-muted-foreground">{t('inventory.counts.tradingNote')}</p>
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
