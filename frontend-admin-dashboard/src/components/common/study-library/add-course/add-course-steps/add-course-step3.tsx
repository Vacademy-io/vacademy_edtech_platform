import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CaretDown, CaretRight, CreditCard } from '@phosphor-icons/react';

import { Form } from '@/components/ui/form';
import { Card } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DashboardLoader } from '@/components/core/dashboard-loader';

import {
    inviteLinkSchema,
    type InviteLinkFormValues,
} from '@/routes/manage-students/invite/-components/create-invite/GenerateInviteLinkSchema';
import { PaymentPlansDialog } from '@/routes/manage-students/invite/-components/create-invite/PaymentPlansDialog';
import AddPaymentPlanDialog from '@/routes/manage-students/invite/-components/create-invite/AddPaymentPlanDialog';
import PaymentPlanCard from '@/routes/manage-students/invite/-components/create-invite/-components/PaymentPlanCard';
import InviteNameCard from '@/routes/manage-students/invite/-components/create-invite/-components/InviteNameCard';
import LearnerAccessDurationCard from '@/routes/manage-students/invite/-components/create-invite/-components/LearnerAccessDurationCard';
import InviteAvailabilityCard from '@/routes/manage-students/invite/-components/create-invite/-components/InviteAvailabilityCard';
import CustomInviteFormCard from '@/routes/manage-students/invite/-components/create-invite/-components/CustomInviteFormCard';
import { useInviteCustomFieldHandlers } from '@/routes/manage-students/invite/-components/create-invite/-hooks/useInviteCustomFieldHandlers';
import { handleGetPaymentDetails } from '@/routes/manage-students/invite/-components/create-invite/-services/get-payments';
import {
    getDefaultPlanFromPaymentsData,
    splitPlansByType,
    type PaymentOption,
} from '@/routes/manage-students/invite/-components/create-invite/-utils/helper';
import {
    getInviteListCustomFields,
    getInviteListCustomFieldsAsync,
} from '@/routes/manage-students/invite/-utils/getInviteListCustomFields';

import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { buildInviteDefaults } from '../-utils/course-invite-payload';
import type { Step1Data } from './add-course-step1';

/**
 * A crash inside the plan picker must not take the whole wizard down with it —
 * splitPlansByType and friends JSON.parse payment_option_metadata_json unguarded, so one
 * malformed payment option would otherwise blank the dialog. The step stays usable (and
 * skippable) without the picker.
 */
class PlanPickerErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { hasError: boolean }
> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: unknown) {
        console.error('[add-course-step3] payment plan picker failed to render:', error);
    }

    render() {
        if (this.state.hasError) {
            return (
                <p className="text-xs text-danger-600">
                    Payment plans could not be loaded. You can skip this step and set the plan up
                    from the Invite Links tab.
                </p>
            );
        }
        return this.props.children;
    }
}

export interface AddCourseStep3Props {
    /** Step-1 values, used to prefill the invite's course-preview fields. */
    step1Data: Partial<Step1Data>;
    /** How many invite links this will produce — one per batch configured in step 2. */
    batchCount: number;
    onBack: () => void;
    onSubmit: (values: InviteLinkFormValues, customFieldsDirty: boolean) => void;
    onSkip: () => void;
    isLoading?: boolean;
    /** Per-batch progress while the invites are being written. */
    progress?: { done: number; total: number } | null;
}

/**
 * Step 3 of course creation: the payment plan, which in this product is the invite link.
 *
 * Deliberately a subset of the full invite form (that stays on the Invite Links tab): the
 * plan, the link name, learner access days, and — under Advanced — the enrolment form
 * fields and the availability window. Everything else is defaulted to what the backend
 * would have written for the auto-created default invite.
 *
 * The form is typed against the FULL inviteLinkSchema rather than a bespoke subset. That is
 * what lets convertInviteData / handleEnrollInvite be reused verbatim with no adapter, and
 * the reused cards are already typed against it.
 */
