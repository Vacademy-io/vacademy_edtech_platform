import React, { Suspense, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowDown, ArrowRight, CurrencyCircleDollar, WarningCircle } from '@phosphor-icons/react';
import { AxiosError } from 'axios';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import type {
    InviteLinkDataInterface,
    InvitePaymentSummary,
} from '@/schemas/study-library/invite-links-schema';
import type { InviteLinkFormValues } from '@/routes/manage-students/invite/-components/create-invite/GenerateInviteLinkSchema';
import { PaymentPlansDialog } from '@/routes/manage-students/invite/-components/create-invite/PaymentPlansDialog';
import AddPaymentPlanDialog from '@/routes/manage-students/invite/-components/create-invite/AddPaymentPlanDialog';
import { handleGetPaymentDetails } from '@/routes/manage-students/invite/-components/create-invite/-services/get-payments';
import {
    getMatchingPaymentAndReferralPlanForAPIs,
    type PaymentOption,
} from '@/routes/manage-students/invite/-components/create-invite/-utils/helper';
import {
    updateInvitePaymentOption,
    type UpdatePaymentOptionRequest,
} from '@/services/payment-options';
import { InvitePaymentSummaryLine, findPaymentSummary } from './invite-payment-summary';

/**
 * The plan picker JSON.parses option metadata unguarded, so one malformed
 * option would otherwise take the whole invite dialog down with it.
 */
class PlanPickerErrorBoundary extends React.Component<
    { children: React.ReactNode; fallback: React.ReactNode },
    { hasError: boolean }
> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: unknown) {
        console.error('[configure-payment] payment plan picker failed to render:', error);
    }

    render() {
        return this.state.hasError ? this.props.fallback : this.props.children;
    }
}

/** Currency a payment option charges in; null for options without priced plans (Free). */
const optionCurrency = (option: PaymentOption | undefined): string | null =>
    option?.payment_plans?.find((plan) => plan?.currency)?.currency ?? null;

/** A raw payment option as the summary the card line renders (active plans only, like the backend's). */
const summaryFromOption = (
    option: PaymentOption,
    packageSessionId: string
): InvitePaymentSummary => {
    const plans = (option.payment_plans ?? []).filter(
        (plan) => plan && (!plan.status || plan.status === 'ACTIVE')
    );
    const prices = plans.map((plan) => plan.actual_price).filter((p) => Number.isFinite(p));
    return {
        package_session_id: packageSessionId,
        mapping_id: '',
        payment_option_id: option.id,
        payment_option_name: option.name,
        type: option.type ? option.type.toUpperCase() : null,
        require_approval: !!option.require_approval,
        plan_count: plans.length,
        min_price: prices.length ? Math.min(...prices) : null,
        max_price: prices.length ? Math.max(...prices) : null,
        currency: plans.find((plan) => plan.currency)?.currency ?? null,
    };
};

interface ConfigurePaymentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    invite: InviteLinkDataInterface;
    /** The batch whose payment option is being changed. */
    packageSessionId: string;
}

/**
 * "Configure payment plan" from an invite card's ⋮ menu: swap the payment
 * option one invite link charges for one batch, without opening the full
 * invite editor.
 *
 * Saves through PUT /enroll-invite-payment-option, which replaces just that
 * batch's mapping and leaves the rest of the invite untouched. That endpoint
 * does not touch the invite's currency, so a plan in a different currency is
 * refused here and left to the full Edit, which updates both together.
 */
