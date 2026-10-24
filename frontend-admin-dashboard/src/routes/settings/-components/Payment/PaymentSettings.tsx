import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { CreditCard, Globe, Plus, Eye, CircleNotch } from '@phosphor-icons/react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { PaymentPlanList } from './PaymentPlanList';
import { MyButton } from '@/components/design-system/button';
import { SubscriptionPlanPreview } from './SubscriptionPlanPreview';
import { DonationPlanPreview } from './DonationPlanPreview';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
    savePaymentOption,
    getPaymentOptions,
    transformApiPlanToLocalFormat,
    makeDefaultPaymentOption,
    transformLocalPlanToApiFormatArray,
} from '@/services/payment-options';
import { DeletePaymentOptionDialog } from './DeletePaymentOptionDialog';
import { RegionalPricingDialog } from './RegionalPricingDialog';
import { toast } from 'sonner';
import { currencyOptions } from '../../-constants/payments';
import { getInstituteId } from '@/constants/helper';
import { PaymentPlan, PaymentPlans, PaymentPlanTag, PaymentPlanType } from '@/types/payment';
import { PaymentPlanCreator } from './PaymentPlanCreator/index';
import { getCurrencySymbol } from './utils/utils';
import { useCreateCPO } from '@/routes/financial-management/fee-plans/-services/cpo-service';
import { buildCreateCPOPayload } from '@/routes/financial-management/fee-plans/-components/CreateCPODialog';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import PackageSessionRenewalSettings from './PackageSessionRenewalSettings';
import OfflinePaymentModesSettings from './OfflinePaymentModesSettings';
import { useTranslation } from 'react-i18next';

interface Interval {
    /** payment_plan.id — round-tripped so a save updates the plan instead of replacing it. */
    id?: string;
    price: string;
    originalPrice: string;
    title?: string;
    value: number;
    unit: string;
    features?: string[];
    /** Members on another plan may switch to this interval (option flag must also be on). */
    planChangeAllowed?: boolean;
}

interface DiscountCoupon {
    id: string;
    code: string;
    name: string;
    type: 'percentage' | 'fixed';
    value: number;
    currency: string;
    isActive: boolean;
    usageLimit?: number;
    usedCount: number;
    expiryDate?: string;
    applicablePlans: string[];
}

