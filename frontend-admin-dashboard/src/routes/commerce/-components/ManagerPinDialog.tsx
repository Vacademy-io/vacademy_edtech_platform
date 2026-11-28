import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ShieldCheck } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Form } from '@/components/ui/form';
import { COMMERCE_ROLE } from '@/lib/commerce/commerce-access';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import { useCommerceStaff } from '@/routes/commerce/-shared/commerce-hooks';
import type { ManagerApproval } from '@/routes/commerce/-shared/commerce-types';
import { looksLikePin, sanitizePinInput } from '@/routes/commerce/-shared/pin-rules';
import { CommerceSelectField, CommerceTextField } from './CommerceFormFields';
import { CommerceErrorState, CommerceLoadingRows } from './CommerceStates';

export interface ManagerOption {
    user_id: string;
    full_name: string;
}

export interface ManagerPinDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** What is being approved, in the caller's words ("Void bill 1042"). */
    heading?: string;
    description?: string;
    /** Ask for a reason and send it with the approval. */
    requireReason?: boolean;
    /**
     * The managers to choose from. Leave out to load the institute's store
     * managers and admins; pass a list when the screen already has one (POS).
     */
    managers?: ManagerOption[];
    /**
     * Runs the approved action. The approval (who, PIN, reason) must travel in
     * THAT request: the server verifies the PIN with the action and records the
     * approval. Reject with the server's error to keep the dialog open.
     */
    onApprove: (approval: ManagerApproval) => Promise<void>;
}

const REASON_MAX = 300;

const buildSchema = (t: TFunction, requireReason: boolean) =>
    z.object({
        approver_user_id: z.string().min(1, t('pinDialog.validation.managerRequired')),
        pin: z.string().refine(looksLikePin, t('pinDialog.validation.pinFormat')),
        reason: requireReason
            ? z
                  .string()
                  .trim()
                  .min(1, t('pinDialog.validation.reasonRequired'))
                  .max(REASON_MAX, t('pinDialog.validation.reasonMax', { max: REASON_MAX }))
            : z
                  .string()
                  .trim()
                  .max(REASON_MAX, t('pinDialog.validation.reasonMax', { max: REASON_MAX })),
    });

type PinFormValues = z.infer<ReturnType<typeof buildSchema>>;

const EMPTY: PinFormValues = { approver_user_id: '', pin: '', reason: '' };

/**
 * The one manager-approval dialog: the manager picks their name
 * and types their PIN. The PIN lives only in this form while it is open; it is
 * handed to `onApprove`, cleared on close and on every failed try, and never
 * written to storage, the query cache or a log.
 *
 * A wrong PIN and a locked PIN come back from the server as a sentence
 * (`PIN_INVALID: …`, `PIN_LOCKED: …`); the dialog shows that sentence and stays
 * open so the manager can try again or someone else can approve.
 */
export function ManagerPinDialog({
    open,
    onOpenChange,
    heading,
    description,
    requireReason = false,
    managers,
    onApprove,
}: ManagerPinDialogProps) {
    const { t } = useTranslation('commerce');
    const [serverError, setServerError] = useState<string | null>(null);

    const staffQuery = useCommerceStaff(open && !managers);
    const options = useMemo<ManagerOption[]>(() => {
        if (managers) return managers;
        return (staffQuery.data ?? [])
            .filter(
                (member) =>
                    member.is_admin || member.commerce_roles.includes(COMMERCE_ROLE.STORE_MANAGER)
            )
            .map((member) => ({ user_id: member.user_id, full_name: member.full_name }))
            .sort((a, b) => a.full_name.localeCompare(b.full_name));
    }, [managers, staffQuery.data]);

    const schema = useMemo(() => buildSchema(t, requireReason), [t, requireReason]);
    const form = useForm<PinFormValues>({
        resolver: zodResolver(schema),
        defaultValues: EMPTY,
        mode: 'onSubmit',
    });

    // Opening or closing always starts from an empty form: no PIN survives.
    useEffect(() => {
        form.reset(EMPTY);
        setServerError(null);
    }, [open, form]);

    const onSubmit = async (values: PinFormValues) => {
        setServerError(null);
        try {
            await onApprove({
                approver_user_id: values.approver_user_id,
                pin: values.pin,
                ...(values.reason ? { reason: values.reason } : {}),
            });
            onOpenChange(false);
        } catch (error) {
            setServerError(readCommerceError(error, t('pinDialog.errors.failed')).message);
            form.setValue('pin', '');
        }
    };

    const loadingManagers = !managers && staffQuery.isLoading;
    const managersFailed = !managers && staffQuery.isError;

    return (
        <MyDialog
            heading={heading ?? t('pinDialog.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        disable={loadingManagers || managersFailed}
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('pinDialog.checking')}
                    >
                        {t('pinDialog.approve')}
                    </MyButton>
                </div>
            }
        >
            <Form {...form}>
                <form className="flex flex-col gap-4" noValidate>
                    <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-info-600" />
                        <span>{description ?? t('pinDialog.description')}</span>
                    </div>

                    {loadingManagers && <CommerceLoadingRows rows={1} />}
                    {managersFailed && (
                        <CommerceErrorState
                            message={
                                readCommerceError(
                                    staffQuery.error,
                                    t('pinDialog.errors.managersFailed')
                                ).message
                            }
                            onRetry={() => void staffQuery.refetch()}
                        />
                    )}
                    {!loadingManagers && !managersFailed && (
                        <>
                            <CommerceSelectField
                                control={form.control}
                                name="approver_user_id"
                                label={t('pinDialog.fields.manager')}
                                placeholder={t('pinDialog.fields.managerPlaceholder')}
                                emptyText={t('pinDialog.noManagers')}
                                options={options.map((manager) => ({
                                    value: manager.user_id,
                                    label: manager.full_name || manager.user_id,
                                }))}
                                required
                            />
                            <CommerceTextField
                                control={form.control}
                                name="pin"
                                label={t('pinDialog.fields.pin')}
                                placeholder={t('pinDialog.fields.pinPlaceholder')}
                                inputType="password"
                                inputMode="numeric"
                                transform={sanitizePinInput}
                                required
                            />
                            {requireReason && (
                                <CommerceTextField
                                    control={form.control}
                                    name="reason"
                                    label={t('pinDialog.fields.reason')}
                                    placeholder={t('pinDialog.fields.reasonPlaceholder')}
                                    maxLength={REASON_MAX}
                                    required
                                />
                            )}
                        </>
                    )}
                    {serverError && <CommerceErrorState message={serverError} />}
                </form>
            </Form>
        </MyDialog>
    );
}
