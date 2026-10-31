/**
 * EditFormResponseDialog — edits the answers on one lead form response (the
 * Form Response card on the Lead Profile tab).
 *
 * Writes through the existing lead-profile endpoint. Only answers that changed
 * are sent. When a changed answer is the lead's own phone / email / name (its old
 * value equals the stored one — see {@link buildIdentitySync}), the same request
 * also moves the auth user and this enquiry's `parent_mobile`, and the backend
 * mirrors the auth fields onto the learner's `student` rows — so Overview, lead
 * lists, Check Lead, calls and the Students list all show the new value. Parts
 * left out of the request are untouched by the backend.
 */

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PencilSimple } from '@phosphor-icons/react';
import { getCountryCallingCode, type CountryCode } from 'libphonenumber-js';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { UPDATE_LEAD_PROFILE } from '@/constants/urls';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import PhoneNumberInput from '@/components/design-system/phone-number-input';
import { getPreferredPhoneCountries } from '@/services/domain-routing';
import { isBlankPhone, isValidPhoneValue } from '@/lib/phone-validation';
import { Form, FormControl, FormField, FormItem } from '@/components/ui/form';
import { invalidateLeadCaches } from '@/hooks/use-invalidate-lead-caches';
import { studentDetailsKey } from '@/services/get-student-details';
import {
    audienceLeadKey,
    fetchAudienceLeadByResponseId,
} from '@/routes/audience-manager/list/-services/get-recent-leads';
import { isMultiSelectType } from '../../-utils/format-custom-field-value';
import { buildIdentitySync, type IdentitySync } from '../../-utils/form-response-identity';
import type { LeadResponseField } from './lead-form-response-card';

const formSchema = z.object({ answers: z.record(z.string()) });
type FormValues = z.infer<typeof formSchema>;

/** Attachments are uploads and multi-select answers are JSON arrays — a text box would corrupt both. */
export const isEditableResponseField = (field: LeadResponseField) => {
    const type = (field.type ?? '').toLowerCase();
    return type !== 'file' && !isMultiSelectType(field.type);
};

/**
 * Returns true when this form-response row holds a phone number — either by
 * field type or by a name that looks like phone/mobile. We accept the loose name
 * match because campaign authors sometimes pick a generic "text" field for the
 * phone column.
 */
export const isPhoneField = (field: LeadResponseField): boolean => {
    const fieldType = (field.type ?? '').toLowerCase().trim();
    if (fieldType === 'phone' || fieldType === 'mobile' || fieldType === 'telephone') return true;
    const n = (field.name ?? '').toLowerCase();
    return /\bphone\b|\bmobile\b|\btelephone\b/.test(n);
};

const phoneDigits = (value?: string | null) => (value ?? '').replace(/\D/g, '');

/**
 * Seeds a stored phone answer into the country-code input. The widget reads the
 * dial code from the value's own leading digits, so a bare "9876543210" would
 * show as +98 — give a bare 10-digit number the institute's default dial code.
 */
const toPhoneInputValue = (raw: string | null, defaultCountry: string): string => {
    const digits = phoneDigits(raw);
    if (digits.length !== 10 || (raw ?? '').trim().startsWith('+')) return digits;
    try {
        return `${getCountryCallingCode(defaultCountry.toUpperCase() as CountryCode)}${digits}`;
    } catch {
        return digits;
    }
};

export interface FormResponseSaved {
    /** Every answer that changed (custom field id → new value). */
    changed: Record<string, string>;
    /** The identity copies that followed the edit. */
    sync: IdentitySync;
}

interface EditFormResponseDialogProps {
    responseId: string;
    /** The lead's user id — scopes the Overview / lead cache refresh. */
    leadUserId: string | null;
    fields: LeadResponseField[];
    onSaved?: (saved: FormResponseSaved) => void;
}