const PaymentSettings = () => {
    const { t } = useTranslation('settingsPayment');
    const [editingPlan, setEditingPlan] = useState<PaymentPlan | null>(null);
    const [currency, setCurrency] = useState<string>('GBP');
    const [showPaymentPlanCreator, setShowPaymentPlanCreator] = useState(false);
    const [showPlanPreview, setShowPlanPreview] = useState(false);
    const [previewingPlan, setPreviewingPlan] = useState<PaymentPlan | null>(null);
    const [featuresGlobal, setFeaturesGlobal] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [planToDelete, setPlanToDelete] = useState<PaymentPlan | null>(null);
    const [regionalPricingPlan, setRegionalPricingPlan] = useState<PaymentPlan | null>(null);
    const previewDialogRef = useRef<HTMLDivElement>(null);
    const [requireApproval, setRequireApproval] = useState(false);
    // Option-level master switch for plan change; the per-plan checkboxes are inert
    // while this is off. Held here, like requireApproval, because it belongs to the
    // payment option rather than to any one plan inside it.
    const [planChangeAllowed, setPlanChangeAllowed] = useState(false);
    // Regional pricing is an option-level setting too, edited in the creator and saved with it.
    const [regionalPricingEnabled, setRegionalPricingEnabled] = useState(false);
    const [regionalPricingCurrencies, setRegionalPricingCurrencies] = useState<string[]>([]);

    const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([]);
    const instituteId = getInstituteId();

    // CPO hooks
    const createCPOMutation = useCreateCPO();
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    const batches = useMemo(() => instituteDetails?.batches_for_sessions ?? [], [instituteDetails]);

    // Helper functions for plan transformations
    const transformIntervalsToSubscriptionPlans = (intervals: Interval[] = []) => {
        return intervals.reduce(
            (acc, interval, idx) => ({
                ...acc,
                [`custom${idx}`]: {
                    enabled: true,
                    price: interval.originalPrice || '0',
                    interval: 'custom',
                    title:
                        interval.title ||
                        t('intervalPlanFallback', { value: interval.value, unit: interval.unit }),
                    features: interval.features || [],
                    customInterval: {
                        value: interval.value,
                        unit: interval.unit,
                    },
                    originalPrice: interval.price || '0',
                },
            }),
            {}
        );
    };

    const getAllFeatures = (plan: PaymentPlan): string[] => {
        const planFeatures = plan.features || [];
        const globalFeatures = featuresGlobal || [];
        const intervalFeatures =
            plan.config?.subscription?.customIntervals?.flatMap(
                (interval: Interval) => interval.features || []
            ) || [];

        return [...new Set([...planFeatures, ...globalFeatures, ...intervalFeatures])];
    };

    const createDiscountCoupons = (plan: PaymentPlan): DiscountCoupon[] => {
        const planDiscounts = plan.config?.planDiscounts || {};
        const intervals = plan.config?.subscription?.customIntervals || [];
        const currencySymbol = getCurrencySymbol(plan.currency);

        return intervals
            .map((interval: Interval, idx: number) => {
                const discount = planDiscounts[`interval_${idx}`];
                if (!discount || discount.type === 'none' || !discount.amount) return null;

                const discountLabel =
                    discount.type === 'percentage'
                        ? t('discounts.percentageOff', { amount: discount.amount })
                        : t('discounts.fixedOff', {
                              symbol: currencySymbol,
                              amount: discount.amount,
                          });
                const intervalTitle =
                    interval.title ||
                    t('intervalPlanFallback', { value: interval.value, unit: interval.unit });

                return {
                    id: `plan-discount-${idx}`,
                    code: `${discount.type === 'percentage' ? 'PERCENT' : 'FLAT'}_${discount.amount}_${idx}`,
                    name: t('discounts.nameWithInterval', { discountLabel, intervalTitle }),
                    type: discount.type,
                    value: parseFloat(discount.amount),
                    currency: plan.currency,
                    isActive: true,
                    usageLimit: undefined,
                    usedCount: 0,
                    expiryDate: undefined,
                    applicablePlans: [`custom${idx}`],
                };
            })
            .filter(Boolean) as DiscountCoupon[];
    };

    // Load payment options from API
    const loadPaymentOptions = async () => {
        setIsLoading(true);
        try {
            const request = {
                types: [
                    PaymentPlans.SUBSCRIPTION,
                    PaymentPlans.UPFRONT,
                    PaymentPlans.DONATION,
                    PaymentPlans.FREE,
                    PaymentPlans.CPO,
                ],
                source: 'INSTITUTE',
                source_id: instituteId ?? '',
                require_approval: true,
                not_require_approval: true,
            };

            const response = await getPaymentOptions(request);
            const transformedPlans =
                response
                    ?.map((paymentOption) => {
                        if (paymentOption.type === PaymentPlans.SUBSCRIPTION) {
                            // Aggregate all intervals
                            const intervals = paymentOption.payment_plans.map((plan) => ({
                                // The id is round-tripped so a later save UPDATES this
                                // plan. Without it the backend retires every stored plan
                                // and mints new ids, orphaning user_plan.plan_id.
                                id: plan.id,
                                price: plan.actual_price, // discounted price
                                originalPrice: plan.elevated_price, // original price
                                title: plan.name || '',
                                value: plan.validity_in_days,
                                unit: 'days', // or 'months', depending on your logic
                                features: JSON.parse(plan.feature_json || '[]'),
                                planChangeAllowed: plan.plan_change_allowed ?? false,
                            }));
                            // Use the first plan for other fields
                            const basePlan = paymentOption.payment_plans[0];
                            if (!basePlan)
                                return {
                                    id: paymentOption.id || '',
                                    tag: paymentOption.tag as PaymentPlanTag,
                                    type: paymentOption.type as PaymentPlanType,
                                    name: paymentOption.name || '',
                                    config: {
                                        subscription: {
                                            customIntervals: [],
                                        },
                                        free: {
                                            validityDays: 320,
                                        },
                                    },
                                };

                            const localPlan = transformApiPlanToLocalFormat({
                                ...basePlan,
                                name: basePlan.name || '',
                                currency: basePlan.currency || '',
                                feature_json: basePlan.feature_json || '[]',
                                payment_option_metadata_json:
                                    paymentOption.payment_option_metadata_json,
                                type: paymentOption.type,
                            });
                            // Set all intervals in config
                            return {
                                ...localPlan,
                                id: paymentOption.id || '',
                                tag: paymentOption.tag as PaymentPlanTag,
                                type: localPlan.type as PaymentPlanType,
                                name: paymentOption.name || '',
                                currency: localPlan.currency || '',
                                config: {
                                    ...localPlan.config,
                                    subscription: {
                                        ...((localPlan.config && localPlan.config.subscription) ||
                                            {}),
                                        customIntervals: intervals,
                                    },
                                },
                                requireApproval: paymentOption.require_approval,
                                planChangeAllowed: paymentOption.plan_change_allowed ?? false,
                            } as PaymentPlan;
                        } else if (paymentOption.type === PaymentPlans.FREE) {
                            // For FREE plans, we can create a plan even without payment_plans
                            const metadata = paymentOption.payment_option_metadata_json
                                ? JSON.parse(paymentOption.payment_option_metadata_json)
                                : {};

                            return {
                                id: paymentOption.id || '',
                                tag: paymentOption.tag as PaymentPlanTag,
                                type: PaymentPlans.FREE as PaymentPlanType,
                                name: paymentOption.name || '',
                                currency: metadata.currency || 'GBP',
                                features: metadata.features || [],
                                config: {
                                    ...metadata.config,
                                    // This branch builds the plan without going through
                                    // transformApiPlanToLocalFormat, so it has to derive the
                                    // access option itself. Defaulting to 30 days here (as it
                                    // used to) re-stamped a window no admin ever chose, since
                                    // the free config UI was never rendered; deriving it from
                                    // the saved value keeps a plan on the option it was saved
                                    // with.
                                    free: {
                                        accessType:
                                            metadata.freeData?.validityDays > 0
                                                ? 'limited'
                                                : 'unlimited',
                                        validityDays: metadata.freeData?.validityDays ?? undefined,
                                    },
                                },
                                isDefault: false,
                                requireApproval: paymentOption.require_approval,
                                planChangeAllowed: paymentOption.plan_change_allowed ?? false,
                            } as PaymentPlan;
                        } else if (paymentOption.type === PaymentPlans.CPO) {
                            // CPO mirror: id = mirror PaymentOption ID (used for makeDefault)
                            // complex_payment_option_id = actual CPO ID (used for full-details fetch)
                            return {
                                id: paymentOption.id || '',
                                tag: paymentOption.tag as PaymentPlanTag,
                                type: PaymentPlans.CPO as PaymentPlanType,
                                name: paymentOption.name || '',
                                currency: 'INR',
                                isDefault: paymentOption.tag === 'DEFAULT',
                                config: {
                                    cpoId: paymentOption.complex_payment_option_id || '',
                                },
                                requireApproval: paymentOption.require_approval,
                                planChangeAllowed: paymentOption.plan_change_allowed ?? false,
                            } as PaymentPlan;
                        } else if (paymentOption.payment_plans?.length > 0) {
                            // For other non-subscription plans, just use the first plan
                            const plan = paymentOption.payment_plans[0];
                            if (!plan) return null;
                            const localPlan = transformApiPlanToLocalFormat({
                                ...plan,
                                name: paymentOption.name || '',
                                currency: plan.currency || '',
                                feature_json: plan.feature_json || '[]',
                                payment_option_metadata_json:
                                    paymentOption.payment_option_metadata_json,
                                type: paymentOption.type,
                            });
                            return {
                                ...localPlan,
                                id: paymentOption.id || '',
                                tag: paymentOption.tag as PaymentPlanTag,
                                type: localPlan.type as PaymentPlanType,
                                name: paymentOption.name || '',
                                currency: localPlan.currency || '',
                                requireApproval: paymentOption.require_approval,
                                planChangeAllowed: paymentOption.plan_change_allowed ?? false,
                            } as PaymentPlan;
                        }
                        return null;
                    })
                    .filter((plan): plan is PaymentPlan => plan !== null) || [];

            // Regional pricing lives on the option; stitch it onto every plan type in one place.
            const regionalByOptionId = new Map(
                (response ?? []).map((o) => [
                    o.id,
                    {
                        regionalPricingEnabled: o.regional_pricing_enabled ?? false,
                        regionalPricingCurrencies: o.regional_pricing_currencies ?? [],
                    },
                ])
            );
            setPaymentPlans(
                transformedPlans.map((plan) => ({
                    ...plan,
                    ...(regionalByOptionId.get(plan.id) ?? {}),
                    id: plan.id || '',
                    isDefault: !!plan.isDefault,
                    config: plan.config || {},
                    tag: plan.tag as PaymentPlanTag,
                    type: plan.type as PaymentPlanType,
                    name: plan.name || '',
                    currency: plan.currency || '',
                }))
            );

            if (transformedPlans.length === 0) {
                toast.info(t('toasts.noPaymentOptions'));
            }
        } catch (error) {
            console.error('Error loading payment options:', error);
            toast.error(t('toasts.loadFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadPaymentOptions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);


    const operationLabels: Record<string, string> = {
        'set default plan': t('operations.setDefaultPlan'),
        'edit plan': t('operations.editPlan'),
        'save payment plan': t('operations.savePaymentPlan'),
        'preview plan': t('operations.previewPlan'),
    };

    const handleError = (error: unknown, operation: string) => {
        console.error(`Error in ${operation}:`, error);
        toast.error(t('errors.generic', { operation: operationLabels[operation] || operation }));
    };

    const handleSetDefaultPlan = async (planId: string) => {
        try {
            // Find the plan and get its paymentOptionId (assuming plan.id is paymentOptionId)
            const paymentOptionId = planId;
            await makeDefaultPaymentOption({
                source: 'INSTITUTE',
                sourceId: instituteId ?? '',
                paymentOptionId,
            });
            await loadPaymentOptions(); // Refresh the list from the API
            toast.success(t('toasts.defaultUpdated'));
        } catch (error) {
            handleError(error, 'set default plan');
        }
    };

    const handleDeletePlan = (planId: string) => {
        const planToDelete = paymentPlans.find((plan) => plan.id === planId);
        if (planToDelete) {
            setPlanToDelete(planToDelete);
            setShowDeleteDialog(true);
        }
    };

    const handleDeleteConfirmed = () => {
        if (planToDelete?.id) {
            setPaymentPlans((plans) => plans.filter((plan) => plan.id !== planToDelete.id));
        }
        setShowDeleteDialog(false);
        setPlanToDelete(null);
    };

    const handleEditPlan = (plan: PaymentPlan) => {
        try {
            // Clear any previous editing state and set the new plan to edit
            setEditingPlan(plan);
            // Option-level toggles live outside the plan object, so seed them from the
            // plan being opened — otherwise reopening an option shows them off and the
            // next save turns the feature off for everyone on it.
            setRequireApproval(plan.requireApproval || false);
            setPlanChangeAllowed(plan.planChangeAllowed || false);
            setRegionalPricingEnabled(plan.regionalPricingEnabled || false);
            setRegionalPricingCurrencies(plan.regionalPricingCurrencies || []);
            setShowPaymentPlanCreator(true);
        } catch (error) {
            handleError(error, 'edit plan');
        }
    };

    const resetRegionalPricing = () => {
        setRegionalPricingEnabled(false);
        setRegionalPricingCurrencies([]);
    };

    const handleClosePaymentPlanCreator = () => {
        setShowPaymentPlanCreator(false);
        setEditingPlan(null);
        setRequireApproval(false);
        setPlanChangeAllowed(false);
        resetRegionalPricing();
    };

    // Helper function to calculate discounted prices for intervals
    const calculateDiscountedIntervals = (plan: PaymentPlan) => {
        if (
            plan.type !== PaymentPlans.SUBSCRIPTION ||
            !plan.config?.subscription?.customIntervals
        ) {
            return plan.config?.subscription?.customIntervals || [];
        }

        const planDiscounts = plan.config?.planDiscounts || {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return plan.config.subscription.customIntervals.map((interval: any, idx: number) => {
            const originalPrice = parseFloat(String(interval.price || '0'));
            let discountedPrice = originalPrice;
            const discount = planDiscounts[`interval_${idx}`];

            if (discount && discount.type !== 'none' && discount.amount) {
                if (discount.type === 'percentage') {
                    discountedPrice = originalPrice * (1 - parseFloat(discount.amount) / 100);
                } else if (discount.type === 'fixed') {
                    discountedPrice = originalPrice - parseFloat(discount.amount);
                }
                if (discountedPrice < 0) discountedPrice = 0;
            }

            return {
                ...interval,
                price: discountedPrice, // Use discounted price instead of original
            };
        });
    };

    const handleSavePaymentPlan = async (plan: PaymentPlan) => {
        setIsSaving(true);
        try {
            // CPO plans use a separate API
            if (plan.type === PaymentPlans.CPO) {
                const cpoForm = plan.config?.cpoForm;
                if (!cpoForm) throw new Error('Missing CPO form data');
                const payload = buildCreateCPOPayload(cpoForm, batches);
                await createCPOMutation.mutateAsync(payload);
                toast.success(t('toasts.feePlanCreated'));
                setEditingPlan(null);
                setShowPaymentPlanCreator(false);
                setRequireApproval(false);
                setPlanChangeAllowed(false);
                resetRegionalPricing();
                return;
            }

            // A ONE_TIME option has exactly one plan, so there is no per-interval
            // checkbox for it — the option toggle IS the plan's flag. Stamped here rather
            // than in the creator and the editor separately, so both paths agree.
            const planForApi: PaymentPlan = {
                ...plan,
                planChangeAllowed,
                config: { ...plan.config, planChangeAllowed },
            };
            const apiPlans = transformLocalPlanToApiFormatArray(planForApi);
            const discountedIntervals = calculateDiscountedIntervals(plan);

            const paymentOptionRequest = {
                id: editingPlan?.id || undefined,
                name: plan.name,
                status: 'ACTIVE',
                source: 'INSTITUTE',
                source_id: instituteId ?? '',
                type: plan.type.toUpperCase(),
                require_approval: requireApproval,
                // Master switch. The per-plan checkboxes only take effect while this is on,
                // so it rides alongside require_approval on the option itself.
                plan_change_allowed: planChangeAllowed,
                // Only paid one-time / subscription options can price by region; for any other
                // type the fields are omitted, which the backend reads as "leave as is".
                ...(plan.type === PaymentPlans.SUBSCRIPTION || plan.type === PaymentPlans.UPFRONT
                    ? {
                          regional_pricing_enabled: regionalPricingEnabled,
                          regional_pricing_currencies: regionalPricingEnabled
                              ? regionalPricingCurrencies
                              : editingPlan?.regionalPricingCurrencies ?? [],
                      }
                    : {}),
                payment_plans: apiPlans,
                payment_option_metadata_json: JSON.stringify({
                    currency: plan.currency,
                    features: plan.features || [],
                    unit: plan.config?.subscription?.customIntervals?.[0]?.unit || 'months',
                    config:
                        plan.type === PaymentPlans.SUBSCRIPTION
                            ? {
                                  ...plan.config,
                                  subscription: {
                                      ...plan.config?.subscription,
                                      customIntervals: discountedIntervals,
                                  },
                              }
                            : plan.config,
                    subscriptionData:
                        plan.type === PaymentPlans.SUBSCRIPTION
                            ? {
                                  customIntervals: discountedIntervals,
                                  planDiscounts: plan.config?.planDiscounts || {},
                              }
                            : undefined,
                    upfrontData:
                        plan.type === PaymentPlans.UPFRONT
                            ? {
                                  fullPrice: plan.config?.upfront?.fullPrice,
                                  planDiscounts: plan.config?.planDiscounts || {},
                              }
                            : undefined,
                    donationData:
                        plan.type === PaymentPlans.DONATION
                            ? {
                                  suggestedAmounts: plan.config?.donation?.suggestedAmounts,
                                  minimumAmount: plan.config?.donation?.minimumAmount,
                                  allowCustomAmount: plan.config?.donation?.allowCustomAmount,
                              }
                            : undefined,
                    freeData:
                        plan.type === PaymentPlans.FREE
                            ? {
                                  // plan.validityDays, not config.free.validityDays: the
                                  // creator/editor already resolved "unlimited" to undefined
                                  // there. Reading the raw config value would persist a stale
                                  // number after switching Limited -> Unlimited, leaving this
                                  // metadata disagreeing with the null validity_in_days that
                                  // is actually saved.
                                  validityDays: plan.validityDays,
                              }
                            : undefined,
                }),
            };

            const savedPaymentOption = await savePaymentOption(paymentOptionRequest);

            const regionalEligible =
                plan.type === PaymentPlans.SUBSCRIPTION || plan.type === PaymentPlans.UPFRONT;
            const regionalFields = regionalEligible
                ? { regionalPricingEnabled, regionalPricingCurrencies }
                : {};

            if (editingPlan) {
                // Update existing plan in the list
                setPaymentPlans((plans) =>
                    plans.map((p) => (p.id === editingPlan.id ? { ...plan, ...regionalFields } : p))
                );
                toast.success(t('toasts.planUpdated'));
            } else {
                // Add new plan to the list
                const savedPlan = savedPaymentOption?.payment_plans?.[0];
                if (savedPlan) {
                    // The plan row carries no type or metadata of its own — both live on
                    // the option (loadPaymentOptions stitches them the same way). Without
                    // them the transform throws on `type.toUpperCase()` and a successful
                    // save surfaces as an error toast.
                    const transformedPlan = transformApiPlanToLocalFormat({
                        ...savedPlan,
                        type: savedPaymentOption.type,
                        payment_option_metadata_json:
                            savedPaymentOption.payment_option_metadata_json,
                    });
                    setPaymentPlans((plans) => [
                        ...plans,
                        {
                            ...transformedPlan,
                            // Option id, not plan id — every list action keys on it.
                            id: savedPaymentOption.id,
                            name: savedPaymentOption.name,
                            tag:
                                transformedPlan.type === PaymentPlans.FREE
                                    ? 'free'
                                    : transformedPlan.type === PaymentPlans.DONATION
                                      ? 'donation'
                                      : 'default',
                        } as PaymentPlan,
                    ]);
                } else {
                    setPaymentPlans((plans) => [...plans, plan]);
                }
                toast.success(t('toasts.planCreated'));
                // Refresh the list from the API after creating a new plan
                await loadPaymentOptions();
            }

            // Regional pricing on: open its panel straight away, so the admin sees the
            // automatic prices just created and can add fixed prices for specific countries.
            const openRegionalPanel =
                regionalEligible && regionalPricingEnabled && !!savedPaymentOption?.id;

            setEditingPlan(null);
            setShowPaymentPlanCreator(false);
            setRequireApproval(false);
            setPlanChangeAllowed(false);
            resetRegionalPricing();
            // Clear features after successfully creating/updating a plan
            setFeaturesGlobal([]);

            if (openRegionalPanel) {
                setRegionalPricingPlan({
                    ...plan,
                    id: savedPaymentOption.id,
                    name: savedPaymentOption.name || plan.name,
                } as PaymentPlan);
            }
        } catch (error) {
            handleError(error, 'save payment plan');
        } finally {
            setIsSaving(false);
        }
    };

    const handlePreviewPlan = (plan: PaymentPlan) => {
        try {
            setPreviewingPlan(plan);
            setShowPlanPreview(true);
            setTimeout(() => {
                if (previewDialogRef.current) {
                    previewDialogRef.current.scrollTo({
                        top: 0,
                        behavior: 'smooth',
                    });
                }
            }, 100);
        } catch (error) {
            handleError(error, 'preview plan');
        }
    };

    // Filtering: use only type, never tag
    const getFreePlans = () =>
        paymentPlans.filter(
            (plan) => plan.type === PaymentPlans.FREE || plan.type === PaymentPlans.DONATION
        );
    const getPaidPlans = () =>
        paymentPlans.filter(
            (plan) =>
                plan.type === PaymentPlans.SUBSCRIPTION ||
                plan.type === PaymentPlans.UPFRONT ||
                plan.type === PaymentPlans.CPO
        );

    const renderPlanPreview = () => {
        if (!previewingPlan) return null;

        if (previewingPlan.type === PaymentPlans.SUBSCRIPTION) {
            return (
                <SubscriptionPlanPreview
                    currency={previewingPlan.currency}
                    subscriptionPlans={transformIntervalsToSubscriptionPlans(
                        previewingPlan.config?.subscription?.customIntervals
                    )}
                    features={getAllFeatures(previewingPlan)}
                    discountCoupons={createDiscountCoupons(previewingPlan)}
                />
            );
        }

        if (previewingPlan.type === PaymentPlans.DONATION) {
            return (
                <DonationPlanPreview
                    currency={previewingPlan.currency}
                    suggestedAmounts={previewingPlan.config?.donation?.suggestedAmounts || ''}
                    minimumAmount={previewingPlan.config?.donation?.minimumAmount || '0'}
                    allowCustomAmount={previewingPlan.config?.donation?.allowCustomAmount !== false}
                    onSelectAmount={(amount) => console.log('Selected donation amount:', amount)}
                />
            );
        }

        return null;
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <CreditCard className="size-5" />
                            {t('cardTitle')}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                            <MyButton
                                onClick={() => setShowPaymentPlanCreator(true)}
                                className="flex items-center gap-2"
                                disabled={isLoading || isSaving}
                            >
                                <Plus className="size-4" />
                                {t('addPaymentPlan')}
                            </MyButton>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>{t('defaultCurrency')}</Label>
                            <Select value={currency} onValueChange={(value) => setCurrency(value)}>
                                <SelectTrigger>
                                    <SelectValue placeholder={t('selectCurrencyPlaceholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {currencyOptions.map((currency) => (
                                        <SelectItem key={currency.code} value={currency.code}>
                                            {currency.symbol} {currency.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <Separator />

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-lg font-medium text-gray-900">
                                <Globe className="size-5 text-green-600" />
                                {t('sections.freeOptions')}
                            </h3>
                            <Badge variant="outline" className="border-green-200 text-green-600">
                                {t('planCount', { count: getFreePlans().length })}
                            </Badge>
                        </div>
                        {isLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <CircleNotch className="size-8 animate-spin text-primary-400" />
                            </div>
                        ) : (
                            <PaymentPlanList
                                plans={getFreePlans()}
                                onEdit={handleEditPlan}
                                onDelete={handleDeletePlan}
                                onSetDefault={handleSetDefaultPlan}
                                onPreview={handlePreviewPlan}
                            />
                        )}
                    </div>

                    <Separator />

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-lg font-medium text-gray-900">
                                <CreditCard className="size-5 text-blue-600" />
                                {t('sections.paidOptions')}
                            </h3>
                            <Badge variant="outline" className="border-blue-200 text-blue-600">
                                {t('planCount', { count: getPaidPlans().length })}
                            </Badge>
                        </div>
                        {isLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <CircleNotch className="size-8 animate-spin text-primary-400" />
                            </div>
                        ) : (
                            <PaymentPlanList
                                plans={getPaidPlans()}
                                onEdit={handleEditPlan}
                                onDelete={handleDeletePlan}
                                onSetDefault={handleSetDefaultPlan}
                                onPreview={handlePreviewPlan}
                                onRegionalPricing={setRegionalPricingPlan}
                            />
                        )}
                    </div>
                </CardContent>
            </Card>

            <div className="mt-6">
                <PackageSessionRenewalSettings />
            </div>

            <div className="mt-6">
                <OfflinePaymentModesSettings />
            </div>

            <PaymentPlanCreator
                key={editingPlan?.id}
                isOpen={showPaymentPlanCreator}
                onClose={handleClosePaymentPlanCreator}
                onSave={handleSavePaymentPlan}
                editingPlan={editingPlan}
                featuresGlobal={featuresGlobal}
                setFeaturesGlobal={setFeaturesGlobal}
                defaultCurrency={currency}
                isSaving={isSaving}
                existingFreePlans={getFreePlans().map((plan) => ({
                    id: plan.id,
                    requireApproval: plan.requireApproval || false,
                }))}
                requireApproval={requireApproval}
                setRequireApproval={setRequireApproval}
                planChangeAllowed={planChangeAllowed}
                setPlanChangeAllowed={setPlanChangeAllowed}
                regionalPricingEnabled={regionalPricingEnabled}
                setRegionalPricingEnabled={setRegionalPricingEnabled}
                regionalPricingCurrencies={regionalPricingCurrencies}
                setRegionalPricingCurrencies={setRegionalPricingCurrencies}
            />

            <Dialog open={showPlanPreview} onOpenChange={setShowPlanPreview}>
                <DialogContent
                    ref={previewDialogRef}
                    className="max-h-dialog-tall min-w-fit overflow-y-auto"
                >
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Eye className="size-5" />
                            {t('planPreviewTitle', { name: previewingPlan?.name })}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="mt-4">{renderPlanPreview()}</div>
                </DialogContent>
            </Dialog>

            <DeletePaymentOptionDialog
                isOpen={showDeleteDialog}
                onClose={() => {
                    setShowDeleteDialog(false);
                    setPlanToDelete(null);
                }}
                paymentOption={planToDelete}
                allPaymentOptions={paymentPlans}
                onDeleted={handleDeleteConfirmed}
            />

            {regionalPricingPlan && (
                <RegionalPricingDialog
                    open={!!regionalPricingPlan}
                    onOpenChange={(open) => {
                        if (!open) {
                            setRegionalPricingPlan(null);
                            // The dialog may have switched regional pricing on or off; reload so
                            // the next edit of this option starts from what is really saved.
                            void loadPaymentOptions();
                        }
                    }}
                    paymentOptionId={regionalPricingPlan.id}
                    paymentOptionName={regionalPricingPlan.name}
                />
            )}
        </>
    );
};

export default PaymentSettings;
