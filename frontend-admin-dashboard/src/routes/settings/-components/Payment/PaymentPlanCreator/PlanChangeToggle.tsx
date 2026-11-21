import React from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PaymentPlanType, PaymentPlans } from '@/types/payment';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '../../NamingSettings';

/**
 * Option-level master switch for plan change.
 *
 * <p>Two flags gate a switch target: this one on the payment option, and a checkbox on each
 * plan inside it. Both must be on, so an admin can open an option to switching and still
 * choose which of its intervals people may land on.
 *
 * <p>Only SUBSCRIPTION and ONE_TIME options can take part — a fee structure (CPO) carries an
 * installment schedule that would have to be regenerated, and a donation has no fixed price
 * to prorate against.
 */
interface PlanChangeToggleProps {
    planType: PaymentPlanType;
    planChangeAllowed: boolean;
    onPlanChangeAllowedChange: (value: boolean) => void;
}

const SWITCHABLE_TYPES: PaymentPlanType[] = [PaymentPlans.SUBSCRIPTION, PaymentPlans.UPFRONT];

export const PlanChangeToggle: React.FC<PlanChangeToggleProps> = ({
    planType,
    planChangeAllowed,
    onPlanChangeAllowedChange,
}) => {
    const { t } = useTranslation('settingsPlanChangeToggle');
    const learners = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);
    const learnerTerm = learners.toLocaleLowerCase();

    // Nothing to configure on option types that can never be a switch target.
    if (!SWITCHABLE_TYPES.includes(planType)) {
        return null;
    }

    return (
        <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2">
                <Label
                    htmlFor="planChangeAllowed"
                    className="text-sm font-medium text-neutral-900"
                >
                    {t('label', { learners: learnerTerm })}
                </Label>
                <Switch
                    id="planChangeAllowed"
                    checked={planChangeAllowed}
                    onCheckedChange={onPlanChangeAllowedChange}
                />
            </div>
            <div className="rounded-md bg-info-50 p-2">
                <p className="text-xs text-info-700">
                    {planChangeAllowed ? t('message.on', { learners: learnerTerm }) : t('message.off')}
                </p>
            </div>
        </div>
    );
};
