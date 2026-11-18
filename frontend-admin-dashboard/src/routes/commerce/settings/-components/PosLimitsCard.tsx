import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { Field, inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { PosErrorNotice, rupees, sanitizeAmount } from '@/routes/commerce/pos/-components/pos-ui';
import { usePosSettings, useSavePosSettings } from '@/routes/commerce/pos/-shared/pos-hooks';

const MAX_AMOUNT = 9_999_999.99;

export interface LimitsForm {
    cashier_discount_percent: string;
    cash_refund_limit: string;
    cash_variance_limit: string;
}

/** The first field that is out of range, or null (§3.4: percent 0..100, amounts 0..9,999,999.99). */
export function limitsProblem(form: LimitsForm): keyof LimitsForm | null {
    const two = /^\d{1,7}(\.\d{1,2})?$/;
    const pct = form.cashier_discount_percent.trim();
    if (!two.test(pct) || Number(pct) > 100) return 'cashier_discount_percent';
    for (const key of ['cash_refund_limit', 'cash_variance_limit'] as const) {
        const v = form[key].trim();
        if (!two.test(v) || Number(v) > MAX_AMOUNT) return key;
    }
    return null;
}

/**
 * What a cashier may do without a manager's PIN: the discount limit, the cash
 * refund limit and the close difference limit. Read by managers; changed by
 * the institute admin only (Q8).
 */
export function PosLimitsCard({ editable }: { editable: boolean }) {
    const { t } = useTranslation('commerce');
    const query = usePosSettings();
    const save = useSavePosSettings();
    const [form, setForm] = useState<LimitsForm>({
        cashier_discount_percent: '',
        cash_refund_limit: '',
        cash_variance_limit: '',
    });
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        if (!query.data) return;
        setForm({
            cashier_discount_percent: String(query.data.cashier_discount_percent),
            cash_refund_limit: query.data.cash_refund_limit.toFixed(2),
            cash_variance_limit: query.data.cash_variance_limit.toFixed(2),
        });
    }, [query.data]);

    const problem = limitsProblem(form);

    const submit = async () => {
        setTouched(true);
        if (problem) return;
        setError(null);
        try {
            await save.mutateAsync([
                {
                    cashier_discount_percent: Number(form.cashier_discount_percent).toFixed(2),
                    cash_refund_limit: Number(form.cash_refund_limit).toFixed(2),
                    cash_variance_limit: Number(form.cash_variance_limit).toFixed(2),
                },
            ]);
            toast.success(t('pos.limits.saved'));
        } catch (raw) {
            setError(raw);
        }
    };

    const field = (key: keyof LimitsForm, label: string, hint: string) => (
        <Field
            label={label}
            htmlFor={`limit-${key}`}
            hint={hint}
            error={touched && problem === key ? t('pos.limits.invalid') : null}
        >
            <input
                id={`limit-${key}`}
                inputMode="decimal"
                disabled={!editable}
                className={inputClass}
                value={form[key]}
                onChange={(event) => setForm((f) => ({ ...f, [key]: sanitizeAmount(event.target.value) }))}
            />
        </Field>
    );

    return (
        <SectionCard
            title={t('pos.limits.title')}
            description={editable ? t('pos.limits.description') : t('pos.limits.readOnly')}
            actions={
                editable ? (
                    <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={submit} loadingText={t('common.saving')}>
                        {t('common.save')}
                    </MyButton>
                ) : undefined
            }
        >
            {query.isLoading && <CommerceLoadingRows rows={1} />}
            {query.isError && <PosErrorNotice error={query.error} />}
            {query.data && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {field('cashier_discount_percent', t('pos.limits.discount'), t('pos.limits.discountHint'))}
                    {field(
                        'cash_refund_limit',
                        t('pos.limits.refund'),
                        t('pos.limits.refundHint', { amount: rupees(query.data.cash_refund_limit) })
                    )}
                    {field('cash_variance_limit', t('pos.limits.variance'), t('pos.limits.varianceHint'))}
                </div>
            )}
            {query.data && !query.data.configured && (
                <p className="text-caption text-muted-foreground">{t('pos.limits.defaults')}</p>
            )}
            <PosErrorNotice error={error} />
        </SectionCard>
    );
}
