import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { FormProvider, useForm } from 'react-hook-form';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { MyInput } from '@/components/design-system/input';
import MultiSelectDropdown from '@/components/design-system/multiple-select-field';
import { RoleType } from '@/constants/dummy-data';
import { getInstituteId } from '@/constants/helper';
import { useMutation } from '@tanstack/react-query';
import { handleInviteUsers } from '../-services/dashboard-services';
import { useState, useEffect, lazy, Suspense } from 'react'; // Added useEffect
import { CircleNotch } from '@phosphor-icons/react';
import { mapRoleToCustomName } from '@/utils/roleUtils';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

const LazyBatchSubjectForm = lazy(() =>
    import('./BatchAndSubjectSelection').catch(() => {
        window.location.reload();
        return import('./BatchAndSubjectSelection');
    })
);

// Kept for backward compatibility: other files (InviteInstructorForm, BatchAndSubjectSelection,
// dashboard-services) import this static schema/type directly. Do not rename or remove.
export const inviteUsersSchema = z.object({
    name: z.string().min(1, 'Full name is required'),
    email: z.string().min(1, 'Email is required').email('Invalid email format'),
    roleType: z.array(z.string()).min(1, 'At least one role type is required'),
    batch_subject_mappings: z
        .array(
            z.object({
                batchId: z.string(),
                subjectIds: z.array(z.string()),
            })
        )
        .optional(),
});
export type inviteUsersFormValues = z.infer<typeof inviteUsersSchema>;

// Translated variant used internally by this component so validation messages render in the
// active locale, without changing the shape or the exported static schema above.
const buildInviteUsersSchema = (t: TFunction) =>
    z.object({
        name: z.string().min(1, t('validation.nameRequired')),
        email: z.string().min(1, t('validation.emailRequired')).email(t('validation.emailInvalid')),
        roleType: z.array(z.string()).min(1, t('validation.roleRequired')),
        batch_subject_mappings: z
            .array(
                z.object({
                    batchId: z.string(),
                    subjectIds: z.array(z.string()),
                })
            )
            .optional(),
    });

const InviteUsersComponent = ({ refetchData, availableRoles }: { refetchData: () => void; availableRoles?: { id: string; name: string }[] }) => {
    const { t } = useTranslation('dashboardInviteUsersComponent');
    const roleOptions = availableRoles || RoleType;
    const [open, setOpen] = useState(false);
    const instituteId = getInstituteId();
    const form = useForm<inviteUsersFormValues>({
        resolver: zodResolver(buildInviteUsersSchema(t)),
        defaultValues: {
            name: '',
            email: '',
            roleType: [],
            batch_subject_mappings: [],
        },
        mode: 'onChange',
    });
    const { getValues, setValue, watch } = form; // Added setValue and watch
    const isValid =
        !!getValues('name') &&
        !!getValues('email') &&
        (getValues('roleType').length > 0 ? true : false);

    const selectedRoles = watch('roleType'); // Watch roleType for changes

    useEffect(() => {
        if (selectedRoles && selectedRoles.includes('TEACHER') && selectedRoles.length > 1) {
            setValue('roleType', ['TEACHER'], { shouldValidate: true });
        }
    }, [selectedRoles, setValue]);

    const handleInviteUsersMutation = useMutation({
        mutationFn: ({
            instituteId,
            data,
        }: {
            instituteId: string | undefined;
            data: z.infer<typeof inviteUsersSchema>;
        }) => handleInviteUsers(instituteId, data),
        onSuccess: () => {
            form.reset();
            setOpen(false);
            refetchData();
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const checkIsTeacherValid = () => {
        const selectedRoles = watch('roleType'); // Watch roleType for changes
        if (selectedRoles && selectedRoles.includes('TEACHER')) {
            const batch = form.watch('batch_subject_mappings');
            if (!batch || batch.length === 0) {
                return false;
            }
            // Require at least one subject selected per batch
            return batch.every((b) => b.subjectIds && b.subjectIds.length > 0);
        }
        return true;
    };

    function onSubmit(values: inviteUsersFormValues) {
        // console.log(values)
        handleInviteUsersMutation.mutate({
            instituteId,
            data: values,
        });
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger>
                <MyButton buttonType="primary" scale="large" layoutVariant="default">
                    {t('trigger.inviteUsers')}
                </MyButton>
            </DialogTrigger>
            <DialogContent className="flex max-h-[600px] w-[420px] flex-col overflow-y-scroll p-0">{/* design-lint-ignore: compact invite-form dialog intentionally smaller than the named w-dialog-md/lg/xl tokens (all >=672px); no standard max-h-* step is close to 600px */}
                <h1 className="rounded-t-md bg-primary-50 p-4 font-semibold text-primary-500">
                    {t('dialog.title')}
                </h1>
                <FormProvider {...form}>
                    <form className="flex flex-col items-start justify-center gap-4 px-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field: { onChange, value, ...field } }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t('form.namePlaceholder')}
                                            input={value}
                                            onChangeFunction={onChange}
                                            required={true}
                                            error={form.formState.errors.name?.message}
                                            size="large"
                                            label={t('form.nameLabel')}
                                            {...field}
                                            className="w-96"
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
                                            inputPlaceholder={t('form.emailPlaceholder')}
                                            input={value}
                                            onChangeFunction={onChange}
                                            required={true}
                                            error={form.formState.errors.email?.message}
                                            size="large"
                                            label={t('form.emailLabel')}
                                            {...field}
                                            className="w-96"
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <MultiSelectDropdown
                            form={form}
                            label={t('form.roleTypeLabel')}
                            name="roleType"
                            options={roleOptions.map((option, index) => ({
                                value: option.name,
                                label: mapRoleToCustomName(option.name),
                                _id: index,
                            }))}
                            control={form.control}
                            className="w-96"
                            required
                        />
                        {/* Conditional fields for Teacher */}
                        {selectedRoles?.includes('TEACHER') && (
                            <Suspense
                                fallback={
                                    <div className="flex w-full justify-center py-4">
                                        <CircleNotch className="size-6 animate-spin text-primary-500" />
                                    </div>
                                }
                            >
                                <LazyBatchSubjectForm />
                            </Suspense>
                        )}
                        <div className="flex w-96 items-center justify-center text-center">
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="primary"
                                layoutVariant="default"
                                className="mb-6"
                                disable={!isValid || !checkIsTeacherValid()}
                                onClick={form.handleSubmit(onSubmit)}
                            >
                                {t('form.submit')}
                            </MyButton>
                        </div>
                    </form>
                </FormProvider>
            </DialogContent>
        </Dialog>
    );
};

export default InviteUsersComponent;
