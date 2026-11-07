import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { savePaymentOption, transformLocalPlanToApiFormatArray } from '@/services/payment-options';
import { getInstituteId } from '@/constants/helper';
import { PaymentPlan, PaymentPlans } from '@/types/payment';
import { PaymentPlanCreator } from '@/routes/settings/-components/Payment/PaymentPlanCreator';

export interface CreatedPricing {
    id: string;
    name: string;
    type?: string;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: (option: CreatedPricing) => void;
}

/**
 * A pass's own pricing: the Settings → Payment plan editor (PaymentPlanCreator), saved as
 * an INSTITUTE payment option exactly like the invite flow's AddPaymentPlanDialog does,
 * then handed back so the pass editor can select it. Fee plans (CPO) are created in
 * Financial Management and picked from the list instead.
 */
export function CreatePassPricingDialog({ open, onOpenChange, onSaved }: Props) {
    const { t } = useTranslation('manageAccessPasses');
    const queryClient = useQueryClient();
    const [featuresGlobal, setFeaturesGlobal] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [requireApproval, setRequireApproval] = useState(false);
    const [planChangeAllowed, setPlanChangeAllowed] = useState(false);
    const [regionalPricingEnabled, setRegionalPricingEnabled] = useState(false);
    const [regionalPricingCurrencies, setRegionalPricingCurrencies] = useState<string[]>([]);

    const reset = () => {
        setRequireApproval(false);
        setPlanChangeAllowed(false);
        setRegionalPricingEnabled(false);
        setRegionalPricingCurrencies([]);
    };

    const handleSave = async (plan: PaymentPlan) => {
        if (plan.type === PaymentPlans.CPO) {
            toast.error(
                t(
                    'pricing.cpoNotHere',
                    'Create fee plans in Financial Management, then pick them from the pricing list.'
                )
            );
            return;
        }
        setIsSaving(true);
        try {
            const apiPlans = transformLocalPlanToApiFormatArray({
                ...plan,
                planChangeAllowed,
                config: { ...plan.config, planChangeAllowed },
            });
            const recurring = plan.type === PaymentPlans.SUBSCRIPTION || plan.type === PaymentPlans.UPFRONT;
            // Always a new option: the backend generates its id (and clears placeholder plan ids).
            const saved = await savePaymentOption({
                name: plan.name,
                status: 'ACTIVE',
                source: 'INSTITUTE',
                source_id: getInstituteId() ?? '',
                type: plan.type,
                require_approval: requireApproval,
                plan_change_allowed: planChangeAllowed,
                ...(recurring
                    ? {
                          regional_pricing_enabled: regionalPricingEnabled,
                          regional_pricing_currencies: regionalPricingEnabled ? regionalPricingCurrencies : [],
                      }
                    : {}),
                payment_plans: apiPlans,
                payment_option_metadata_json: JSON.stringify({
                    currency: plan.currency,
                    features: plan.features || [],
                    config: plan.config,
                    subscriptionData:
                        plan.type === 'SUBSCRIPTION'
                            ? {
                                  customIntervals: plan.config?.subscription?.customIntervals || [],
                                  planDiscounts: plan.config?.planDiscounts || {},
                              }
                            : undefined,
                    upfrontData:
                        plan.type === 'ONE_TIME'
                            ? {
                                  fullPrice: plan.config?.upfront?.fullPrice,
                                  planDiscounts: plan.config?.planDiscounts || {},
                              }
                            : undefined,
                    donationData:
                        plan.type === 'DONATION'
                            ? {
                                  suggestedAmounts: plan.config?.donation?.suggestedAmounts,
                                  minimumAmount: plan.config?.donation?.minimumAmount,
                                  allowCustomAmount: plan.config?.donation?.allowCustomAmount,
                              }
                            : undefined,
                    freeData: plan.type === 'FREE' ? { validityDays: plan.config?.free?.validityDays } : undefined,
                }),
            });
            if (!saved?.id) throw new Error('no id');
            await queryClient.invalidateQueries({ queryKey: ['GET_PAYMENT_DETAILS'] });
            toast.success(t('pricing.created', 'Pricing created'));
            onSaved({ id: saved.id, name: saved.name || plan.name, type: plan.type });
            reset();
            onOpenChange(false);
        } catch {
            toast.error(t('pricing.failed', 'Could not save the pricing'));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <PaymentPlanCreator
            isOpen={open}
            onClose={() => {
                reset();
                onOpenChange(false);
            }}
            onSave={handleSave}
            editingPlan={null}
            featuresGlobal={featuresGlobal}
            setFeaturesGlobal={setFeaturesGlobal}
            isSaving={isSaving}
            requireApproval={requireApproval}
            setRequireApproval={setRequireApproval}
            planChangeAllowed={planChangeAllowed}
            setPlanChangeAllowed={setPlanChangeAllowed}
            regionalPricingEnabled={regionalPricingEnabled}
            setRegionalPricingEnabled={setRegionalPricingEnabled}
            regionalPricingCurrencies={regionalPricingCurrencies}
            setRegionalPricingCurrencies={setRegionalPricingCurrencies}
        />
    );
}
