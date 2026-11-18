import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { PlainSelect, SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { Field, inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { addChallanSeries } from '../-shared/inventory-api';
import { useChallanSeries, useInvalidateInventory, useInventoryAccess } from '../-shared/inventory-hooks';
import type { InventoryLocation } from '../-shared/inventory-types';
import { InventoryErrorNotice, placeLabel, TOUCH } from './inventory-ui';

/** The document-series rule the server applies to a prefix. */
export const CHALLAN_PREFIX = /^[A-Z0-9][A-Z0-9/-]{0,5}$/;

/**
 * Challan numbering (managers; `GET/POST /stock/challan-series`): the
 * delivery challan series. Without one, a dispatch between two places of the
 * same GSTIN cannot take a number. A store manager adds one for a place they
 * work at; only an admin adds one for every place.
 */
export function ChallanSeriesCard({ places }: { places: InventoryLocation[] }) {
    const { t } = useTranslation('commerce');
    const access = useInventoryAccess();
    const invalidate = useInvalidateInventory();
    const query = useChallanSeries(true);
    const [prefix, setPrefix] = useState('');
    const [locationId, setLocationId] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);
    const placeOf = (id: string | null) => (id ? placeLabel(places.find((p) => p.id === id) ?? { id }) : t('inventory.challan.everyPlace'));

    const add = async () => {
        setProblem(null);
        setError(null);
        const value = prefix.trim().toUpperCase();
        if (!CHALLAN_PREFIX.test(value)) return setProblem(t('inventory.challan.prefixRule'));
        if (!locationId && !access.isAdmin) return setProblem(t('inventory.challan.placeRequired'));
        try {
            await addChallanSeries({ prefix: value, ...(locationId ? { location_id: locationId } : {}) });
            toast.success(t('inventory.challan.added'));
            setPrefix('');
            void invalidate();
        } catch (e) {
            setError(e);
        }
    };

    return (
        <SectionCard title={t('inventory.transfers.challanNumbering')} description={t('inventory.challan.help')}>
            {query.isLoading && <CommerceLoadingRows rows={1} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {query.isSuccess && query.data.length === 0 && (
                <p className="text-body text-warning-600">{t('inventory.challan.none')}</p>
            )}
            <ul className="flex flex-col divide-y divide-border">
                {(query.data ?? []).map((series) => (
                    <li key={series.id} className="flex items-center justify-between gap-3 py-2 text-body">
                        <span className="font-medium">{series.next_number_preview ?? series.prefix}</span>
                        <span className="text-caption text-muted-foreground">
                            {placeOf(series.location_id)} · {series.status ?? ''}
                        </span>
                    </li>
                ))}
            </ul>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
                <Field label={t('inventory.challan.prefix')} htmlFor="challan-prefix" error={problem}>
                    <input
                        id="challan-prefix"
                        className={inputClass}
                        value={prefix}
                        maxLength={6}
                        autoCapitalize="characters"
                        onChange={(event) => setPrefix(event.target.value)}
                    />
                </Field>
                <PlainSelect
                    label={t('inventory.challan.place')}
                    value={locationId}
                    noneLabel={access.isAdmin ? t('inventory.challan.everyPlace') : undefined}
                    onChange={setLocationId}
                    options={places.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                />
                <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onAsyncClick={add}>
                    {t('inventory.transfers.challanNumbering')}
                </MyButton>
            </div>
            <InventoryErrorNotice error={error} />
        </SectionCard>
    );
}
