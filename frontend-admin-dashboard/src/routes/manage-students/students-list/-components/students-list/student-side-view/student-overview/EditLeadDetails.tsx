import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import PhoneInputField from '@/components/design-system/phone-input-field';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { UPDATE_LEAD_PROFILE } from '@/constants/urls';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    PencilSimple,
    UserCircle,
    Phone,
    UsersThree,
    SlidersHorizontal,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';

// A lead is read from auth-users (name/email/mobile) + audience_response.parent_*
// (guardian) + custom field answers. This dialog edits exactly those — nothing the
// lead doesn't have (no enrollment/student fields). Branch into it from the shared
// sidebar when the selected row carries a `_response_id` (i.e. it's a lead).

const buildEditLeadFormSchema = (t: TFunction) =>
    z.object({
        full_name: z.string().min(1, t('validation.required')),
        email: z.string().email(t('validation.invalidEmail')),
        contact_number: z.string().optional().or(z.literal('')),
        guardian_name: z.string().optional(),
        guardian_mobile: z.string().optional(),
        guardian_email: z.string().email(t('validation.invalidEmailShort')).optional().or(z.literal('')),
        custom_fields: z.record(z.string()).optional(),
    });

type EditLeadFormValues = z.infer<ReturnType<typeof buildEditLeadFormSchema>>;

interface LeadResponseField {
    id: string;
    name: string;
    type: string;
    rawValue: string | null;
}

const FormCard = ({
    icon: Icon,
    title,
    helper,
    children,
}: {
    icon: PhosphorIcon;
    title: string;
    helper?: string;
    children: React.ReactNode;
}) => (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <header className="mb-4 flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-600">
                <Icon className="size-5" weight="duotone" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
                <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
                {helper && <p className="mt-0.5 text-xs text-neutral-500">{helper}</p>}
            </div>
        </header>
        <div className="flex flex-col gap-4">{children}</div>
    </section>
);

const PHONE_INPUT_OVERRIDE_CSS = `
.elp-phone > div { display: flex; flex-direction: column; row-gap: 4px; }
.elp-phone .react-tel-input { width: 100% !important; font-size: 14px !important; }
.elp-phone .react-tel-input .form-control {
  width: 100% !important;
  height: 36px !important;
  padding: 4px 12px 4px 52px !important;
  font-size: 14px !important;
  line-height: 1.2 !important;
}
.elp-phone .react-tel-input .flag-dropdown,
.elp-phone .react-tel-input .selected-flag { height: 36px !important; }
`;