export const AddCourseStep3 = ({
    step1Data,
    batchCount,
    onBack,
    onSubmit,
    onSkip,
    isLoading = false,
    progress = null,
}: AddCourseStep3Props) => {
    // Same namespaces GenerateInviteLinkDialog loads: the reused cards and the custom-field
    // handlers read their labels from them.
    const { t } = useTranslation([
        'manageStudentsGenerateInviteLinkDialog',
        'manageStudentsGenerateInviteLinkSchema',
        'manageStudentsGetInviteListCustomFields',
    ]);

    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);

    const defaultInviteName = useMemo(() => {
        const courseName = (step1Data.course ?? '').trim();
        return courseName ? `${courseName} Enrolment` : '';
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const form = useForm<InviteLinkFormValues>({
        resolver: zodResolver(inviteLinkSchema),
        defaultValues: {
            // Mirrors GenerateInviteLinkDialog's defaults, so the payload this step produces
            // is the same shape the invite page produces.
            name: defaultInviteName,
            blendHeaderWithBackground: false,
            requireApproval: false,
            custom_fields: getInviteListCustomFields(),
            uploadingStates: {
                coursePreview: false,
                courseBanner: false,
                courseMedia: false,
            },
            youtubeUrl: '',
            youtubeError: '',
            showYoutubeInput: false,
            showMediaMenu: false,
            freePlans: [],
            paidPlans: [],
            showPlansDialog: false,
            selectedPlan: {},
            showAddPlanDialog: false,
            showDiscountDialog: false,
            discounts: [],
            showAddDiscountDialog: false,
            selectedDiscountId: 'none',
            referralPrograms: [],
            selectedReferralId: 'r1',
            showReferralDialog: false,
            showAddReferralDialog: false,
            planReferralMappings: {},
            selectedPlanForReferral: '',
            showPlanReferralDialog: false,
            availabilityStartDate: '',
            availabilityEndDate: '',
            unavailableMessage: '',
            accessDurationType: 'define',
            accessDurationDays: '',
            inviteeEmail: '',
            inviteeEmails: [],
            teamNotificationEmails: [],
            selectedOptionValue: 'textfield',
            textFieldValue: '',
            dropdownOptions: [],
            isDialogOpen: false,
            postformfillConfiguration: {
                redirectPath: '',
                showLoginButton: true,
                content: '',
                collectBillingContactDetails: false,
            },
            ...buildInviteDefaults(step1Data),
        },
    });

    const customFieldHandlers = useInviteCustomFieldHandlers(form, t);

    // Non-suspense on purpose: the step renders a skeleton instead of blanking, and this
    // warms the ['GET_PAYMENT_DETAILS'] cache so PaymentPlansDialog's useSuspenseQuery
    // resolves without a visible suspend when the picker opens.
    const { data: rawPaymentsData, isLoading: plansLoading } = useQuery(handleGetPaymentDetails());
    const paymentsData = rawPaymentsData as PaymentOption[] | undefined;

    const [plansSeeded, setPlansSeeded] = useState(false);

    // Seed the picker's lists and preselect the institute default, once. PaymentPlansDialog
    // would do this itself, but only after it has mounted — the summary card has to show
    // the preselected plan before the admin ever opens the picker.
    useEffect(() => {
        if (!paymentsData || plansSeeded) return;
        try {
            const { freePlans, paidPlans } = splitPlansByType(paymentsData);
            const current = form.getValues('selectedPlan');
            form.reset({
                ...form.getValues(),
                freePlans,
                paidPlans,
                selectedPlan: current?.id ? current : getDefaultPlanFromPaymentsData(paymentsData),
            });
        } catch (error) {
            // A malformed payment_option_metadata_json on any option throws here. The step
            // still works — the admin picks a plan, or skips.
            console.error('[add-course-step3] could not read payment options:', error);
        }
        setPlansSeeded(true);
        // `form` is a stable RHF instance; listing it would re-run this on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paymentsData, plansSeeded]);

    // Fresh DEFAULT custom fields from the backend, same as the invite dialog does on open,
    // so a field added in Settings today shows up here today.
    useEffect(() => {
        let cancelled = false;
        getInviteListCustomFieldsAsync(t).then((fields) => {
            if (cancelled || !fields || fields.length === 0) return;
            form.reset({ ...form.getValues(), custom_fields: fields });
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const selectedPlan = form.watch('selectedPlan');
    const hasPlan = !!selectedPlan?.id;

    const [advancedOpen, setAdvancedOpen] = useState(false);

    const submitLabel = (() => {
        if (!isLoading) return `Create ${courseTerm}`;
        if (progress && progress.total > 3) {
            return `Setting up ${progress.done} of ${progress.total}...`;
        }
        return 'Creating...';
    })();

    return (
        <>
            <Form {...form}>
                <form
                    // flex-1 + min-h-0 rather than subtracting the header height: the
                    // wizard shell is already a flex column, so this fills whatever is
                    // left without hardcoding the header's size.
                    className="flex min-h-0 flex-1 flex-col"
                    onSubmit={(e) => e.preventDefault()}
                >
                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto">
                        <div className="space-y-6 p-8">
                            <div>
                                <h1 className="mb-1">Step 3: Payment &amp; Enrolment</h1>
                                <p className="text-sm text-neutral-500">
                                    Choose what learners pay to join this {courseTerm.toLowerCase()}
                                    . This creates the invite link they enrol through — you can
                                    change it any time from the Invite Links tab.
                                </p>
                            </div>

                            {/* Payment plan */}
                            {plansLoading && !plansSeeded ? (
                                <DashboardLoader height="120px" />
                            ) : (
                                <PlanPickerErrorBoundary>
                                    {hasPlan ? (
                                        <PaymentPlanCard form={form} />
                                    ) : (
                                        <Card className="flex flex-col items-start gap-3 p-6">
                                            <div className="flex items-center gap-2 font-semibold">
                                                <CreditCard className="size-5 text-neutral-500" />
                                                No payment plan selected
                                            </div>
                                            <p className="text-sm text-neutral-500">
                                                Pick an existing plan or create a new one. Free is a
                                                plan too.
                                            </p>
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="medium"
                                                onClick={() =>
                                                    form.setValue('showPlansDialog', true)
                                                }
                                            >
                                                Choose a plan
                                            </MyButton>
                                        </Card>
                                    )}
                                </PlanPickerErrorBoundary>
                            )}

                            <InviteNameCard form={form} />

                            <LearnerAccessDurationCard form={form} />

                            {/* Advanced: enrolment form fields + availability window */}
                            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                                <CollapsibleTrigger asChild>
                                    <button
                                        type="button"
                                        className="flex w-full items-center gap-2 border-t pt-4 text-left text-sm font-medium text-primary-500"
                                    >
                                        {advancedOpen ? (
                                            <CaretDown className="size-4" />
                                        ) : (
                                            <CaretRight className="size-4" />
                                        )}
                                        Advanced
                                        <span className="font-normal text-neutral-400">
                                            enrolment form fields, availability window
                                        </span>
                                    </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="mt-4 space-y-6">
                                    <CustomInviteFormCard
                                        form={form}
                                        updateFieldOrders={customFieldHandlers.updateFieldOrders}
                                        handleDeleteOpenField={
                                            customFieldHandlers.handleDeleteOpenField
                                        }
                                        toggleIsRequired={customFieldHandlers.toggleIsRequired}
                                        handleAddGender={customFieldHandlers.handleAddGender}
                                        handleAddOpenFieldValues={
                                            customFieldHandlers.handleAddOpenFieldValues
                                        }
                                        handleValueChange={customFieldHandlers.handleValueChange}
                                        handleEditClick={customFieldHandlers.handleEditClick}
                                        handleDeleteOptionField={
                                            customFieldHandlers.handleDeleteOptionField
                                        }
                                        handleAddDropdownOptions={
                                            customFieldHandlers.handleAddDropdownOptions
                                        }
                                        handleEditFieldAt={customFieldHandlers.handleEditFieldAt}
                                        handleCloseDialog={customFieldHandlers.handleCloseDialog}
                                    />
                                    <InviteAvailabilityCard form={form} />
                                </CollapsibleContent>
                            </Collapsible>

                            {batchCount > 0 && (
                                <p className="text-xs text-neutral-500">
                                    {batchCount === 1
                                        ? 'One invite link will be created for this batch.'
                                        : `One invite link will be created for each of the ${batchCount} batches in this ${courseTerm.toLowerCase()}.`}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Fixed Footer */}
                    <div className="sticky bottom-0 mt-auto border-t bg-white px-8 py-4 shadow-sm">
                        <div className="flex items-center justify-between gap-4">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="large"
                                layoutVariant="default"
                                onClick={onBack}
                                disable={isLoading}
                            >
                                Back
                            </MyButton>
                            <div className="flex items-center gap-3">
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="large"
                                    layoutVariant="default"
                                    onClick={onSkip}
                                    disable={isLoading}
                                >
                                    Skip for now
                                </MyButton>
                                <MyButton
                                    type="button"
                                    buttonType="primary"
                                    scale="large"
                                    layoutVariant="default"
                                    className="px-8"
                                    disable={isLoading || !hasPlan}
                                    onClick={() =>
                                        onSubmit(form.getValues(), customFieldHandlers.isDirty())
                                    }
                                >
                                    {isLoading ? (
                                        <span className="flex items-center gap-2">
                                            <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                            {submitLabel}
                                        </span>
                                    ) : (
                                        submitLabel
                                    )}
                                </MyButton>
                            </div>
                        </div>
                        {!hasPlan && !isLoading && (
                            <p className="mt-2 text-right text-xs text-neutral-500">
                                Choose a payment plan, or skip and set it up later.
                            </p>
                        )}
                    </div>
                </form>
            </Form>

            {/*
                Dialogs live outside the form, as they do in GenerateInviteLinkDialog.
                PaymentPlansDialog uses useSuspenseQuery, so it needs its own Suspense
                boundary — without one it suspends up to the app root and blanks the page.
                It is mounted unconditionally (it renders nothing while closed) so its
                list-seeding effect runs once rather than on every open.
            */}
            <PlanPickerErrorBoundary>
                <Suspense fallback={null}>
                    <PaymentPlansDialog form={form} preserveSelection />
                </Suspense>
            </PlanPickerErrorBoundary>
            <AddPaymentPlanDialog form={form} />
        </>
    );
};

export default AddCourseStep3;