export const EditFormResponseDialog = ({
    responseId,
    leadUserId,
    fields,
    onSaved,
}: EditFormResponseDialogProps) => {
    const { t } = useTranslation('audienceManagerLeadFormResponseCard');
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [checking, setChecking] = useState(false);

    const editable = fields.filter(isEditableResponseField);
    // What each box opened with — a phone box shows its number with a dial code.
    const seeded = useRef<Record<string, string>>({});
    const hasReadOnly = editable.length < fields.length;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: { answers: {} },
    });

    // Re-seed on every open so a cancelled edit never lingers.
    useEffect(() => {
        if (!open) return;
        const { defaultCountry } = getPreferredPhoneCountries();
        const answers: Record<string, string> = {};
        editable.forEach((f) => {
            answers[f.id] = isPhoneField(f)
                ? toPhoneInputValue(f.rawValue, defaultCountry)
                : f.rawValue ?? '';
        });
        seeded.current = answers;
        form.reset({ answers });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const mutation = useMutation({
        mutationFn: ({ changed, sync }: FormResponseSaved) =>
            authenticatedAxiosInstance.put(UPDATE_LEAD_PROFILE(responseId), {
                // Omitted parts are left alone by the backend — never send an empty
                // user_details, or it rewrites the auth user for nothing.
                ...(Object.keys(sync.userDetails).length > 0 && {
                    user_details: sync.userDetails,
                }),
                ...(sync.parentMobile && { parent_mobile: sync.parentMobile }),
                custom_field_values: Object.entries(changed).map(([custom_field_id, value]) => ({
                    source_type: 'AUDIENCE_RESPONSE',
                    source_id: responseId,
                    custom_field_id,
                    value,
                })),
            }),
        onSuccess: (_data, saved) => {
            toast.success(t('editDialog.updateSuccess'));
            onSaved?.(saved);
            queryClient.invalidateQueries({ queryKey: audienceLeadKey(responseId) });
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            if (leadUserId) {
                // Lists, contacts, Check Lead, Overview and the Students list.
                invalidateLeadCaches(queryClient, leadUserId);
                queryClient.invalidateQueries({ queryKey: studentDetailsKey(leadUserId) });
                queryClient.invalidateQueries({ queryKey: ['students'] });
            }
            setOpen(false);
        },
        onError: (error: unknown) =>
            // A new phone/email that another lead already owns comes back as a 409.
            toast.error(
                (error as { response?: { data?: { ex?: string } } })?.response?.data?.ex ??
                    t('editDialog.updateError')
            ),
    });

    const onSubmit = async (values: FormValues) => {
        const changed: Record<string, string> = {};
        const badPhones: string[] = [];
        editable.forEach((f) => {
            const value = (values.answers[f.id] ?? '').trim();
            if (!isPhoneField(f)) {
                if (value !== (f.rawValue ?? '')) changed[f.id] = value;
                return;
            }
            // Saved as dial code + number ("919876543210"), the stored format.
            // A box left with only the dial code is an empty answer.
            const next = isBlankPhone(value) ? '' : phoneDigits(value);
            if (next === phoneDigits(seeded.current[f.id])) return;
            if (next && !isValidPhoneValue(next)) badPhones.push(f.id);
            changed[f.id] = next;
        });
        if (badPhones.length > 0) {
            badPhones.forEach((fieldId) =>
                form.setError(`answers.${fieldId}` as const, {
                    message: t('editDialog.invalid.phoneFormat'),
                })
            );
            return;
        }
        if (Object.keys(changed).length === 0) {
            setOpen(false);
            return;
        }

        // Compare against the stored identity as it is now, not the row the list
        // loaded earlier.
        setChecking(true);
        let sync: IdentitySync;
        try {
            const lead = await queryClient.fetchQuery({
                queryKey: audienceLeadKey(responseId),
                queryFn: () => fetchAudienceLeadByResponseId(responseId),
                staleTime: 0,
            });
            sync = buildIdentitySync(editable, changed, {
                fullName: lead.user?.full_name,
                email: lead.user?.email,
                mobile: lead.user?.mobile_number,
                parentMobile: lead.parent_mobile,
            });
        } catch {
            toast.error(t('editDialog.updateError'));
            return;
        } finally {
            setChecking(false);
        }

        if (sync.invalid.length > 0) {
            sync.invalid.forEach(({ fieldId, kind }) =>
                form.setError(`answers.${fieldId}` as const, {
                    message: t(`editDialog.invalid.${kind}`),
                })
            );
            return;
        }
        mutation.mutate({ changed, sync });
    };

    if (editable.length === 0) return null;

    const footer = (
        <div className="flex w-full items-center justify-end gap-3">
            <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                onClick={() => setOpen(false)}
            >
                {t('editDialog.cancel')}
            </MyButton>
            <MyButton
                type="button"
                buttonType="primary"
                scale="medium"
                disable={mutation.isPending || checking}
                onClick={() => form.handleSubmit(onSubmit)()}
            >
                {mutation.isPending || checking ? t('editDialog.saving') : t('editDialog.save')}
            </MyButton>
        </div>
    );

    return (
        <MyDialog
            trigger={
                <MyButton type="button" buttonType="text" scale="small">
                    <PencilSimple className="size-3.5" />
                    {t('editDialog.edit')}
                </MyButton>
            }
            heading={t('editDialog.dialogHeading')}
            open={open}
            onOpenChange={setOpen}
            footer={footer}
            dialogWidth="max-w-lg"
        >
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
                    <p className="text-caption text-neutral-500">{t('editDialog.helper')}</p>
                    {editable.map((f) => (
                        <FormField
                            key={f.id}
                            control={form.control}
                            name={`answers.${f.id}` as const}
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        {isPhoneField(f) ? (
                                            <PhoneNumberInput
                                                name={f.id}
                                                label={f.name}
                                                placeholder={f.name}
                                                value={field.value ?? ''}
                                                onChange={(_name, phone) => {
                                                    form.clearErrors(`answers.${f.id}` as const);
                                                    field.onChange(phone);
                                                }}
                                                error={
                                                    form.formState.errors.answers?.[f.id]?.message
                                                }
                                                // Checked on save, against changed answers only —
                                                // an untouched legacy number must not block saving.
                                                validate={false}
                                            />
                                        ) : (
                                            <MyInput
                                                label={f.name}
                                                inputType="text"
                                                inputPlaceholder={f.name}
                                                input={field.value ?? ''}
                                                onChangeFunction={(e) =>
                                                    field.onChange(e.target.value)
                                                }
                                                error={
                                                    form.formState.errors.answers?.[f.id]?.message
                                                }
                                                size="large"
                                                className="w-full"
                                            />
                                        )}
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    ))}
                    {hasReadOnly && (
                        <p className="text-caption text-neutral-400">{t('editDialog.readOnly')}</p>
                    )}
                </form>
            </Form>
        </MyDialog>
    );
};

export default EditFormResponseDialog;
