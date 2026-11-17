import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { todayIso } from '@/routes/commerce/orders/-shared/order-format';
import { ORDER_CHANNELS, PAYMENT_METHODS } from '@/routes/commerce/orders/-shared/order-types';
import { Field, inputClass } from './order-ui';

export const SEARCH_DELAY_MS = 300;
export const SEARCH_MAX_LENGTH = 64;

export interface DeskFilterValue {
    q: string;
    from: string;
    to: string;
    channel: string;
    method: string;
}

/**
 * Search (order number, phone, part of a name, tracking number; the server
 * searches), a date range, channel and payment method. No location filter: the
 * server has none (G4). Everything lives in the address.
 */
export function OrderFilters({
    value,
    onChange,
    filtered,
    trailing,
}: {
    value: DeskFilterValue;
    onChange: (next: Partial<DeskFilterValue>) => void;
    filtered: boolean;
    trailing?: ReactNode;
}) {
    const { t } = useTranslation('commerce');
    const [search, setSearch] = useState(value.q);
    const latest = useRef(value.q);

    // The address changed from elsewhere (Back, Clear filters): follow it.
    useEffect(() => {
        if (value.q !== latest.current) {
            latest.current = value.q;
            setSearch(value.q);
        }
    }, [value.q]);

    useEffect(() => {
        const next = search.trim();
        if (next === latest.current) return undefined;
        const timer = setTimeout(() => {
            latest.current = next;
            onChange({ q: next });
        }, SEARCH_DELAY_MS);
        return () => clearTimeout(timer);
    }, [search, onChange]);

    const today = todayIso();
    return (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
            <div className="relative">
                <MagnifyingGlass
                    size={16}
                    className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <MyInput
                    inputType="search"
                    input={search}
                    maxLength={SEARCH_MAX_LENGTH}
                    onChangeFunction={(event) => setSearch(event.target.value)}
                    inputPlaceholder={t('orders.list.searchPlaceholder')}
                    aria-label={t('orders.list.searchPlaceholder')}
                    className="ps-9 sm:w-full"
                />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label={t('orders.filters.from')} htmlFor="orders-from">
                    <input
                        id="orders-from"
                        type="date"
                        className={inputClass}
                        value={value.from}
                        max={value.to || today}
                        onChange={(event) => onChange({ from: event.target.value })}
                    />
                </Field>
                <Field label={t('orders.filters.to')} htmlFor="orders-to">
                    <input
                        id="orders-to"
                        type="date"
                        className={inputClass}
                        value={value.to}
                        min={value.from || undefined}
                        max={today}
                        onChange={(event) => onChange({ to: event.target.value })}
                    />
                </Field>
                <PlainSelect
                    label={t('orders.filters.channel')}
                    value={value.channel}
                    onChange={(channel) => onChange({ channel })}
                    noneLabel={t('orders.filters.all')}
                    options={ORDER_CHANNELS.map((channel) => ({
                        value: channel,
                        label: t(`orders.channel.${channel}`),
                    }))}
                />
                <PlainSelect
                    label={t('orders.filters.method')}
                    value={value.method}
                    onChange={(method) => onChange({ method })}
                    noneLabel={t('orders.filters.all')}
                    options={PAYMENT_METHODS.map((method) => ({
                        value: method,
                        label: t(`orders.paymentMethod.${method}`),
                    }))}
                />
            </div>
            {(filtered || trailing) && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {filtered && (
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            onClick={() => {
                                setSearch('');
                                latest.current = '';
                                onChange({ q: '', from: '', to: '', channel: '', method: '' });
                            }}
                        >
                            {t('orders.empty.clearFilters')}
                        </MyButton>
                    )}
                    {trailing}
                </div>
            )}
        </div>
    );
}
