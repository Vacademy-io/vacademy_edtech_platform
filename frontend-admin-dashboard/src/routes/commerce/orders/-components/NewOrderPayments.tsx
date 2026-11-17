import { useTranslation } from 'react-i18next';
import { Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import { PlainSelect, SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { MAX_TENDERS, type NewOrderProblems, type TenderForm } from '@/routes/commerce/orders/-shared/new-order';
import type { OrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { TENDER_MODES, type TenderMode } from '@/routes/commerce/orders/-shared/order-types';
import { Field, OrderNotice, inputClass, useOrderErrorText } from './order-ui';

let tenderCounter = 0;
const newTender = (): TenderForm => {
    tenderCounter += 1;
    return { key: `t${tenderCounter}`, mode: 'CASH', amount: '', reference: '' };
};

/**
 * Payments taken now for a staff order (cash, UPI, card, bank transfer,
 * cheque; at most 10) and "Rest on credit". The server checks the sum against
 * its own total and answers TENDERS_SHORT / TENDERS_OVER with the amounts.
 */
export function NewOrderPayments({
    tenders,
    onChange,
    restOnCredit,
    onRestOnCredit,
    problems,
    tenderError,
}: {
    tenders: TenderForm[];
    onChange: (tenders: TenderForm[]) => void;
    restOnCredit: boolean;
    onRestOnCredit: (on: boolean) => void;
    problems: NewOrderProblems;
    tenderError: OrderError | null;
}) {
    const { t } = useTranslation('commerce');
    const errorText = useOrderErrorText();
    const change = (key: string, patch: Partial<TenderForm>) =>
        onChange(tenders.map((tender) => (tender.key === key ? { ...tender, ...patch } : tender)));

    return (
        <SectionCard title={t('orders.new.payments.title')} description={t('orders.new.payments.description')}>
            {tenders.length === 0 && <p className="text-body text-muted-foreground">{t('orders.new.payments.none')}</p>}
            <ul className="flex flex-col gap-2">
                {tenders.map((tender, index) => {
                    const amountProblem = problems[`tender.${tender.key}.amount`];
                    return (
                        <li key={tender.key} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-3 sm:grid-cols-7">
                            <PlainSelect
                                className="sm:col-span-2"
                                label={t('orders.new.payments.mode')}
                                value={tender.mode}
                                onChange={(mode) => change(tender.key, { mode: (mode || 'CASH') as TenderMode })}
                                options={TENDER_MODES.map((mode) => ({ value: mode, label: t(`orders.tender.${mode}`) }))}
                            />
                            <Field
                                className="sm:col-span-2"
                                label={t('orders.new.payments.amount')}
                                htmlFor={`tender-amount-${tender.key}`}
                                error={amountProblem ? t(amountProblem) : null}
                            >
                                <input
                                    id={`tender-amount-${tender.key}`}
                                    inputMode="decimal"
                                    value={tender.amount}
                                    onChange={(event) => change(tender.key, { amount: event.target.value })}
                                    className={inputClass}
                                />
                            </Field>
                            <Field className="sm:col-span-2" label={t('orders.new.payments.reference')} htmlFor={`tender-ref-${tender.key}`}>
                                <input
                                    id={`tender-ref-${tender.key}`}
                                    value={tender.reference}
                                    maxLength={100}
                                    onChange={(event) => change(tender.key, { reference: event.target.value })}
                                    className={inputClass}
                                />
                            </Field>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                layoutVariant="icon"
                                scale="medium"
                                aria-label={t('orders.new.payments.remove', { number: index + 1 })}
                                onClick={() => onChange(tenders.filter((item) => item.key !== tender.key))}
                            >
                                <Trash size={16} />
                            </MyButton>
                        </li>
                    );
                })}
            </ul>
            {tenders.length < MAX_TENDERS && (
                <div>
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => onChange([...tenders, newTender()])}>
                        <Plus size={16} />
                        {t('orders.new.payments.add')}
                    </MyButton>
                </div>
            )}
            <label className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-border p-3">
                <span className="flex flex-col">
                    <span className="text-body text-foreground">{t('orders.new.restOnCredit')}</span>
                    <span className="text-caption text-muted-foreground">{t('orders.new.payments.restOnCreditHint')}</span>
                </span>
                <Switch checked={restOnCredit} onCheckedChange={(on) => onRestOnCredit(on === true)} />
            </label>
            {tenderError && (
                <OrderNotice tone="danger">
                    <p>{errorText(tenderError)}</p>
                    <p className="text-caption">{t('orders.new.payments.tendersHint')}</p>
                    {tenderError.message && <p className="text-caption text-muted-foreground">{tenderError.message}</p>}
                </OrderNotice>
            )}
        </SectionCard>
    );
}
