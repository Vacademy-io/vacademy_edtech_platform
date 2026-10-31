import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ChalkboardTeacher,
    Check,
    CheckCircle,
    CircleNotch,
    Copy,
    EnvelopeSimple,
    Info,
    PaperPlaneTilt,
    UserPlus,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import PhoneNumberInput from '@/components/design-system/phone-number-input';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { isBlankPhone, validatePhoneField } from '@/lib/phone-validation';
import { getPreferredPhoneCountries } from '@/services/domain-routing';
import {
    formatPhoneForDisplay,
    instituteRolesOf,
    toPhoneInputValue,
    type TeamMember,
    type TeamRoleOption,
} from '../-utils/team-helpers';
import {
    inviteTeamMember,
    updateTeamInvite,
    updateTeamMemberDetails,
} from '../-services/team-member-services';
import { RolePicker } from './RolePicker';
import { isShareablePassword } from '../-utils/team-csv';
import { FormStep, RoleChip } from './team-ui';

const LazyBatchSubjectForm = lazy(() =>
    import('@/routes/dashboard/-components/BatchAndSubjectSelection').catch(() => {
        window.location.reload();
        return import('@/routes/dashboard/-components/BatchAndSubjectSelection');
    })
);

// Field names mirror the shared invite schema (roleType, batch_subject_mappings) so the
// existing BatchSubjectForm can write its selection into this form through context.
const buildSchema = (t: TFunction) =>
    z.object({
        name: z.string().trim().min(1, t('invite.validation.nameRequired')),
        email: z
            .string()
            .trim()
            .min(1, t('invite.validation.emailRequired'))
            .email(t('invite.validation.emailInvalid')),
        mobile: z
            .string()
            .optional()
            .refine((value) => validatePhoneField(value) === undefined, {
                message: t('invite.validation.phoneInvalid'),
            }),
        roleType: z.array(z.string()).min(1, t('invite.validation.roleRequired')),
        batch_subject_mappings: z
            .array(z.object({ batchId: z.string(), subjectIds: z.array(z.string()) }))
            .optional(),
    });
type InviteFormValues = z.infer<ReturnType<typeof buildSchema>>;

interface SentSummary {
    name: string;
    email: string;
    phone: string | null;
    roles: string[];
    username?: string;
    password?: string;
    /** The email already had an account; they keep signing in with it. */
    existingAccount: boolean;
    /** …and already held every role here: nothing changed and no email went out. */
    alreadyMember: boolean;
}

interface InviteMemberDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** `edit` updates an existing pending invite. */
    mode: 'new' | 'edit';
    invite?: TeamMember | null;
    roleOptions: TeamRoleOption[];
    instituteId: string;
    /** Members are active once added, so "done" leads to the Members tab. */
    onViewTeam?: () => void;
}

/** 409 = this person is disabled in the institute; the server says to use Enable instead. */
const isDisabledHereConflict = (error: unknown): boolean =>
    (error as { response?: { status?: number } })?.response?.status === 409;

const serverMessage = (error: unknown): string | undefined => {
    const data = (error as { response?: { data?: { ex?: string; message?: string } } })?.response
        ?.data;
    return data?.ex || data?.message;
};

