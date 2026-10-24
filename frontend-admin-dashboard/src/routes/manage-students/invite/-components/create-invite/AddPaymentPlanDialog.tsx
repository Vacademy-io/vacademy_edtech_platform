import { savePaymentOption, transformLocalPlanToApiFormatArray } from '@/services/payment-options';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import { PaymentPlan, PaymentPlans } from '@/types/payment';
import { InviteLinkFormValues } from './GenerateInviteLinkSchema';
import { UseFormReturn } from 'react-hook-form';
import { useEffect, useState } from 'react';
import { PaymentPlanCreator } from '@/routes/settings/-components/Payment/PaymentPlanCreator';
import { useQueryClient } from '@tanstack/react-query';
import { buildCreateCPOPayload } from '@/routes/financial-management/fee-plans/-components/CreateCPODialog';
import { useCreateCPO } from '@/routes/financial-management/fee-plans/-services/cpo-service';
import { useTranslation } from 'react-i18next';
import { splitPlansByType, type PaymentOption } from './-utils/helper';
import { RegionalPricingDialog } from '@/routes/settings/-components/Payment/RegionalPricingDialog';

interface PaymentPlansDialogProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

const AddPaymentPlanDialog = ({ form }: PaymentPlansDialogProps) => {
    const { t } = useTranslation('manageStudentsAddPaymentPlanDialog');
    const queryClient = useQueryClient();
    const [editingPlan, setEditingPlan] = useState<PaymentPlan | null>(null);
    const [showPaymentPlanCreator, setShowPaymentPlanCreator] = useState(
        form.watch('showAddPlanDialog')
    );
    const [featuresGlobal, setFeaturesGlobal] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [requireApproval, setRequireApproval] = useState(false);
    // Option-level master switch for plan change. Carried here so an option created from
    // the invite flow can opt into switching too, exactly as one created from Settings can.
    const [planChangeAllowed, setPlanChangeAllowed] = useState(false);
    // Regional pricing, saved with the option exactly as from Settings.
    const [regionalPricingEnabled, setRegionalPricingEnabled] = useState(false);
    const [regionalPricingCurrencies, setRegionalPricingCurrencies] = useState<string[]>([]);
    // After creating an option with regional pricing on, its panel opens for country prices.
    const [regionalPanel, setRegionalPanel] = useState<{ id: string; name: string } | null>(null);
    const instituteId = getInstituteId();
    const createCPOMutation = useCreateCPO();

    const handleError = (error: unknown, operation: string) => {
        console.error(`Error in ${operation}:`, error);
        toast.error(t('errors.generic', { operation }));
    };

    const handleClosePaymentPlanCreator = () => {
        form.setValue('showAddPlanDialog', false);
        setShowPaymentPlanCreator(false);
        setEditingPlan(null);
        setRequireApproval(false);
        setPlanChangeAllowed(false);
        setRegionalPricingEnabled(false);
        setRegionalPricingCurrencies([]);
    };

    const handleSavePaymentPlan = async (plan: PaymentPlan) => {
        setIsSaving(true);
        try {
            // CPO plans are created via the dedicated CREATE_CPO endpoint (which also mints the
            // mirror payment_option). Sending them through savePaymentOption would drop the fee
            // structure. The approval toggle is carried inside cpoForm → require_approval.
            if (plan.type === PaymentPlans.CPO) {
                const cpoForm = plan.config?.cpoForm;
                if (!cpoForm) throw new Error('Missing CPO form data');
                const payload = buildCreateCPOPayload(
                    { ...cpoForm, requireApproval: requireApproval || !!cpoForm.requireApproval },
                    []
                );
                await createCPOMutation.mutateAsync(payload);
                // Refetch the invite's payment-option list so the new CPO mirror appears and
                // can be selected for this invite.
                await queryClient.invalidateQueries({ queryKey: ['GET_PAYMENT_DETAILS'] });
                toast.success(t('success.feePlanCreated'));
                form.setValue('showAddPlanDialog', false);
                setEditingPlan(null);
                setShowPaymentPlanCreator(false);
                setRequireApproval(false);
        setPlanChangeAllowed(false);
                setRegionalPricingEnabled(false);
                setRegionalPricingCurrencies([]);
                return;
            }

            // A ONE_TIME option has one plan and no per-interval checkbox, so the option
            // toggle IS that plan's flag. Mirrors PaymentSettings.handleSavePaymentPlan —
            // without it a one-time option created here could never be a switch target.
            const apiPlans = transformLocalPlanToApiFormatArray({
                ...plan,
                planChangeAllowed,
                config: { ...plan.config, planChangeAllowed },
            });
            const paymentOptionRequest = {
                id: plan.id, // Use the plan ID directly (either existing or new)
                name: plan.name,
                status: 'ACTIVE',
                source: 'INSTITUTE',
                source_id: instituteId ?? '',
                type: plan.type,
                require_approval: requireApproval,
                plan_change_allowed: planChangeAllowed,
                ...(plan.type === PaymentPlans.SUBSCRIPTION || plan.type === PaymentPlans.UPFRONT
                    ? {
                          regional_pricing_enabled: regionalPricingEnabled,
                          regional_pricing_currencies: regionalPricingEnabled
                              ? regionalPricingCurrencies
                              : [],
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
                    freeData:
                        plan.type === 'FREE'
                            ? {
                                  validityDays: plan.config?.free?.validityDays,
                              }
                            : undefined,
                }),
            };

            const saved = await savePaymentOption(paymentOptionRequest);
            // Show the new plan immediately, in the picker's own shape (name, price,
            // created date, creator), while the list refetches behind it. The server
            // response is the source of truth: it carries the generated id, and the
            // request object used to be pushed raw here and rendered as "Free for 0 days".
            const { freePlans: newFree, paidPlans: newPaid } = splitPlansByType(
                saved && saved.id ? [saved as unknown as PaymentOption] : []
            );
            if (newFree.length > 0) {
                form.setValue('freePlans', [...form.getValues('freePlans'), ...newFree]);
            }
            if (newPaid.length > 0) {
                form.setValue('paidPlans', [
                    ...form.getValues('paidPlans'),
                    // The form schema's price is a transformed string; the helper leaves it optional.
                    ...newPaid.map((plan) => ({ ...plan, price: plan.price ?? '' })),
                ]);
            }
            form.setValue('showAddPlanDialog', false);
            setEditingPlan(null);
            setShowPaymentPlanCreator(false);
            setRequireApproval(false);
        setPlanChangeAllowed(false);
            if (
                regionalPricingEnabled &&
                saved?.id &&
                (plan.type === PaymentPlans.SUBSCRIPTION || plan.type === PaymentPlans.UPFRONT)
            ) {
                setRegionalPanel({ id: saved.id, name: saved.name || plan.name });
            }
            setRegionalPricingEnabled(false);
            setRegionalPricingCurrencies([]);
            queryClient.invalidateQueries({ queryKey: ['GET_PAYMENT_DETAILS'] });
        } catch (error) {
            handleError(error, t('errors.operations.savePaymentPlan'));
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        setShowPaymentPlanCreator(form.watch('showAddPlanDialog'));
    }, [form.watch('showAddPlanDialog')]);

    return (
        <>
            <PaymentPlanCreator
                key={editingPlan?.id}
                isOpen={showPaymentPlanCreator}
                onClose={handleClosePaymentPlanCreator}
                onSave={(plan) => handleSavePaymentPlan(plan)}
                editingPlan={editingPlan}
                featuresGlobal={featuresGlobal}
                setFeaturesGlobal={setFeaturesGlobal}
                defaultCurrency={'GBP'}
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
            {regionalPanel && (
                <RegionalPricingDialog
                    open={!!regionalPanel}
                    onOpenChange={(open) => {
                        if (!open) setRegionalPanel(null);
                    }}
                    paymentOptionId={regionalPanel.id}
                    paymentOptionName={regionalPanel.name}
                />
            )}
        </>
    );
};

export default AddPaymentPlanDialog;