export const ConfigurePaymentDialog = ({
    open,
    onOpenChange,
    invite,
    packageSessionId,
}: ConfigurePaymentDialogProps) => {
    const { t } = useTranslation('studyLibraryCourseDetailsInviteDetailsComponent');
    const queryClient = useQueryClient();
    const current = findPaymentSummary(invite, packageSessionId);

    // The batch's current option, as the picker's selection. Only `id` matters
    // to the picker (it highlights by id); the rest is filled in once picked.
    const currentSelection = (): InviteLinkFormValues['selectedPlan'] =>
        current
            ? {
                  id: current.payment_option_id,
                  name: current.payment_option_name ?? '',
                  price: '',
              }
            : undefined;

    // The picker is bound to the invite form's field names; it only ever touches
    // these five, so a form holding just them is enough.
    const form = useForm<InviteLinkFormValues>({
        defaultValues: {
            freePlans: [],
            paidPlans: [],
            showPlansDialog: false,
            showAddPlanDialog: false,
            selectedPlan: currentSelection(),
        },
    });

    // Reopening starts from the batch's current option, not the last pick.
    useEffect(() => {
        if (open) form.setValue('selectedPlan', currentSelection());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Same query (and cache) the picker suspends on; the raw options are what the
    // save payload is built from.
    const { data: paymentOptions } = useQuery({ ...handleGetPaymentDetails(), enabled: open });
    const options = (paymentOptions ?? []) as PaymentOption[];

    const selectedPlan = form.watch('selectedPlan');
    const selectedId = selectedPlan?.id || '';
    const selectedOption = options.find((option) => option.id === selectedId);
    const isChanged = !!selectedId && selectedId !== current?.payment_option_id;

    // The picked option in the card's own summary shape, so "new" reads exactly
    // like "current" (type badge, name, price or range).
    const selectedSummary: InvitePaymentSummary | null = selectedOption
        ? summaryFromOption(selectedOption, packageSessionId)
        : null;

    const openPicker = () => form.setValue('showPlansDialog', true);

    const newCurrency = optionCurrency(selectedOption);
    const currencyMismatch =
        isChanged &&
        !!newCurrency &&
        !!invite.currency &&
        newCurrency.toUpperCase() !== invite.currency.toUpperCase();

    const saveMutation = useMutation({
        mutationFn: async () => {
            if (!current) throw new Error('No payment option mapping for this batch');
            const request: UpdatePaymentOptionRequest = {
                enroll_invite_id: invite.id,
                update_payment_options: [
                    {
                        old_package_session_payment_option_id: current.mapping_id,
                        new_package_session_payment_option: {
                            package_session_id: packageSessionId,
                            id: '',
                            // No referral programs are carried over: they were set
                            // per plan of the old option and do not apply to the new one.
                            payment_option: getMatchingPaymentAndReferralPlanForAPIs(
                                options,
                                selectedId,
                                [],
                                {}
                            ) as UpdatePaymentOptionRequest['update_payment_options'][number]['new_package_session_payment_option']['payment_option'],
                            enroll_invite_id: invite.id,
                            status: 'ACTIVE',
                        },
                    },
                ],
            };
            return updateInvitePaymentOption([request]);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['GET_INVITE_LINKS'] });
            queryClient.invalidateQueries({ queryKey: ['inviteList'] });
            toast.success(t('configurePayment.saved', { name: invite.name }));
            onOpenChange(false);
        },
        onError: (error: unknown) => {
            const message =
                error instanceof AxiosError
                    ? error.response?.data?.ex || t('configurePayment.saveFailed')
                    : t('configurePayment.saveFailed');
            toast.error(message);
        },
    });

    const pickerFallback = (
        <p className="flex items-center gap-1.5 text-caption text-danger-600">
            <WarningCircle className="size-4 shrink-0" />
            {t('configurePayment.pickerFailed')}
        </p>
    );

    return (
        <>
            <MyDialog
                open={open}
                onOpenChange={(next) => {
                    if (!saveMutation.isPending) onOpenChange(next);
                }}
                heading={t('configurePayment.heading')}
                // max-w, not w-: MyDialog always adds w-full, which beats a width
                // token and stretched this across the screen.
                dialogWidth="max-w-xl"
                footer={
                    <>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            onClick={() => onOpenChange(false)}
                            disabled={saveMutation.isPending}
                        >
                            {t('configurePayment.cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            onClick={() => saveMutation.mutate()}
                            disabled={
                                !current ||
                                !isChanged ||
                                !selectedOption ||
                                currencyMismatch ||
                                saveMutation.isPending
                            }
                        >
                            {saveMutation.isPending
                                ? t('configurePayment.saving')
                                : t('configurePayment.save')}
                        </MyButton>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    <p className="text-body text-neutral-600">
                        {t('configurePayment.description', { name: invite.name })}
                    </p>

                    {/* Current → new, read top to bottom. */}
                    <div className="flex flex-col gap-1.5">
                        <span className="text-caption font-semibold text-neutral-500">
                            {t('configurePayment.current')}
                        </span>
                        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                            {current ? (
                                <InvitePaymentSummaryLine
                                    summary={current}
                                    className="text-body text-neutral-700"
                                />
                            ) : (
                                <span className="text-body text-neutral-500">
                                    {t('configurePayment.noCurrent')}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-center text-neutral-400" aria-hidden="true">
                        <ArrowDown className="size-5" />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <span className="text-caption font-semibold text-neutral-500">
                            {t('configurePayment.new')}
                        </span>
                        {isChanged && selectedSummary ? (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 p-3">
                                <InvitePaymentSummaryLine
                                    summary={selectedSummary}
                                    className="text-body text-neutral-700"
                                />
                                <MyButton
                                    type="button"
                                    scale="small"
                                    buttonType="secondary"
                                    onClick={openPicker}
                                    disabled={saveMutation.isPending}
                                >
                                    {t('configurePayment.change')}
                                </MyButton>
                            </div>
                        ) : (
                            // Nothing picked yet: the one thing to do here, so it
                            // sits centred and prominent rather than off to a side.
                            <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-primary-200 px-4 py-6 text-center">
                                <CurrencyCircleDollar className="size-8 text-primary-400" />
                                <MyButton
                                    type="button"
                                    buttonType="primary"
                                    className="flex items-center gap-1.5"
                                    onClick={openPicker}
                                    disabled={!current || saveMutation.isPending}
                                >
                                    {t('configurePayment.chooseNew')}
                                    <ArrowRight className="size-4" />
                                </MyButton>
                                <p className="text-caption text-neutral-500">
                                    {t('configurePayment.chooseHint')}
                                </p>
                            </div>
                        )}
                    </div>

                    {currencyMismatch && (
                        <p className="flex items-start gap-1.5 rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-caption text-warning-700">
                            <WarningCircle className="mt-0.5 size-4 shrink-0" />
                            {t('configurePayment.currencyMismatch', {
                                planCurrency: newCurrency,
                                inviteCurrency: invite.currency,
                            })}
                        </p>
                    )}

                    <p className="text-caption text-neutral-500">
                        {t('configurePayment.referralNote')}
                    </p>
                </div>
            </MyDialog>

            {/* The picker and "add plan" dialogs open over this one. Mounted only
                while it is open so the option list is fetched on demand. */}
            {open && (
                <PlanPickerErrorBoundary fallback={pickerFallback}>
                    <Suspense fallback={null}>
                        <PaymentPlansDialog form={form} preserveSelection />
                    </Suspense>
                    <AddPaymentPlanDialog form={form} />
                </PlanPickerErrorBoundary>
            )}
        </>
    );
};

export default ConfigurePaymentDialog;
