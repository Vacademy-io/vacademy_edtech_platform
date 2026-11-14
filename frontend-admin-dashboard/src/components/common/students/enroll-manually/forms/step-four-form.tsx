/* eslint-disable */
import { FormStepHeading } from '../form-components/form-step-heading';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFormStore } from '@/stores/students/enroll-students-manually/enroll-manually-form-store';
import {
    StepFourData,
    stepFourSchema,
} from '@/schemas/student/student-list/schema-enroll-students-manually';
import { StudentTable } from '@/types/student-table-types';
import { useEffect, useRef, useState } from 'react';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getUserId } from '@/utils/userDetails';
import { formatPlanPrice } from '@/utils/finance-utils';
import { MyDropdown } from '../dropdownForPackageItems';
import { DropdownValueType } from '../dropdownTypesForPackageItems';
import { AdminDiscountField, EMPTY_ADMIN_DISCOUNT } from '@/components/common/payments/AdminDiscountField';
import { useCanApplyDiscounts } from '@/hooks/useCanApplyDiscounts';
import {
    getAdminDiscountValidationError,
    isDiscountablePlanType,
    type AdminDiscountPreview,
    type AdminDiscountRequest,
} from '@/services/admin-discounts';

interface PaymentPlan {
    id: string;
    name?: string;
    actual_price?: number;
    elevated_price?: number;
    currency?: string;
    description?: string;
    validity_in_days?: number;
}