export const EditLeadDetails = () => {
    const { t } = useTranslation('manageStudentsEditLeadDetails');
    const { selectedStudent, setSelectedStudent } = useStudentSidebar();
    const queryClient = useQueryClient();
    const [openDialog, setOpenDialog] = useState(false);

    const responseId =
        (selectedStudent as unknown as Record<string, unknown>)?._response_id as string | null;
    const allResponseFields =
        ((selectedStudent as unknown as Record<string, unknown>)?._response_fields as
            | LeadResponseField[]
            | undefined) ?? [];

    // Lead forms usually capture Full Name / Email / Phone as custom-field answers
    // too, so those show up in _response_fields AND as the system fields we already
    // edit at the top. Drop the identity mirrors here so they aren't rendered (and
    // editable) twice — match by field type/name, then by value as a fallback.
    const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '');
    const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
    const isIdentityMirror = (f: LeadResponseField): boolean => {
        const fieldType = (f.type ?? '').toLowerCase().trim();
        const n = (f.name ?? '').toLowerCase();
        const v = norm(f.rawValue);
        // Email
        if (fieldType === 'email' || /e-?mail/.test(n)) return true;
        if (v && v === norm(selectedStudent?.email)) return true;
        // Phone / mobile
        if (
            ['phone', 'mobile', 'telephone'].includes(fieldType) ||
            /\bphone\b|\bmobile\b|\btelephone\b/.test(n)
        )
            return true;
        if (digits(f.rawValue) && digits(f.rawValue) === digits(selectedStudent?.mobile_number))
            return true;
        // Full name
        if (/\bfull\s*name\b|^name$/.test(n)) return true;
        if (v && v === norm(selectedStudent?.full_name)) return true;
        return false;
    };
    const responseFields = allResponseFields.filter((f) => !isIdentityMirror(f));

    const editLeadFormSchema = useMemo(() => buildEditLeadFormSchema(t), [t]);

    const form = useForm<EditLeadFormValues>({
        resolver: zodResolver(editLeadFormSchema),
        defaultValues: {},
    });

    // Seed from the same values the sidebar reads, so the edit round-trips.
    useEffect(() => {
        if (!selectedStudent || !openDialog) return;
        const customFields: Record<string, string> = {};
        responseFields.forEach((f) => {
            customFields[f.id] = f.rawValue ?? '';
        });
        form.reset({
            full_name: selectedStudent.full_name || '',
            email: selectedStudent.email || '',
            contact_number: selectedStudent.mobile_number || '',
            guardian_name: selectedStudent.fathers_name || '',
            guardian_mobile: selectedStudent.father_mobile_number || '',
            guardian_email: selectedStudent.father_email || '',
            custom_fields: customFields,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStudent, openDialog]);

    const mutation = useMutation({
        mutationFn: (values: EditLeadFormValues) => {
            const customFieldValues = Object.entries(values.custom_fields ?? {}).map(
                ([custom_field_id, value]) => ({
                    source_type: 'AUDIENCE_RESPONSE',
                    source_id: responseId,
                    custom_field_id,
                    value: value || '',
                })
            );
            const payload = {
                user_details: {
                    id: selectedStudent?.user_id,
                    full_name: values.full_name,
                    email: values.email,
                    mobile_number: values.contact_number || '',
                },
                parent_name: values.guardian_name || '',
                parent_email: values.guardian_email || '',
                parent_mobile: values.guardian_mobile || '',
                custom_field_values: customFieldValues,
            };
            return authenticatedAxiosInstance.put(UPDATE_LEAD_PROFILE(responseId || ''), payload);
        },
        onSuccess: (_data, values) => {
            toast.success(t('toast.updateSuccess'));
            // Reflect the edit in the open sidebar immediately.
            if (selectedStudent) {
                setSelectedStudent(
                    {
                        ...selectedStudent,
                        full_name: values.full_name,
                        email: values.email,
                        mobile_number: values.contact_number || '',
                        fathers_name: values.guardian_name || '',
                        father_mobile_number: values.guardian_mobile || '',
                        father_email: values.guardian_email || '',
                    },
                    { openOverlay: false }
                );
            }
            queryClient.invalidateQueries({ queryKey: ['recent-leads'] });
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            setOpenDialog(false);
        },
        onError: () => {
            toast.error(t('toast.updateError'));
        },
    });

    const onSubmit = (values: EditLeadFormValues) => mutation.mutate(values);

    if (!selectedStudent || !responseId) return null;

    const footer = (
        <div className="flex w-full items-center justify-end gap-3">
            <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                onClick={() => setOpenDialog(false)}
            >
                {t('cancel')}
            </MyButton>
            <MyButton
                type="button"
                buttonType="primary"
                scale="medium"
                disable={mutation.isPending}
                onClick={() => form.handleSubmit(onSubmit)()}
            >
                {mutation.isPending ? t('saving') : t('saveChanges')}
            </MyButton>
        </div>
    );

    return (
        <MyDialog
            trigger={
                <MyButton buttonType="secondary" scale="medium">
                    <PencilSimple className="size-4" />
                    {t('trigger')}
                </MyButton>
            }
            footer={footer}
            heading={t('dialogHeading')}
            open={openDialog}
            onOpenChange={setOpenDialog}
            dialogWidth="max-w-2xl"
        >
            <FormProvider {...form}>
                <style dangerouslySetInnerHTML={{ __html: PHONE_INPUT_OVERRIDE_CSS }} />
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
                    {/* IDENTITY */}
                    <FormCard
                        icon={UserCircle}
                        title={t('sections.identity.title')}
                        helper={t('sections.identity.helper')}
                    >
                        <FormField
                            control={form.control}
                            name="full_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            label={t('fields.fullName.label')}
                                            required
                                            inputType="text"
                                            inputPlaceholder={t('fields.fullName.placeholder')}
                                            input={field.value ?? ''}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            error={form.formState.errors.full_name?.message}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </FormCard>

                    {/* CONTACT */}
                    <FormCard
                        icon={Phone}
                        title={t('sections.contact.title')}
                        helper={t('sections.contact.helper')}
                    >
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            label={t('fields.email.label')}
                                            required
                                            inputType="text"
                                            inputPlaceholder={t('fields.email.placeholder')}
                                            input={field.value ?? ''}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            error={form.formState.errors.email?.message}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="contact_number"
                            render={() => (
                                <FormItem>
                                    <FormControl>
                                        <div className="elp-phone w-full">
                                            <PhoneInputField
                                                label={t('fields.mobile.label')}
                                                placeholder={t('fields.mobile.placeholder')}
                                                name="contact_number"
                                                control={form.control}
                                                required={false}
                                            />
                                        </div>
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </FormCard>

                    {/* GUARDIAN */}
                    <FormCard
                        icon={UsersThree}
                        title={t('sections.guardian.title')}
                        helper={t('sections.guardian.helper')}
                    >
                        <FormField
                            control={form.control}
                            name="guardian_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            label={t('fields.guardianName.label')}
                                            inputType="text"
                                            inputPlaceholder={t('fields.guardianName.placeholder')}
                                            input={field.value ?? ''}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <div className="elp-phone w-full">
                            <PhoneInputField
                                label={t('fields.guardianMobile.label')}
                                placeholder={t('fields.guardianMobile.placeholder')}
                                name="guardian_mobile"
                                control={form.control}
                                required={false}
                            />
                        </div>
                        <FormField
                            control={form.control}
                            name="guardian_email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            label={t('fields.guardianEmail.label')}
                                            inputType="text"
                                            inputPlaceholder={t('fields.guardianEmail.placeholder')}
                                            input={field.value ?? ''}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                            error={form.formState.errors.guardian_email?.message}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </FormCard>

                    {/* CUSTOM FIELDS (the lead's form answers) */}
                    {responseFields.length > 0 && (
                        <FormCard
                            icon={SlidersHorizontal}
                            title={t('sections.additional.title')}
                            helper={t('sections.additional.helper')}
                        >
                            {responseFields.map((f) => (
                                <FormField
                                    key={f.id}
                                    control={form.control}
                                    name={`custom_fields.${f.id}` as const}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <MyInput
                                                    label={f.name}
                                                    inputType="text"
                                                    inputPlaceholder={f.name}
                                                    input={field.value ?? ''}
                                                    onChangeFunction={(e) => field.onChange(e.target.value)}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            ))}
                        </FormCard>
                    )}
                </form>
            </FormProvider>
        </MyDialog>
    );
};
