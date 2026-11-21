import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FormProvider, useForm } from 'react-hook-form';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { MyInput } from '@/components/design-system/input';
import { getInstituteId } from '@/constants/helper';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { handleInviteTeachers } from '../-services/dashboard-services';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { INVITE_TEACHERS_URL, GET_INSTITUTE_USERS } from '@/constants/urls';
import { useState, useEffect, lazy, Suspense, useMemo } from 'react';
import { CircleNotch, MagnifyingGlass, UserPlus, Users } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

const LazyBatchSubjectForm = lazy(() =>
    import('./BatchAndSubjectSelection').catch(() => {
        window.location.reload();
        return import('./BatchAndSubjectSelection');
    })
);

const batchSubjectMappingsSchema = z
    .array(
        z.object({
            batchId: z.string(),
            subjectIds: z.array(z.string()),
        })
    )
    .optional();

// Static schema kept for type inference by external consumers (e.g. dashboard-services.ts
// via `z.infer<typeof inviteTeacherSchema>`). Validation messages don't affect the inferred
// shape, so this stays a plain module-level export.
export const inviteTeacherSchema = z.object({
    name: z.string().min(1, 'Full name is required'),
    email: z.string().min(1, 'Email is required').email('Invalid email format'),
    batch_subject_mappings: batchSubjectMappingsSchema,
});
export type inviteUsersFormValues = z.infer<typeof inviteTeacherSchema>;

// Translated validation schema used by the form resolver at render time.
const buildInviteTeacherSchema = (t: TFunction) =>
    z.object({
        name: z.string().min(1, t('validation.nameRequired')),
        email: z
            .string()
            .min(1, t('validation.emailRequired'))
            .email(t('validation.emailInvalid')),
        batch_subject_mappings: batchSubjectMappingsSchema,
    });

interface TeamMember {
    id: string;
    full_name: string;
    email: string | null;
    username: string | null;
    mobile_number: string | null;
}