export const StepFourForm = ({
    initialValues,
    submitFn,
}: {
    initialValues?: StudentTable;
    submitFn: (fn: () => void) => void;
}) => {
    const { stepTwoData, stepThreeData, stepFourData, setStepFourData, nextStep } = useFormStore();

    // Get payment plans from step 3 invite data
    const paymentPlans: PaymentPlan[] = stepThreeData?.invite?.payment_plans || [];
    // Admin discounts only apply to ONE_TIME / SUBSCRIPTION plans (never FREE/DONATION/CPO).
    const paymentOptionType = stepThreeData?.invite?.payment_option_type;
    const canApplyDiscounts = useCanApplyDiscounts();
    const canDiscount = isDiscountablePlanType(paymentOptionType) && canApplyDiscounts;
    const isSubscription = (paymentOptionType || '').toUpperCase() === 'SUBSCRIPTION';

    // File upload using useFileUpload hook
    const fileUpload = useFileUpload();
    const [uploadedFileId, setUploadedFileId] = useState<string>('');
    const [isFileUploading, setIsFileUploading] = useState(false);
    const userId = getUserId();

    const form = useForm<StepFourData>({
        resolver: zodResolver(stepFourSchema),
        defaultValues: stepFourData || {
            plan_id: '',
            amount: '',
            currency: '',
            file_id: '',
            transaction_id: '',
            admin_discount: EMPTY_ADMIN_DISCOUNT,
        },
        mode: 'onChange',
    });

    const watchedPlanId = form.watch('plan_id');
    const adminDiscount = (form.watch('admin_discount') as AdminDiscountRequest | undefined) ??
        EMPTY_ADMIN_DISCOUNT;
    const selectedPlan = paymentPlans.find((p) => p.id === watchedPlanId);
    const [discountError, setDiscountError] = useState<string | null>(null);

    // With a discount, the recorded manual payment defaults to the net amount; without one
    // it goes back to the plan's price.
    const handleDiscountPreview = (preview: AdminDiscountPreview | null) => {
        if (preview && adminDiscount.mode !== 'NONE') {
            form.setValue('amount', String(preview.net_amount));
        } else if (selectedPlan) {
            form.setValue('amount', String(selectedPlan.actual_price || 0));
        }
    };

    // Update form when stepFourData changes
    useEffect(() => {
        if (stepFourData) {
            form.reset(stepFourData);
        }
    }, [stepFourData]);

    // Update file_id in form when file is uploaded
    useEffect(() => {
        if (uploadedFileId) {
            form.setValue('file_id', uploadedFileId);
        }
    }, [uploadedFileId]);

    const handleFileUpload = async (file: File) => {
        try {
            setIsFileUploading(true);
            const fileId = await fileUpload.uploadFile({
                file,
                setIsUploading: setIsFileUploading,
                userId,
                source: 'payment_receipt',
                publicUrl: false,
            });
            if (fileId) {
                setUploadedFileId(fileId);
                form.setValue('file_id', fileId);
            }
        } catch (error) {
            console.error('File upload error:', error);
        } finally {
            setIsFileUploading(false);
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            // Validate file type
            const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
            if (!allowedTypes.includes(file.type)) {
                alert('Please upload only JPG, PNG, or PDF files');
                return;
            }
            // Validate file size (5MB)
            if (file.size > 5 * 1024 * 1024) {
                alert('File size must be less than 5MB');
                return;
            }
            handleFileUpload(file);
        }
    };

    const handleRemoveFile = () => {
        setUploadedFileId('');
        form.setValue('file_id', '');
    };

    const [discountServerError, setDiscountServerError] = useState<string | null>(null);

    const onSubmit = (values: StepFourData) => {
        const discountErr = canDiscount
            ? getAdminDiscountValidationError(
                  values.admin_discount as AdminDiscountRequest | undefined,
                  selectedPlan?.actual_price
              )
            : null;
        if (discountErr) {
            setDiscountError(discountErr);
            return;
        }
        if (canDiscount && discountServerError && values.admin_discount?.mode !== 'NONE') {
            setDiscountError(discountServerError);
            return;
        }
        setDiscountError(null);
        if (!canDiscount) values = { ...values, admin_discount: EMPTY_ADMIN_DISCOUNT };
        console.log('💰 Step 4 - Payment details:', {
            payment_option_id: stepThreeData?.invite?.payment_option_id,
            plan_id: values.plan_id,
            amount: values.amount,
            currency: values.currency,
            file_id: values.file_id,
            transaction_id: values.transaction_id,
        });
        setStepFourData(values);
        nextStep();
    };

    const formRef = useRef<HTMLFormElement>(null);

    const requestFormSubmit = () => {
        if (formRef.current) {
            formRef.current.requestSubmit();
        }
    };

    useEffect(() => {
        if (submitFn) {
            submitFn(requestFormSubmit);
        }
    }, [submitFn]);

    return (
        <div>
            <div className="flex flex-col justify-center px-6 text-neutral-600">
                <Form {...form}>
                    <form
                        ref={formRef}
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="flex flex-col gap-6"
                    >
                        <FormStepHeading stepNumber={4} heading="Payment Details" />

                        <div className="flex flex-col gap-8">
                            {/* Payment Plan Selection (Required) */}
                            <FormField
                                control={form.control}
                                name="plan_id"
                                render={({ field }) => {
                                    const planDropdownList = paymentPlans.map((plan) => {
                                        const planName = plan.name || 'Unnamed Plan';
                                        const planPrice = plan.actual_price || 0;
                                        const currency = plan.currency || 'INR';

                                        return {
                                            id: plan.id,
                                            name: `${planName} - ${currency} ${formatPlanPrice(planPrice)}${plan.validity_in_days ? ` (${plan.validity_in_days} days)` : ''}`,
                                        };
                                    });

                                    const selectedPlanValue = field.value
                                        ? planDropdownList.find((plan) => plan.id === field.value)
                                        : undefined;

                                    return (
                                        <FormItem>
                                            <FormLabel className="text-subtitle font-semibold">
                                                Select Payment Plan *
                                            </FormLabel>
                                            <FormControl>
                                                {paymentPlans.length === 0 ? (
                                                    <div className="rounded border bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
                                                        No payment plans available for this invite
                                                    </div>
                                                ) : (
                                                    <MyDropdown
                                                        currentValue={selectedPlanValue}
                                                        dropdownList={planDropdownList}
                                                        handleChange={(
                                                            value: DropdownValueType
                                                        ) => {
                                                            if (
                                                                typeof value === 'object' &&
                                                                'id' in value
                                                            ) {
                                                                const selectedPlan =
                                                                    paymentPlans.find(
                                                                        (p) => p.id === value.id
                                                                    );
                                                                console.log(
                                                                    '📋 Selected plan:',
                                                                    selectedPlan
                                                                );

                                                                // Set plan_id
                                                                form.setValue('plan_id', value.id);
                                                                // A discount priced against the old
                                                                // plan no longer applies.
                                                                form.setValue(
                                                                    'admin_discount',
                                                                    EMPTY_ADMIN_DISCOUNT
                                                                );

                                                                // Auto-fill amount and currency from plan
                                                                if (selectedPlan) {
                                                                    const amount =
                                                                        selectedPlan.actual_price ||
                                                                        0;
                                                                    const currency =
                                                                        selectedPlan.currency ||
                                                                        'INR';

                                                                    form.setValue(
                                                                        'amount',
                                                                        amount.toString()
                                                                    );
                                                                    form.setValue(
                                                                        'currency',
                                                                        currency
                                                                    );

                                                                    console.log(
                                                                        '✅ Auto-filled - Amount:',
                                                                        amount,
                                                                        'Currency:',
                                                                        currency
                                                                    );
                                                                }
                                                            }
                                                        }}
                                                        placeholder="Select a payment plan"
                                                        required={true}
                                                    />
                                                )}
                                            </FormControl>
                                            {form.formState.errors.plan_id && (
                                                <p className="text-sm text-red-500">
                                                    {form.formState.errors.plan_id.message}
                                                </p>
                                            )}
                                            <p className="text-xs text-gray-500">
                                                Amount and currency will be auto-filled from the
                                                selected plan
                                            </p>
                                        </FormItem>
                                    );
                                }}
                            />

                            {/* Admin-granted discount — ONE_TIME / SUBSCRIPTION plans only */}
                            {canDiscount && watchedPlanId && (
                                <div className="rounded-lg border border-neutral-200 p-4">
                                    <AdminDiscountField
                                        value={adminDiscount}
                                        onChange={(v) => {
                                            setDiscountError(null);
                                            form.setValue('admin_discount', v);
                                        }}
                                        paymentPlanId={watchedPlanId}
                                        isSubscription={isSubscription}
                                        currency={selectedPlan?.currency || 'INR'}
                                        packageSessionId={
                                            stepThreeData?.invite?.package_session_ids?.[0]
                                        }
                                        enrollInviteId={stepThreeData?.invite?.id}
                                        learnerEmail={stepTwoData?.email || undefined}
                                        onPreview={handleDiscountPreview}
                                        onServerErrorChange={setDiscountServerError}
                                        label="Discount (optional)"
                                    />
                                    {discountError && (
                                        <p className="mt-2 text-sm text-red-500">{discountError}</p>
                                    )}
                                </div>
                            )}

                            {/* Payment Receipt File Upload (Optional) */}
                            <FormField
                                control={form.control}
                                name="file_id"
                                render={() => (
                                    <FormItem>
                                        <FormLabel className="text-subtitle font-semibold">
                                            Payment Receipt (Optional)
                                        </FormLabel>
                                        <FormControl>
                                            <div className="flex flex-col gap-2">
                                                <input
                                                    type="file"
                                                    accept=".jpg,.jpeg,.png,.pdf"
                                                    onChange={handleFileChange}
                                                    disabled={isFileUploading}
                                                    className="block w-full cursor-pointer text-sm
                                                        text-gray-500 file:mr-4 file:rounded
                                                        file:border-0 file:bg-blue-50
                                                        file:px-4 file:py-2
                                                        file:text-sm file:font-semibold
                                                        file:text-blue-700
                                                        hover:file:bg-blue-100"
                                                />
                                                {isFileUploading && (
                                                    <div className="text-sm text-blue-600">
                                                        Uploading file...
                                                    </div>
                                                )}
                                                {uploadedFileId && (
                                                    <div className="flex items-center gap-2 text-sm text-green-600">
                                                        <span>✓ File uploaded successfully</span>
                                                        <button
                                                            type="button"
                                                            onClick={handleRemoveFile}
                                                            className="text-red-500 hover:underline"
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                )}
                                                <p className="text-xs text-gray-500">
                                                    Accepted formats: JPG, PNG, PDF (Max 5MB)
                                                </p>
                                            </div>
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            {/* Transaction ID (Optional) */}
                            <FormField
                                control={form.control}
                                name="transaction_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-subtitle font-semibold">
                                            Transaction ID (Optional)
                                        </FormLabel>
                                        <FormControl>
                                            <input
                                                type="text"
                                                placeholder="Enter transaction ID"
                                                {...field}
                                                className="w-full rounded border px-3 py-2"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <div className="rounded bg-blue-50 p-3 text-sm text-blue-700">
                                <strong>Note:</strong> After selecting a payment plan, you can
                                optionally provide payment proof by uploading a receipt OR entering
                                a transaction ID.
                            </div>
                        </div>
                    </form>
                </Form>
            </div>
        </div>
    );
};