export function InviteMemberDialog({
    open,
    onOpenChange,
    mode,
    invite,
    roleOptions,
    instituteId,
    onViewTeam,
}: InviteMemberDialogProps) {
    const { t } = useTranslation('manageInstituteTeamsIndexLazy');
    const queryClient = useQueryClient();
    const [sent, setSent] = useState<SentSummary | null>(null);
    const defaultCountry = useMemo(() => getPreferredPhoneCountries().defaultCountry, []);

    // Roles the picker can't show (hidden from this viewer, legacy rows) are carried
    // through untouched: the invitation update REPLACES the role list.
    const pickerNames = useMemo(() => new Set(roleOptions.map((o) => o.name)), [roleOptions]);
    const inviteRoleNames = useMemo(
        () => (invite ? instituteRolesOf(invite, instituteId).map((r) => r.role_name) : []),
        [invite, instituteId]
    );
    const hiddenInviteRoles = inviteRoleNames.filter((name) => !pickerNames.has(name));

    const initialValues = (): InviteFormValues => ({
        name: mode === 'edit' ? invite?.full_name ?? '' : '',
        email: mode === 'edit' ? invite?.email ?? '' : '',
        mobile: mode === 'edit' ? toPhoneInputValue(invite?.mobile_number, defaultCountry) : '',
        roleType: mode === 'edit' ? inviteRoleNames.filter((name) => pickerNames.has(name)) : [],
        batch_subject_mappings: [],
    });

    const form = useForm<InviteFormValues>({
        resolver: zodResolver(buildSchema(t)),
        defaultValues: initialValues(),
        mode: 'onTouched',
    });

    useEffect(() => {
        if (!open) return;
        setSent(null);
        form.reset(initialValues());
        // Re-seed only when the dialog opens or switches target.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, mode, invite?.id]);

    // batch_subject_mappings is deliberately NOT watched here. BatchSubjectForm rewrites
    // it from an effect keyed on useFormContext(), whose identity changes on every render
    // of this component (FormProvider spreads a fresh object) — watching it here would
    // re-render, re-run that effect and loop. BatchIssueWatcher reports a string instead,
    // and an unchanged string makes React bail out.
    const [name, email, mobile, roles] = useWatch({
        control: form.control,
        name: ['name', 'email', 'mobile', 'roleType'],
    });
    // undefined = watcher not mounted yet; null = batches complete.
    const [batchState, setBatchState] = useState<string | null | undefined>(undefined);
    const teacherSelected = (roles ?? []).includes('TEACHER');
    const needsBatches = mode === 'new' && teacherSelected;

    // Step completion + the footer's "what's missing" line, computed live.
    const emailValid = z
        .string()
        .email()
        .safeParse((email ?? '').trim()).success;
    const phoneValid = validatePhoneField(mobile) === undefined;
    const detailsDone = !!name?.trim() && emailValid && phoneValid;
    const rolesDone = (roles ?? []).length > 0;
    // Until the watcher mounts and reports, a Teacher invite counts as missing batches.
    const batchIssue = needsBatches
        ? batchState === undefined
            ? t('invite.missing.batches')
            : batchState
        : null;
    const missing = !name?.trim()
        ? t('invite.missing.name')
        : !emailValid
          ? t('invite.missing.email')
          : !phoneValid
            ? t('invite.missing.phone')
            : !rolesDone
              ? t('invite.missing.roles')
              : batchIssue;

    const submit = useMutation({
        mutationFn: async (values: InviteFormValues) => {
            const phone = isBlankPhone(values.mobile) ? '' : values.mobile ?? '';
            if (mode === 'edit' && invite) {
                await updateTeamInvite(instituteId, invite, {
                    name: values.name.trim(),
                    email: values.email.trim(),
                    roles: [...values.roleType, ...hiddenInviteRoles],
                });
                const before = toPhoneInputValue(invite.mobile_number, defaultCountry);
                if (phone !== (isBlankPhone(before) ? '' : before)) {
                    // The invitation update ignores the phone; the details endpoint owns it.
                    await updateTeamMemberDetails(instituteId, invite.id, {
                        mobile_number: phone,
                        profile_pic_file_id: invite.profile_pic_file_id,
                        delete_user_role_request: [],
                        add_user_role_request: [],
                    });
                }
                return null;
            }
            return inviteTeamMember(instituteId, {
                name: values.name.trim(),
                email: values.email.trim(),
                mobileNumber: phone || undefined,
                roles: values.roleType,
                batchSubjectMappings: values.roleType.includes('TEACHER')
                    ? values.batch_subject_mappings
                    : undefined,
            });
        },
        onSuccess: (response, values) => {
            queryClient.invalidateQueries({ queryKey: ['TEAM_MEMBERS'] });
            queryClient.invalidateQueries({ queryKey: ['TEAM_COUNTS'] });
            if (mode === 'edit') {
                toast.success(t('invite.toast.updated', { name: values.name.trim() }));
                onOpenChange(false);
                return;
            }
            setSent({
                name: values.name.trim(),
                email: values.email.trim(),
                phone: isBlankPhone(values.mobile) ? null : values.mobile ?? null,
                roles: values.roleType,
                existingAccount: response?.existing_account === true,
                alreadyMember: response?.already_member === true,
                username: response?.username,
                // An existing account comes back without a password (older backends sent the
                // stored hash) — never show that as login details.
                password:
                    response?.existing_account !== true &&
                    response?.password &&
                    isShareablePassword(response.password)
                        ? response.password
                        : undefined,
            });
        },
        onError: (error) => {
            const message = serverMessage(error);
            if (isDisabledHereConflict(error)) {
                // Shown on the email field so it reads as "this person", not a generic failure.
                form.setError('email', { message: message || t('invite.errors.disabledHere') });
                return;
            }
            if (message && /email|already|exist/i.test(message)) {
                form.setError('email', { message });
                return;
            }
            toast.error(message || t('invite.toast.failed'));
        },
    });

    const onSubmit = form.handleSubmit((values) => {
        if (batchIssue) return;
        submit.mutate(values);
    });

    const optionOf = (roleName: string) => roleOptions.find((o) => o.name === roleName);

    if (sent) {
        const copyLogin = async () => {
            try {
                await navigator.clipboard.writeText(
                    t('login.copyTemplate', { username: sent.username, password: sent.password })
                );
                toast.success(t('login.copied'));
            } catch {
                toast.error(t('login.copyFailed'));
            }
        };
        return (
            <MyDialog
                open={open}
                onOpenChange={onOpenChange}
                heading={
                    sent.alreadyMember ? t('invite.sent.alreadyHeading') : t('invite.sent.heading')
                }
                dialogWidth="max-w-lg"
                footer={
                    <>
                        <MyButton
                            buttonType="secondary"
                            onClick={() => {
                                setSent(null);
                                form.reset(initialValues());
                            }}
                        >
                            <UserPlus size={16} />
                            {t('invite.sent.inviteAnother')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={() => {
                                onOpenChange(false);
                                onViewTeam?.();
                            }}
                        >
                            {t('invite.sent.viewTeam')}
                        </MyButton>
                    </>
                }
            >
                <div className="flex flex-col items-center text-center">
                    <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-success-50 text-success-600 ring-8 ring-success-50">
                        <CheckCircle size={34} weight="fill" />
                    </div>
                    <h3 className="text-h3 font-semibold text-neutral-900">
                        {sent.alreadyMember
                            ? t('invite.sent.alreadyTitle', { name: sent.name })
                            : t('invite.sent.title', { name: sent.name })}
                    </h3>
                    <p className="mt-1 max-w-sm text-body text-neutral-500">
                        {t(
                            sent.alreadyMember
                                ? 'invite.sent.alreadyBody'
                                : sent.existingAccount
                                  ? 'invite.sent.existingBody'
                                  : 'invite.sent.body',
                            {
                                firstName: sent.name.split(/\s+/)[0],
                                email: sent.email,
                            }
                        )}
                    </p>
                    {sent.existingAccount && (
                        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-info-50 px-2.5 py-1 text-caption font-semibold text-info-700">
                            <Info size={14} />
                            {t('invite.sent.existingTag')}
                        </span>
                    )}
                </div>
                <dl className="mt-6 divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200 text-left">
                    <div className="flex gap-4 px-4 py-3">
                        <dt className="w-24 shrink-0 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                            {t('invite.sent.rolesLabel', { count: sent.roles.length })}
                        </dt>
                        <dd className="flex flex-wrap gap-1.5">
                            {sent.roles.map((role) => (
                                <RoleChip key={role} name={role} option={optionOf(role)} />
                            ))}
                        </dd>
                    </div>
                    {sent.phone && (
                        <div className="flex gap-4 px-4 py-3">
                            <dt className="w-24 shrink-0 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                                {t('invite.sent.mobileLabel')}
                            </dt>
                            <dd className="text-body text-neutral-800">
                                {formatPhoneForDisplay(sent.phone, defaultCountry)}
                            </dd>
                        </div>
                    )}
                    {sent.username && sent.password && (
                        <div className="flex items-start gap-4 px-4 py-3">
                            <dt className="w-24 shrink-0 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                                {t('invite.sent.loginLabel')}
                            </dt>
                            <dd className="min-w-0 flex-1">
                                <div className="font-mono text-body text-neutral-800">
                                    {sent.username} / {sent.password}
                                </div>
                                <div className="text-caption text-neutral-500">
                                    {t('invite.sent.loginHint')}
                                </div>
                            </dd>
                            <MyButton buttonType="secondary" scale="small" onClick={copyLogin}>
                                <Copy size={14} />
                                {t('login.copy')}
                            </MyButton>
                        </div>
                    )}
                </dl>
            </MyDialog>
        );
    }

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={mode === 'edit' ? t('invite.editHeading') : t('invite.heading')}
            dialogWidth="max-w-2xl"
            headerActions={
                <span className="flex size-8 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                    <UserPlus size={18} />
                </span>
            }
            footerLeft={
                <span
                    className={
                        missing
                            ? 'flex items-center gap-2 text-caption text-neutral-500'
                            : 'flex min-w-0 items-center gap-2 text-caption text-success-700'
                    }
                >
                    {missing ? (
                        <>
                            <Info size={16} className="shrink-0" />
                            {missing}
                        </>
                    ) : mode === 'edit' ? (
                        <>
                            <EnvelopeSimple size={16} className="shrink-0" />
                            {t('invite.footer.editReady')}
                        </>
                    ) : (
                        <>
                            <EnvelopeSimple size={16} className="shrink-0" />
                            <span className="truncate">
                                {t('invite.footer.ready', { email: email?.trim() })}
                            </span>
                        </>
                    )}
                </span>
            }
            footer={
                <>
                    <MyButton buttonType="secondary" onClick={() => onOpenChange(false)}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        disable={!!missing || submit.isPending}
                        onClick={onSubmit}
                    >
                        {submit.isPending ? (
                            <CircleNotch size={16} className="animate-spin" />
                        ) : mode === 'edit' ? (
                            <Check size={16} weight="bold" />
                        ) : (
                            <PaperPlaneTilt size={16} />
                        )}
                        {mode === 'edit' ? t('invite.submitEdit') : t('invite.submit')}
                    </MyButton>
                </>
            }
        >
            <FormProvider {...form}>
                <form
                    className="flex flex-col gap-6"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void onSubmit();
                    }}
                >
                    <p className="-mt-1 text-body text-neutral-500">
                        {mode === 'edit' ? t('invite.editSubtitle') : t('invite.subtitle')}
                    </p>

                    <FormStep
                        index={1}
                        done={detailsDone}
                        title={t('invite.steps.details.title')}
                        description={t('invite.steps.details.description')}
                    >
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field, fieldState }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                label={t('invite.fields.name')}
                                                required
                                                size="large"
                                                inputPlaceholder={t(
                                                    'invite.fields.namePlaceholder'
                                                )}
                                                input={field.value}
                                                onChangeFunction={field.onChange}
                                                onBlur={field.onBlur}
                                                error={fieldState.error?.message}
                                                className="sm:w-full"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field, fieldState }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="email"
                                                label={t('invite.fields.email')}
                                                required
                                                size="large"
                                                inputPlaceholder={t(
                                                    'invite.fields.emailPlaceholder'
                                                )}
                                                input={field.value}
                                                onChangeFunction={field.onChange}
                                                onBlur={field.onBlur}
                                                error={fieldState.error?.message}
                                                className="sm:w-full"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="mobile"
                                render={({ field, fieldState }) => (
                                    <FormItem className="space-y-1">
                                        <FormLabel className="text-subtitle font-medium">
                                            {t('invite.fields.mobile')}{' '}
                                            <span className="text-neutral-400">
                                                {t('common.optional')}
                                            </span>
                                        </FormLabel>
                                        <FormControl>
                                            <PhoneNumberInput
                                                name="mobile"
                                                label=""
                                                value={field.value ?? ''}
                                                onChange={(_, value) => field.onChange(value)}
                                                placeholder={t('invite.fields.mobilePlaceholder')}
                                                validate={false}
                                                error={fieldState.error?.message}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <p className="self-end pb-2 text-caption text-neutral-500">
                                {t('invite.fields.mobileHelp')}
                            </p>
                        </div>
                    </FormStep>

                    <div className="border-t border-dashed border-neutral-200" />

                    <FormStep
                        index={2}
                        done={rolesDone}
                        title={t('invite.steps.roles.title')}
                        description={t('invite.steps.roles.description')}
                    >
                        <RolePicker
                            variant="cards"
                            options={roleOptions}
                            value={roles ?? []}
                            personName={name}
                            onChange={(next) =>
                                form.setValue('roleType', next, {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                })
                            }
                        />
                        {teacherSelected && mode === 'new' && (
                            <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-info-50 px-3 py-2.5 text-caption text-info-700">
                                <ChalkboardTeacher size={16} className="mt-0.5 shrink-0" />
                                <span>{t('invite.teacherNote')}</span>
                            </div>
                        )}
                        {teacherSelected && mode === 'edit' && (
                            <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-neutral-50 px-3 py-2.5 text-caption text-neutral-600">
                                <Info size={16} className="mt-0.5 shrink-0" />
                                <span>{t('invite.teacherEditNote')}</span>
                            </div>
                        )}
                    </FormStep>

                    {needsBatches && (
                        <>
                            <div className="border-t border-dashed border-neutral-200" />
                            <FormStep
                                index={3}
                                done={!batchIssue}
                                title={t('invite.steps.batches.title')}
                                description={t('invite.steps.batches.description')}
                            >
                                <Suspense
                                    fallback={
                                        <div className="flex justify-center py-4">
                                            <CircleNotch className="size-6 animate-spin text-primary-500" />
                                        </div>
                                    }
                                >
                                    <LazyBatchSubjectForm />
                                </Suspense>
                                <BatchIssueWatcher
                                    control={form.control}
                                    onIssue={setBatchState}
                                    messages={{
                                        batches: t('invite.missing.batches'),
                                        subjects: t('invite.missing.subjects'),
                                    }}
                                />
                            </FormStep>
                        </>
                    )}
                </form>
            </FormProvider>
        </MyDialog>
    );
}

/**
 * Watches the teacher's batch/subject selection and reports what is still missing as a
 * plain string, so the dialog re-renders only when that message actually changes.
 */
function BatchIssueWatcher({
    control,
    onIssue,
    messages,
}: {
    control: Control<InviteFormValues>;
    onIssue: (issue: string | null | undefined) => void;
    messages: { batches: string; subjects: string };
}) {
    const mappings = useWatch({ control, name: 'batch_subject_mappings' });
    const list = mappings ?? [];
    const issue =
        list.length === 0
            ? messages.batches
            : list.some((mapping) => mapping.subjectIds.length === 0)
              ? messages.subjects
              : null;
    useEffect(() => {
        onIssue(issue);
    }, [issue, onIssue]);
    useEffect(() => () => onIssue(undefined), [onIssue]);
    return null;
}
