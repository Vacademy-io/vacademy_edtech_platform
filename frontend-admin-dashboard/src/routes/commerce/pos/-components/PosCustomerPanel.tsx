import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User, UserCircleCheck } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { gstinProblem, normalizeGstin } from '@/routes/commerce/-shared/gstin';
import type { CartCustomer } from '../-shared/pos-cart';
import { lookupCustomer } from '../-shared/pos-api';
import { PosField, posInputClass } from './pos-ui';

const PHONE = /^(\+?91)?[6-9]\d{9}$/;

/** A phone the counter will send: 10 digits (optionally +91). Empty is fine (walk-in). */
export const phoneLooksValid = (phone: string): boolean => {
    const p = phone.replace(/[\s-]/g, '');
    return p === '' || PHONE.test(p);
};

/** The reason a business-bill block is not ready, or null. */
export function customerProblem(customer: CartCustomer): 'phone' | 'gstin' | 'legalName' | null {
    if (!phoneLooksValid(customer.phone)) return 'phone';
    if (customer.businessBill) {
        if (gstinProblem(customer.gstin) !== null) return 'gstin';
        const legal = customer.legalName.trim();
        if (legal.length < 1 || legal.length > 200) return 'legalName';
    }
    return null;
}

/**
 * Who the bill is for. Walk-in by default; a phone looks the customer up on
 * blur and shows the name only (the server never sends more, contract §3.6).
 * "Business bill" adds the buyer's GSTIN and legal name.
 */
export function PosCustomerPanel({
    sessionId,
    customer,
    online,
    onChange,
}: {
    sessionId: string;
    customer: CartCustomer;
    online: boolean;
    onChange: (customer: Partial<CartCustomer>) => void;
}) {
    const { t } = useTranslation('commerce');
    const [found, setFound] = useState<string | null>(null);
    const [touched, setTouched] = useState(false);
    const walkIn = customer.phone.trim() === '' && !customer.businessBill;

    const onPhoneBlur = async () => {
        setTouched(true);
        setFound(null);
        const phone = customer.phone.replace(/[\s-]/g, '');
        if (!phone || !PHONE.test(phone) || !online) return;
        try {
            const answer = await lookupCustomer(sessionId, phone);
            if (answer.found && answer.name) {
                setFound(answer.name);
                if (!customer.name.trim()) onChange({ name: answer.name });
            }
        } catch {
            // The lookup is a convenience; the bill works without it.
        }
    };

    const gstin = customer.gstin;
    const gstinBad = customer.businessBill && touched && gstin !== '' && gstinProblem(gstin) !== null;

    return (
        <section aria-label={t('pos.customer.title')} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2 text-subtitle text-foreground">
                {walkIn ? <User size={20} /> : <UserCircleCheck size={20} className="text-primary-500" />}
                <span className="font-medium">{walkIn ? t('pos.sell.walkIn') : t('pos.customer.title')}</span>
            </div>
            <PosField
                label={t('pos.sell.phone')}
                htmlFor="pos-phone"
                error={touched && !phoneLooksValid(customer.phone) ? t('pos.customer.phoneInvalid') : null}
                hint={found ? t('pos.customer.found', { name: found }) : undefined}
            >
                <input
                    id="pos-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    maxLength={14}
                    className={posInputClass}
                    value={customer.phone}
                    onChange={(event) => onChange({ phone: event.target.value.replace(/[^\d+\s-]/g, '') })}
                    onBlur={() => void onPhoneBlur()}
                />
            </PosField>
            {customer.phone.trim() !== '' && (
                <PosField label={t('pos.customer.name')} htmlFor="pos-name">
                    <input
                        id="pos-name"
                        maxLength={200}
                        className={posInputClass}
                        value={customer.name}
                        onChange={(event) => onChange({ name: event.target.value })}
                    />
                </PosField>
            )}
            <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 text-body text-foreground">
                <span>{t('pos.sell.businessBill')}</span>
                <Switch
                    checked={customer.businessBill}
                    onCheckedChange={(checked) => onChange({ businessBill: checked })}
                    aria-label={t('pos.sell.businessBill')}
                />
            </label>
            {customer.businessBill && (
                <>
                    <PosField
                        label={t('pos.customer.gstin')}
                        htmlFor="pos-gstin"
                        required
                        error={gstinBad ? t(`business.validation.gstin.${gstinProblem(gstin)}`) : null}
                    >
                        <input
                            id="pos-gstin"
                            maxLength={15}
                            autoCapitalize="characters"
                            className={posInputClass}
                            value={gstin}
                            onChange={(event) => onChange({ gstin: normalizeGstin(event.target.value) })}
                            onBlur={() => setTouched(true)}
                        />
                    </PosField>
                    <PosField
                        label={t('pos.customer.legalName')}
                        htmlFor="pos-legal"
                        required
                        error={touched && customer.legalName.trim() === '' ? t('pos.customer.legalNameRequired') : null}
                    >
                        <input
                            id="pos-legal"
                            maxLength={200}
                            className={posInputClass}
                            value={customer.legalName}
                            onChange={(event) => onChange({ legalName: event.target.value })}
                            onBlur={() => setTouched(true)}
                        />
                    </PosField>
                </>
            )}
        </section>
    );
}
