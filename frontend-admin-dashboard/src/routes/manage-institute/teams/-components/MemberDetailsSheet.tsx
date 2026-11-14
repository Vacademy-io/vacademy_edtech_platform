import { useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ArrowClockwise,
    Buildings,
    Camera,
    Check,
    CheckCircle,
    CircleNotch,
    Copy,
    Info,
    Key,
    Prohibit,
    Trash,
    UploadSimple,
    Users,
} from '@phosphor-icons/react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import PhoneNumberInput from '@/components/design-system/phone-number-input';
import { Textarea } from '@/components/ui/textarea';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { isBlankPhone, validatePhoneField } from '@/lib/phone-validation';
import { getPreferredPhoneCountries } from '@/services/domain-routing';
import { getPublicUrl } from '@/services/upload_file';
import { UploadFileInS3Public } from '@/routes/signup/-services/signup-services';
import {
    assignUserToSubOrg,
    removeSubOrgTeamMember,
    type AccessibleSubOrg,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import {
    formatPhoneForDisplay,
    hasNeverSignedIn,
    instituteRolesOf,
    toPhoneInputValue,
    type TeamMember,
    type TeamRoleOption,
} from '../-utils/team-helpers';
import { updateTeamMemberDetails } from '../-services/team-member-services';
import { RolePicker } from './RolePicker';
import { TeamConfirmDialog } from './TeamConfirmDialog';
import { CheckMark, MemberAvatar, MemberStatusPill, RoleChip } from './team-ui';

export type MemberSection = 'profile' | 'access' | 'login' | 'account';
const SECTIONS: MemberSection[] = ['profile', 'access', 'login', 'account'];

// A disabled member arrives with no visible roles (see memberStatusOf), so "keep at least
// one role" only applies while access is on — otherwise their profile could never be saved.
const buildSchema = (t: TFunction, requireRole: boolean) =>
    z.object({
        name: z.string().trim().min(1, t('member.validation.nameRequired')),
        email: z
            .string()
            .trim()
            .min(1, t('member.validation.emailRequired'))
            .email(t('member.validation.emailInvalid')),
        mobile: z
            .string()
            .optional()
            .refine((value) => validatePhoneField(value) === undefined, {
                message: t('member.validation.phoneInvalid'),
            }),
        designation: z.string().max(255),
        bio: z.string(),
        photoId: z.string().nullable(),
        roles: requireRole
            ? z.array(z.string()).min(1, t('member.validation.roleRequired'))
            : z.array(z.string()),
        subOrgs: z.array(z.string()),
    });
type MemberFormValues = z.infer<ReturnType<typeof buildSchema>>;

interface MemberDetailsSheetProps {
    member: TeamMember | null;
    initialSection?: MemberSection;
    onClose: () => void;
    instituteId: string;
    roleOptions: TeamRoleOption[];
    canEditProfile: boolean;
    allowViewPassword: boolean;
    /** Sub-org assignment (only where partners exist and the viewer may manage them). */
    subOrgs: AccessibleSubOrg[];
    canAssignSubOrgs: boolean;
    /** Partners this person is individually linked to. */
    directSubOrgIds: string[];
    /** roleId -> sub-org ids that role grants (Display Settings → role → partners). */
    roleGrantMap: Map<string, string[]>;
    subOrgTerm: string;
    onRequestStatus: (kind: 'disable' | 'enable' | 'delete' | 'resend', member: TeamMember) => void;
    onCopyLogin: (member: TeamMember) => void;
}

/**
 * Right-side panel for one team member: profile, roles and sub-org access, login
 * details and account status, saved together from one footer.
 */
export function MemberDetailsSheet({
    member,
    initialSection,
    onClose,
    instituteId,
    roleOptions,
    canEditProfile,
    allowViewPassword,
    subOrgs,
    canAssignSubOrgs,
    directSubOrgIds,
    roleGrantMap,
    subOrgTerm,
    onRequestStatus,
    onCopyLogin,
}: MemberDetailsSheetProps) {
    const { t } = useTranslation('manageInstituteTeamsIndexLazy');
    const queryClient = useQueryClient();
    const defaultCountry = useMemo(() => getPreferredPhoneCountries().defaultCountry, []);
    const scrollRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const [activeSection, setActiveSection] = useState<MemberSection>('profile');
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);

    // Roles this picker can't show (hidden from the viewer, legacy) stay untouched.
    const pickerNames = useMemo(() => new Set(roleOptions.map((o) => o.name)), [roleOptions]);
    const memberRoles = useMemo(
        () => (member ? instituteRolesOf(member, instituteId) : []),
        [member, instituteId]
    );
    const isDisabled = member?.status === 'DISABLED';

    const defaults = useMemo<MemberFormValues>(
        () => ({
            name: member?.full_name ?? '',
            email: member?.email ?? '',
            mobile: toPhoneInputValue(member?.mobile_number, defaultCountry),
            designation: member?.author_subtitle ?? '',
            bio: member?.author_description ?? '',
            photoId: member?.profile_pic_file_id ?? null,
            roles: memberRoles.map((r) => r.role_name).filter((name) => pickerNames.has(name)),
            subOrgs: directSubOrgIds,
        }),
        [member, memberRoles, pickerNames, directSubOrgIds, defaultCountry]
    );

    const form = useForm<MemberFormValues>({
        resolver: zodResolver(buildSchema(t, !isDisabled)),
        defaultValues: defaults,
        mode: 'onChange',
    });

    useEffect(() => {
        form.reset(defaults);
        setConfirmDiscard(false);
        // When a different member opens, or access is switched on/off from here (their roles
        // reappear or vanish). Ordinary refetches must not wipe an in-progress edit.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [member?.id, member?.status, memberRoles.length]);

    const [name, photoId, roles, selectedSubOrgs, bio] = useWatch({
        control: form.control,
        name: ['name', 'photoId', 'roles', 'subOrgs', 'bio'],
    });

    useEffect(() => {
        if (!photoId) {
            setPhotoUrl(null);
            return;
        }
        let cancelled = false;
        getPublicUrl(photoId)
            .then((url) => !cancelled && setPhotoUrl(url || null))
            .catch(() => !cancelled && setPhotoUrl(null));
        return () => {
            cancelled = true;
        };
    }, [photoId]);

    useEffect(() => {
        if (!member || !initialSection) return;
        const id = window.setTimeout(() => jumpTo(initialSection), 80);
        return () => window.clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [member?.id, initialSection]);

    const jumpTo = (section: MemberSection) => {
        const container = scrollRef.current;
        const target = container?.querySelector<HTMLElement>(`[data-section="${section}"]`);
        if (!container || !target) return;
        const nav = container.querySelector<HTMLElement>('[data-section-nav]');
        container.scrollTo({
            top: target.offsetTop - (nav?.offsetHeight ?? 0),
            behavior: 'smooth',
        });
        setActiveSection(section);
    };

    const onScroll = () => {
        const container = scrollRef.current;
        if (!container) return;
        const nav = container.querySelector<HTMLElement>('[data-section-nav]');
        const offset = container.scrollTop + (nav?.offsetHeight ?? 0) + 24;
        let current: MemberSection = 'profile';
        SECTIONS.forEach((section) => {
            const el = container.querySelector<HTMLElement>(`[data-section="${section}"]`);
            if (el && el.offsetTop <= offset) current = section;
        });
        setActiveSection(current);
    };

    // Sub-orgs reached through a role: shown ticked and locked, changed on the role.
    const viaRole = useMemo(() => {
        const out = new Map<string, string>();
        (roles ?? []).forEach((roleName) => {
            const option = roleOptions.find((o) => o.name === roleName);
            if (!option) return;
            (roleGrantMap.get(option.id) ?? []).forEach((subOrgId) => {
                if (!out.has(subOrgId)) out.set(subOrgId, option.label);
            });
        });
        return out;
    }, [roles, roleOptions, roleGrantMap]);

    const save = useMutation({
        mutationFn: async (values: MemberFormValues) => {
            if (!member) return;
            const removedRoleIds = memberRoles
                .filter((r) => pickerNames.has(r.role_name) && !values.roles.includes(r.role_name))
                .map((r) => r.id);
            const heldNames = new Set(memberRoles.map((r) => r.role_name));
            const addedRoles = values.roles.filter((name) => !heldNames.has(name));
            const phoneOf = (value?: string) => (isBlankPhone(value) ? '' : value ?? '');
            const profileDirty =
                canEditProfile &&
                (values.name.trim() !== defaults.name.trim() ||
                    values.email.trim() !== defaults.email.trim() ||
                    phoneOf(values.mobile) !== phoneOf(defaults.mobile) ||
                    values.designation.trim() !== defaults.designation.trim() ||
                    values.bio.trim() !== defaults.bio.trim() ||
                    values.photoId !== defaults.photoId);

            if (profileDirty || removedRoleIds.length > 0 || addedRoles.length > 0) {
                await updateTeamMemberDetails(instituteId, member.id, {
                    ...(canEditProfile
                        ? {
                              full_name: values.name.trim(),
                              email: values.email.trim(),
                              mobile_number: isBlankPhone(values.mobile) ? '' : values.mobile,
                              // Empty strings deliberately clear a saved designation/bio.
                              author_subtitle: values.designation.trim(),
                              author_description: values.bio.trim(),
                          }
                        : {}),
                    profile_pic_file_id: canEditProfile
                        ? values.photoId
                        : member.profile_pic_file_id,
                    delete_user_role_request: removedRoleIds,
                    add_user_role_request: addedRoles,
                });
            }

            // Sequential on purpose (same as the assign dialog): each call writes access
            // rows for the same user, and a partial failure should stop, not race.
            const added = values.subOrgs.filter((id) => !directSubOrgIds.includes(id));
            const removed = directSubOrgIds.filter((id) => !values.subOrgs.includes(id));
            for (const subOrgId of added) {
                await assignUserToSubOrg({
                    sub_org_id: subOrgId,
                    institute_id: instituteId,
                    user_id: member.id,
                });
            }
            for (const subOrgId of removed) {
                await removeSubOrgTeamMember({
                    sub_org_id: subOrgId,
                    institute_id: instituteId,
                    user_id: member.id,
                    mode: 'HARD',
                });
            }
        },
        onSuccess: (_, values) => {
            queryClient.invalidateQueries({ queryKey: ['TEAM_MEMBERS'] });
            queryClient.invalidateQueries({ queryKey: ['TEAM_COUNTS'] });
            queryClient.invalidateQueries({ queryKey: ['SUB_ORG_USER_LINKS', instituteId] });
            toast.success(t('member.toast.saved', { name: values.name.trim() }));
            form.reset(values);
            onClose();
        },
        onError: (error) => {
            const message = (error as { response?: { data?: { ex?: string } } })?.response?.data
                ?.ex;
            toast.error(message || t('member.toast.saveFailed'));
        },
    });

    const uploadPhoto = async (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error(t('member.toast.notImage'));
            return;
        }
        try {
            setUploading(true);
            const fileId = await UploadFileInS3Public(
                file,
                () => undefined,
                instituteId,
                'STUDENTS'
            );
            if (!fileId) throw new Error('no file id');
            form.setValue('photoId', fileId, { shouldDirty: true });
        } catch {
            toast.error(t('member.toast.uploadFailed'));
        } finally {
            setUploading(false);
        }
    };

    const dirty = form.formState.isDirty;
    const requestClose = () => {
        if (save.isPending) return;
        if (dirty) setConfirmDiscard(true);
        else onClose();
    };

    if (!member) return null;
    const firstName = member.full_name?.trim().split(/\s+/)[0] || member.full_name;
    const phoneLabel = formatPhoneForDisplay(member.mobile_number, defaultCountry);
    const optionOf = (roleName: string) => roleOptions.find((o) => o.name === roleName);
    const showSubOrgs = canAssignSubOrgs && subOrgs.length > 0;

    const sectionTitle = (title: string, description: string) => (
        <div className="mb-4">
            <h3 className="text-subtitle font-semibold text-neutral-900">{title}</h3>
            <p className="text-caption text-neutral-500">{description}</p>
        </div>
    );

    return (
        <Sheet open onOpenChange={(open) => !open && requestClose()}>
            <SheetContent
                side="right"
                className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
                onEscapeKeyDown={(event) => {
                    if (dirty) {
                        event.preventDefault();
                        requestClose();
                    }
                }}
            >
                <div className="flex items-center gap-2 border-b border-neutral-100 px-6 py-4 pe-12 text-caption text-neutral-500">
                    <Users size={15} />
                    {t('member.breadcrumb')}
                    <span>/</span>
                    <span className="font-semibold text-neutral-800">{t('member.title')}</span>
                    {/* Accessible name only: SheetTitle's own text-lg can't be overridden by a token. */}
                    <SheetTitle className="sr-only">{t('member.title')}</SheetTitle>
                    <SheetDescription className="sr-only">
                        {t('member.srDescription', { name: member.full_name })}
                    </SheetDescription>
                </div>

                <div
                    ref={scrollRef}
                    onScroll={onScroll}
                    className="relative flex-1 overflow-y-auto"
                >
                    <div className="flex items-center gap-5 bg-gradient-to-b from-primary-50 to-white px-6 pb-5 pt-6">
                        <div className="relative shrink-0">
                            <MemberAvatar
                                name={name || member.full_name}
                                photoUrl={photoUrl}
                                size="xl"
                            />
                            {canEditProfile && (
                                <button
                                    type="button"
                                    aria-label={t('member.photo.change')}
                                    onClick={() => fileRef.current?.click()}
                                    className="absolute -bottom-0.5 -right-0.5 flex size-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:border-primary-300 hover:text-primary-500"
                                >
                                    {uploading ? (
                                        <CircleNotch size={15} className="animate-spin" />
                                    ) : (
                                        <Camera size={15} />
                                    )}
                                </button>
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <h2 className="truncate text-h3 font-semibold text-neutral-900">
                                    {name || member.full_name}
                                </h2>
                            </div>
                            <p className="truncate text-caption text-neutral-500">
                                {member.email}
                                {phoneLabel ? ` · ${phoneLabel}` : ''}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <MemberStatusPill status={member.status} />
                                {memberRoles.map((role) => (
                                    <RoleChip
                                        key={role.id}
                                        name={role.role_name}
                                        option={optionOf(role.role_name)}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    <nav
                        data-section-nav
                        className="sticky top-0 z-10 flex gap-1 border-b border-neutral-200 bg-white px-6"
                    >
                        {SECTIONS.map((section) => (
                            <button
                                key={section}
                                type="button"
                                onClick={() => jumpTo(section)}
                                className={`text-caption ${cn(
                                    '-mb-px border-b-2 px-2.5 py-2.5 font-semibold transition-colors',
                                    activeSection === section
                                        ? 'border-primary-500 text-primary-500'
                                        : 'border-transparent text-neutral-500 hover:text-neutral-900'
                                )}`}
                            >
                                {t(`member.sections.${section}`)}
                            </button>
                        ))}
                    </nav>

                    <FormProvider {...form}>
                        <form onSubmit={(event) => event.preventDefault()}>
                            {/* Profile */}
                            <section
                                data-section="profile"
                                className="border-b border-neutral-100 p-6"
                            >
                                {sectionTitle(
                                    t('member.sections.profile'),
                                    t('member.profileHint', { name: firstName })
                                )}
                                {!canEditProfile && (
                                    <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-caption text-neutral-600">
                                        <Info size={16} className="mt-0.5 shrink-0" />
                                        {t('member.profileReadOnly')}
                                    </div>
                                )}
                                {canEditProfile && (
                                    <div className="mb-5">
                                        <div className="mb-1.5 text-subtitle text-neutral-700">
                                            {t('member.photo.label')}{' '}
                                            <span className="text-neutral-400">
                                                {t('common.optional')}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="small"
                                                disable={uploading}
                                                onClick={() => fileRef.current?.click()}
                                            >
                                                <UploadSimple size={14} />
                                                {photoId
                                                    ? t('member.photo.replace')
                                                    : t('member.photo.upload')}
                                            </MyButton>
                                            {photoId && (
                                                <MyButton
                                                    type="button"
                                                    buttonType="text"
                                                    scale="small"
                                                    onClick={() =>
                                                        form.setValue('photoId', null, {
                                                            shouldDirty: true,
                                                        })
                                                    }
                                                >
                                                    {t('member.photo.remove')}
                                                </MyButton>
                                            )}
                                        </div>
                                        <p className="mt-1 text-caption text-neutral-500">
                                            {t('member.photo.help')}
                                        </p>
                                        <input
                                            ref={fileRef}
                                            type="file"
                                            accept="image/*"
                                            hidden
                                            onChange={(event) => {
                                                void uploadPhoto(event.target.files?.[0]);
                                                event.target.value = '';
                                            }}
                                        />
                                    </div>
                                )}
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field, fieldState }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <MyInput
                                                        inputType="text"
                                                        label={t('member.fields.name')}
                                                        required
                                                        size="large"
                                                        disabled={!canEditProfile}
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
                                                        label={t('member.fields.email')}
                                                        required
                                                        size="large"
                                                        disabled={!canEditProfile}
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
                                                    {t('member.fields.mobile')}{' '}
                                                    <span className="text-neutral-400">
                                                        {t('common.optional')}
                                                    </span>
                                                </FormLabel>
                                                <FormControl>
                                                    <PhoneNumberInput
                                                        name="mobile"
                                                        label=""
                                                        value={field.value ?? ''}
                                                        onChange={(_, value) =>
                                                            field.onChange(value)
                                                        }
                                                        disabled={!canEditProfile}
                                                        validate={false}
                                                        error={fieldState.error?.message}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="designation"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1">
                                                <FormLabel className="text-subtitle font-medium">
                                                    {t('member.fields.designation')}{' '}
                                                    <span className="text-neutral-400">
                                                        {t('common.optional')}
                                                    </span>
                                                </FormLabel>
                                                <FormControl>
                                                    <MyInput
                                                        inputType="text"
                                                        size="large"
                                                        maxLength={255}
                                                        disabled={!canEditProfile}
                                                        inputPlaceholder={t(
                                                            'member.fields.designationPlaceholder'
                                                        )}
                                                        input={field.value}
                                                        onChangeFunction={field.onChange}
                                                        className="sm:w-full"
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <FormField
                                    control={form.control}
                                    name="bio"
                                    render={({ field }) => (
                                        <FormItem className="mt-4 space-y-1">
                                            <FormLabel className="flex items-center justify-between text-subtitle font-medium">
                                                <span>
                                                    {t('member.fields.bio')}{' '}
                                                    <span className="text-neutral-400">
                                                        {t('common.optional')}
                                                    </span>
                                                </span>
                                                <span className="text-caption text-neutral-400">
                                                    {t('member.fields.bioCount', {
                                                        count: (bio ?? '').length,
                                                    })}
                                                </span>
                                            </FormLabel>
                                            <FormControl>
                                                <Textarea
                                                    {...field}
                                                    rows={4}
                                                    disabled={!canEditProfile}
                                                    placeholder={t('member.fields.bioPlaceholder', {
                                                        name: firstName,
                                                    })}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </section>

                            {/* Role & access */}
                            <section
                                data-section="access"
                                className="border-b border-neutral-100 p-6"
                            >
                                {sectionTitle(
                                    t('member.sections.access'),
                                    t('member.accessHint', { name: firstName })
                                )}
                                {isDisabled && (
                                    <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-warning-50 px-3 py-2.5 text-caption text-warning-700">
                                        <Info size={16} className="mt-0.5 shrink-0" />
                                        {t('member.rolesLockedWhileDisabled')}
                                    </div>
                                )}
                                <RolePicker
                                    variant="chips"
                                    options={roleOptions}
                                    value={roles ?? []}
                                    personName={name}
                                    disabled={isDisabled}
                                    onChange={(next) =>
                                        form.setValue('roles', next, {
                                            shouldDirty: true,
                                            shouldValidate: true,
                                        })
                                    }
                                />
                                {form.formState.errors.roles?.message && (
                                    <p className="mt-2 text-caption text-danger-600">
                                        {form.formState.errors.roles.message}
                                    </p>
                                )}

                                {showSubOrgs && (
                                    <div className="mt-6">
                                        <div className="mb-2 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                            {subOrgTerm}
                                            <span className="ms-1 font-normal normal-case tracking-normal text-neutral-400">
                                                {t('common.optional')}
                                            </span>
                                        </div>
                                        <div className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200">
                                            {subOrgs.map((subOrg) => {
                                                const grantedBy = viaRole.get(subOrg.id);
                                                if (
                                                    grantedBy &&
                                                    !(selectedSubOrgs ?? []).includes(subOrg.id)
                                                ) {
                                                    return (
                                                        <div
                                                            key={subOrg.id}
                                                            className="flex items-center gap-3 px-3 py-2.5"
                                                        >
                                                            <span className="flex size-4 items-center justify-center rounded-sm bg-neutral-200 text-neutral-500">
                                                                <Check size={11} weight="bold" />
                                                            </span>
                                                            <Buildings
                                                                size={16}
                                                                className="text-neutral-400"
                                                            />
                                                            <span className="text-body font-semibold text-neutral-900">
                                                                {subOrg.name}
                                                            </span>
                                                            <span className="ms-auto text-caption text-neutral-400">
                                                                {t('member.viaRole', {
                                                                    role: grantedBy,
                                                                })}
                                                            </span>
                                                        </div>
                                                    );
                                                }
                                                const checked = (selectedSubOrgs ?? []).includes(
                                                    subOrg.id
                                                );
                                                return (
                                                    <button
                                                        key={subOrg.id}
                                                        type="button"
                                                        aria-pressed={checked}
                                                        onClick={() =>
                                                            form.setValue(
                                                                'subOrgs',
                                                                checked
                                                                    ? (
                                                                          selectedSubOrgs ?? []
                                                                      ).filter(
                                                                          (id) => id !== subOrg.id
                                                                      )
                                                                    : [
                                                                          ...(selectedSubOrgs ??
                                                                              []),
                                                                          subOrg.id,
                                                                      ],
                                                                { shouldDirty: true }
                                                            )
                                                        }
                                                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-neutral-50"
                                                    >
                                                        <CheckMark checked={checked} />
                                                        <Buildings
                                                            size={16}
                                                            className="text-neutral-400"
                                                        />
                                                        <span className="text-body font-semibold text-neutral-900">
                                                            {subOrg.name}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {viaRole.size > 0 && (
                                            <p className="mt-2 text-caption text-neutral-500">
                                                {t('member.viaRoleHelp')}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </section>
                        </form>
                    </FormProvider>

                    {/* Login */}
                    <section data-section="login" className="border-b border-neutral-100 p-6">
                        {sectionTitle(t('member.sections.login'), t('member.loginHint'))}
                        <LoginRow label={t('columns.username')} value={member.username} />
                        {allowViewPassword && (
                            <LoginRow
                                label={t('columns.password')}
                                value={member.password ?? null}
                            />
                        )}
                        {allowViewPassword && member.password && (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                className="mt-1"
                                onClick={() => onCopyLogin(member)}
                            >
                                <Key size={14} />
                                {t('login.copyDetails')}
                            </MyButton>
                        )}
                        {!isDisabled && hasNeverSignedIn(member) && (
                            <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                                <div className="min-w-0">
                                    <div className="text-body font-semibold text-neutral-900">
                                        {t('status.notSignedIn')}
                                    </div>
                                    <p className="text-caption text-neutral-500">
                                        {t('member.notSignedInHint', { name: firstName })}
                                    </p>
                                </div>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => onRequestStatus('resend', member)}
                                >
                                    <ArrowClockwise size={14} />
                                    {t('actions.resendShort')}
                                </MyButton>
                            </div>
                        )}
                    </section>

                    {/* Account */}
                    <section data-section="account" className="p-6">
                        {sectionTitle(
                            t('member.sections.account'),
                            t('member.accountHint', { name: firstName })
                        )}
                        <div className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 px-4 py-3.5">
                            <div>
                                <div className="flex items-center gap-2 text-body font-semibold text-neutral-900">
                                    {isDisabled ? t('member.accessPaused') : t('member.accessOn')}
                                    <MemberStatusPill status={member.status} />
                                </div>
                                <p className="text-caption text-neutral-500">
                                    {isDisabled
                                        ? t('member.accessPausedHint', { name: firstName })
                                        : t('member.accessOnHint', { name: firstName })}
                                </p>
                            </div>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() =>
                                    onRequestStatus(isDisabled ? 'enable' : 'disable', member)
                                }
                            >
                                {isDisabled ? <CheckCircle size={14} /> : <Prohibit size={14} />}
                                {isDisabled ? t('actions.enable') : t('actions.disable')}
                            </MyButton>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-danger-300 bg-danger-50 px-4 py-3.5">
                            <div>
                                <div className="flex items-center gap-2 text-body font-semibold text-danger-700">
                                    <Trash size={16} />
                                    {t('actions.delete')}
                                </div>
                                <p className="text-caption text-neutral-600">
                                    {t('member.deleteHint', { name: firstName })}
                                </p>
                            </div>
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                className="bg-danger-600 hover:bg-danger-700 active:bg-danger-700"
                                onClick={() => onRequestStatus('delete', member)}
                            >
                                {t('actions.deleteShort')}
                            </MyButton>
                        </div>
                    </section>
                </div>

                <div className="flex items-center gap-3 border-t border-neutral-200 bg-white px-6 py-4">
                    {dirty ? (
                        <span className="flex items-center gap-2 text-caption font-semibold text-warning-700">
                            <span className="size-2 rounded-full bg-warning-500" />
                            {t('member.unsaved')}
                        </span>
                    ) : (
                        <span className="flex items-center gap-1.5 text-caption text-neutral-400">
                            <CheckCircle size={15} />
                            {t('member.noChanges')}
                        </span>
                    )}
                    <div className="flex-1" />
                    <MyButton
                        buttonType="secondary"
                        disable={save.isPending}
                        onClick={requestClose}
                    >
                        {dirty ? t('common.cancel') : t('common.close')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        disable={!dirty || save.isPending || uploading}
                        onClick={form.handleSubmit((values) => save.mutate(values))}
                    >
                        {save.isPending ? (
                            <CircleNotch size={16} className="animate-spin" />
                        ) : (
                            <Check size={16} weight="bold" />
                        )}
                        {t('member.save')}
                    </MyButton>
                </div>
            </SheetContent>

            <TeamConfirmDialog
                kind={confirmDiscard ? 'discard' : null}
                name={member.full_name}
                onClose={() => setConfirmDiscard(false)}
                onConfirm={() => {
                    setConfirmDiscard(false);
                    form.reset(defaults);
                    onClose();
                }}
            />
        </Sheet>
    );
}

function LoginRow({ label, value }: { label: string; value: string | null }) {
    const { t } = useTranslation('manageInstituteTeamsIndexLazy');
    const copy = async () => {
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            toast.success(t('login.valueCopied', { label }));
        } catch {
            toast.error(t('login.copyFailed'));
        }
    };
    return (
        <div className="mb-2 flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
            <span className="w-24 shrink-0 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                {label}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-body text-neutral-800">
                {value || '—'}
            </span>
            {value && (
                <MyButton
                    buttonType="text"
                    scale="small"
                    layoutVariant="icon"
                    aria-label={t('login.copyValue', { label })}
                    onClick={copy}
                >
                    <Copy size={15} />
                </MyButton>
            )}
        </div>
    );
}
