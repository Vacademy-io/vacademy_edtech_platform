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
import { useState } from 'react';
import { handleInviteUsers } from '@/routes/dashboard/-services/dashboard-services';
import { mapRoleToCustomName } from '@/utils/roleUtils';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

export const buildInviteUsersSchema = (t: TFunction) =>
    z.object({
        name: z.string().min(1, t('validation.nameRequired')),
        email: z.string().min(1, t('validation.emailRequired')).email(t('validation.invalidEmail')),
        roleType: z.array(z.string()).min(1, t('validation.roleTypeRequired')),
    });
export type inviteUsersFormValues = z.infer<ReturnType<typeof buildInviteUsersSchema>>;

const Step4InviteUsers = ({ refetchData }: { refetchData: () => void }) => {
    const { t } = useTranslation('homeworkCreationStep4InviteUsers');
    const [open, setOpen] = useState(false);
    const instituteId = getInstituteId();
    const inviteUsersSchema = buildInviteUsersSchema(t);
    const form = useForm<inviteUsersFormValues>({
        resolver: zodResolver(inviteUsersSchema),
        defaultValues: {
            name: '',
            email: '',
            roleType: [],
        },
        mode: 'onChange',
    });
    const { getValues } = form;
    const isValid =
        !!getValues('name') &&
        !!getValues('email') &&
        (getValues('roleType').length > 0 ? true : false);

    form.watch('roleType');

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

    function onSubmit(values: inviteUsersFormValues) {
        handleInviteUsersMutation.mutate({
            instituteId,
            data: values,
        });
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger>
                <MyButton buttonType="secondary" scale="large" layoutVariant="default">
                    {t('trigger.inviteUsers')}
                </MyButton>
            </DialogTrigger>
            <DialogContent className="flex w-[420px] flex-col p-0">{/* design-lint-ignore: compact invite-form dialog intentionally smaller than the named w-dialog-md/lg/xl tokens (all >=672px) */}
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
                                            inputPlaceholder={t('dialog.fullNamePlaceholder')}
                                            input={value}
                                            onChangeFunction={onChange}
                                            required={true}
                                            error={form.formState.errors.name?.message}
                                            size="large"
                                            label={t('dialog.fullNameLabel')}
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
                                            inputPlaceholder={t('dialog.emailPlaceholder')}
                                            input={value}
                                            onChangeFunction={onChange}
                                            required={true}
                                            error={form.formState.errors.email?.message}
                                            size="large"
                                            label={t('dialog.emailLabel')}
                                            {...field}
                                            className="w-96"
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <MultiSelectDropdown
                            form={form}
                            label={t('dialog.roleTypeLabel')}
                            name="roleType"
                            options={RoleType.map((option, index) => ({
                                value: option.name,
                                label: mapRoleToCustomName(option.name),
                                _id: index,
                            }))}
                            control={form.control}
                            className="w-96"
                            required
                        />
                        <div className="flex w-96 items-center justify-center text-center">
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="primary"
                                layoutVariant="default"
                                className="mb-6"
                                disable={!isValid}
                                onClick={form.handleSubmit(onSubmit)}
                            >
                                {t('dialog.submitButton')}
                            </MyButton>
                        </div>
                    </form>
                </FormProvider>
            </DialogContent>
        </Dialog>
    );
};

export default Step4InviteUsers;