const AddTeachers = ({
    packageSessionId,
    courseId,
}: {
    packageSessionId: string;
    courseId?: string;
}) => {
    const { t } = useTranslation('dashboardAddTeachers');
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'existing' | 'invite'>('existing');
    const instituteId = getInstituteId();
    const queryClient = useQueryClient();

    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
    const [loadingMembers, setLoadingMembers] = useState(false);

    const translatedInviteTeacherSchema = useMemo(() => buildInviteTeacherSchema(t), [t]);

    const form = useForm<inviteUsersFormValues>({
        resolver: zodResolver(translatedInviteTeacherSchema),
        defaultValues: {
            name: '',
            email: '',
            batch_subject_mappings: [],
        },
        mode: 'onChange',
    });

    // Reactive watched values — these subscribe to changes and drive button state
    const watchedName = form.watch('name');
    const watchedEmail = form.watch('email');
    const batchMappings = form.watch('batch_subject_mappings');

    const isValid = !!watchedName && !!watchedEmail;

    const isTeacherValid = useMemo(() => {
        if (!batchMappings || batchMappings.length === 0) return false;
        return batchMappings.every((b) => b.subjectIds && b.subjectIds.length > 0);
    }, [batchMappings]);

    // Derive filtered list directly — no state + effect double-render
    const filteredMembers = useMemo(() => {
        if (!searchQuery.trim()) return teamMembers;
        const q = searchQuery.toLowerCase();
        return teamMembers.filter(
            (m) =>
                m.full_name?.toLowerCase().includes(q) ||
                m.email?.toLowerCase().includes(q)
        );
    }, [teamMembers, searchQuery]);

    // Fetch institute team members once when dialog opens
    useEffect(() => {
        if (!open || !instituteId) return;
        setLoadingMembers(true);
        authenticatedAxiosInstance({
            method: 'POST',
            url: GET_INSTITUTE_USERS,
            params: { instituteId, pageNumber: 0, pageSize: 100 },
            data: { roles: ['TEACHER', 'ADMIN'], status: ['ACTIVE'] },
        })
            .then((res) => {
                const data = res.data;
                const rawList = Array.isArray(data) ? data : data?.content || [];
                setTeamMembers(
                    rawList.map((u: Record<string, unknown>) => ({
                        id: u.id as string,
                        full_name: u.full_name as string,
                        email: (u.email as string) || null,
                        username: (u.username as string) || null,
                        mobile_number: (u.mobile_number as string) || null,
                    }))
                );
            })
            .catch(() => setTeamMembers([]))
            .finally(() => setLoadingMembers(false));
    }, [open, instituteId]);

    const handleInviteUsersMutation = useMutation({
        mutationFn: ({
            instituteId,
            data,
        }: {
            instituteId: string | undefined;
            data: z.infer<typeof inviteTeacherSchema>;
        }) => handleInviteTeachers(instituteId, data),
        onSuccess: () => {
            form.reset();
            queryClient.invalidateQueries({ queryKey: ['facultyList'] });
            setOpen(false);
        },
        onError: () => {},
    });

    const assignExistingMutation = useMutation({
        mutationFn: ({
            instituteId,
            member,
        }: {
            instituteId: string | undefined;
            member: TeamMember;
        }) => {
            const mappings = form.getValues('batch_subject_mappings') || [];
            const payload = {
                user: {
                    id: member.id,
                    full_name: member.full_name,
                    email: member.email || '',
                    roles: ['TEACHER'],
                    root_user: false,
                },
                batch_subject_mappings: mappings.map((batch) => ({
                    batch_id: batch.batchId,
                    subject_ids: batch.subjectIds,
                })),
                new_user: false,
            };
            return authenticatedAxiosInstance({
                method: 'POST',
                url: INVITE_TEACHERS_URL,
                params: { instituteId },
                data: payload,
            }).then((res) => res.data);
        },
        onSuccess: () => {
            setSelectedMember(null);
            queryClient.invalidateQueries({ queryKey: ['facultyList'] });
            setOpen(false);
        },
    });

    function onSubmit(values: inviteUsersFormValues) {
        handleInviteUsersMutation.mutate({ instituteId, data: values });
    }

    function onAssignExisting() {
        if (!selectedMember) return;
        assignExistingMutation.mutate({ instituteId, member: selectedMember });
    }

    const handleOpenChange = (isOpen: boolean) => {
        setOpen(isOpen);
        if (!isOpen) {
            setSelectedMember(null);
            setSearchQuery('');
            setActiveTab('existing');
            form.reset();
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger>
                <MyButton buttonType="primary" scale="large" layoutVariant="default">
                    {t('trigger.inviteUsers')}
                </MyButton>
            </DialogTrigger>
            <DialogContent className="flex max-h-dialog-tall w-dialog-md flex-col overflow-hidden p-0">
                <DialogTitle className="rounded-t-md bg-primary-50 p-4 font-semibold text-primary-500">
                    {t('dialog.title')}
                </DialogTitle>

                {/* Tab Switcher */}
                <div className="flex border-b border-neutral-200 px-4">
                    <button
                        type="button"
                        className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                            activeTab === 'existing'
                                ? 'border-primary-500 text-primary-500'
                                : 'border-transparent text-neutral-500 hover:text-neutral-700'
                        }`}
                        onClick={() => setActiveTab('existing')}
                    >
                        <Users className="size-4" />
                        {t('tabs.existingMembers')}
                    </button>
                    <button
                        type="button"
                        className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                            activeTab === 'invite'
                                ? 'border-primary-500 text-primary-500'
                                : 'border-transparent text-neutral-500 hover:text-neutral-700'
                        }`}
                        onClick={() => setActiveTab('invite')}
                    >
                        <UserPlus className="size-4" />
                        {t('tabs.inviteNew')}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {activeTab === 'existing' ? (
                        <div className="flex flex-col gap-3 p-4">
                            {/* Search */}
                            <div className="relative">
                                <MagnifyingGlass className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                                <input
                                    type="text"
                                    placeholder={t('existing.searchPlaceholder')}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full rounded-lg border border-neutral-200 py-2.5 pl-10 pr-3 text-sm outline-none transition-colors focus:border-primary-400 focus:ring-1 focus:ring-primary-200"
                                />
                            </div>

                            {/* Member List */}
                            <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200">
                                {loadingMembers ? (
                                    <div className="flex items-center justify-center py-8">
                                        <CircleNotch className="size-5 animate-spin text-primary-500" />
                                    </div>
                                ) : filteredMembers.length === 0 ? (
                                    <div className="py-6 text-center text-sm text-neutral-400">
                                        {searchQuery
                                            ? t('existing.noMatchingMembers')
                                            : t('existing.noMembersAvailable')}
                                    </div>
                                ) : (
                                    filteredMembers.map((member) => (
                                        <button
                                            key={member.id}
                                            type="button"
                                            className={`flex w-full items-center gap-3 border-b border-neutral-100 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                                                selectedMember?.id === member.id
                                                    ? 'bg-primary-50'
                                                    : 'hover:bg-neutral-50'
                                            }`}
                                            onClick={() => setSelectedMember(member)}
                                        >
                                            <div
                                                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                                                    selectedMember?.id === member.id
                                                        ? 'bg-primary-500 text-white'
                                                        : 'bg-neutral-100 text-neutral-600'
                                                }`}
                                            >
                                                {member.full_name?.charAt(0)?.toUpperCase() || '?'}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium text-neutral-800">
                                                    {member.full_name}
                                                </p>
                                                {member.email && (
                                                    <p className="truncate text-xs text-neutral-500">
                                                        {member.email}
                                                    </p>
                                                )}
                                            </div>
                                            {selectedMember?.id === member.id && (
                                                <div className="size-2 shrink-0 rounded-full bg-primary-500" />
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>

                            {/* Batch/Subject Selection for selected member */}
                            {selectedMember && (
                                <FormProvider {...form}>
                                    <form className="flex flex-col gap-3">
                                        <Suspense
                                            fallback={
                                                <div className="flex w-full justify-center py-4">
                                                    <CircleNotch className="size-6 animate-spin text-primary-500" />
                                                </div>
                                            }
                                        >
                                            <LazyBatchSubjectForm
                                                initialBatchId={packageSessionId}
                                                courseId={courseId}
                                            />
                                        </Suspense>
                                    </form>
                                </FormProvider>
                            )}
                        </div>
                    ) : (
                        <FormProvider {...form}>
                            <form className="flex flex-col items-start justify-center gap-4 p-4">
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field: { onChange, value, ...field } }) => (
                                        <FormItem>
                                            <FormControl>
                                                <MyInput
                                                    inputType="text"
                                                    inputPlaceholder={t('invite.form.namePlaceholder')}
                                                    input={value}
                                                    onChangeFunction={onChange}
                                                    required={true}
                                                    error={form.formState.errors.name?.message}
                                                    size="large"
                                                    label={t('invite.form.nameLabel')}
                                                    {...field}
                                                    className="w-full"
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="email"
                                    render={({ field: { onChange, value, ...field } }) => (
                                        <FormItem>
                                            <FormControl>
                                                <MyInput
                                                    inputType="email"
                                                    inputPlaceholder={t('invite.form.emailPlaceholder')}
                                                    input={value}
                                                    onChangeFunction={onChange}
                                                    required={true}
                                                    error={form.formState.errors.email?.message}
                                                    size="large"
                                                    label={t('invite.form.emailLabel')}
                                                    {...field}
                                                    className="w-full"
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <Suspense
                                    fallback={
                                        <div className="flex w-full justify-center py-4">
                                            <CircleNotch className="size-6 animate-spin text-primary-500" />
                                        </div>
                                    }
                                >
                                    <LazyBatchSubjectForm
                                        initialBatchId={packageSessionId}
                                        courseId={courseId}
                                    />
                                </Suspense>
                            </form>
                        </FormProvider>
                    )}
                </div>

                {/* Always-visible footer with action button */}
                {activeTab === 'existing' && selectedMember && (
                    <div className="border-t border-neutral-200 p-4">
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            layoutVariant="default"
                            className="w-full"
                            disable={!isTeacherValid || assignExistingMutation.isPending}
                            onClick={onAssignExisting}
                        >
                            {assignExistingMutation.isPending ? (
                                <CircleNotch className="size-4 animate-spin" />
                            ) : (
                                t('existing.assignButton', { name: selectedMember.full_name })
                            )}
                        </MyButton>
                    </div>
                )}
                {activeTab === 'invite' && (
                    <div className="border-t border-neutral-200 p-4">
                        <div className="flex w-full items-center justify-center">
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="primary"
                                layoutVariant="default"
                                disable={!isValid || !isTeacherValid}
                                onClick={form.handleSubmit(onSubmit)}
                            >
                                {t('invite.inviteButton')}
                            </MyButton>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default AddTeachers;
