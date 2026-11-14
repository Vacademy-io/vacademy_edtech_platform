import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DotsThree, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { MyInput } from '@/components/design-system/input';
import MultiSelectDropdown from '@/components/design-system/multiple-select-field';
import { RoleType } from '@/constants/dummy-data';
import { UserRolesDataEntry } from '@/types/dashboard/user-roles';
import {
    handleDeleteDisableDashboardUsers,
    handleResendUserInvitation,
    handleUpdateUserInvitation,
} from '../-services/dashboard-services';
import { useMutation } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

export const buildInviteUsersSchema = (t: TFunction) =>
    z.object({
        name: z.string().min(1, t('editUser.validation.nameRequired')),
        email: z
            .string()
            .min(1, t('editUser.validation.emailRequired'))
            .email(t('editUser.validation.emailInvalid')),
        roleType: z.array(z.string()).min(1, t('editUser.validation.roleRequired')),
    });
type FormValues = z.infer<ReturnType<typeof buildInviteUsersSchema>>;

interface EditComponentProps {
    student: UserRolesDataEntry;
    onClose: () => void;
    refetchData: () => void;
    availableRoles?: { id: string; name: string }[];
}

const EditComponent: React.FC<EditComponentProps> = ({
    student,
    onClose,
    refetchData,
    availableRoles,
}) => {
    const { t } = useTranslation('dashboardInviteUsersOptions');
    const roleOptions = availableRoles || RoleType;
    const instituteId = getInstituteId();
    const form = useForm<FormValues>({
        resolver: zodResolver(buildInviteUsersSchema(t)),
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

    const handleUpdateUserMutation = useMutation({
        mutationFn: ({
            instituteId,
            data,
            student,
        }: {
            instituteId: string | undefined;
            data: FormValues;
            student: UserRolesDataEntry;
        }) => handleUpdateUserInvitation(instituteId, data, student),
        onSuccess: () => {
            onClose();
            refetchData();
            toast.success(t('editUser.toast.success'), {
                className: 'success-toast',
                duration: 2000,
            });
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    function onSubmit(values: FormValues) {
        handleUpdateUserMutation.mutate({
            instituteId,
            data: values,
            student,
        });
    }

    useEffect(() => {
        form.reset({
            name: student.full_name || '',
            email: student.email || '',
            roleType: student.roles.map((role) => role.role_name) || [],
        });
    }, []);

    return (
        <DialogContent className="flex w-96 flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('editUser.title')}
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
                                        inputPlaceholder={t('editUser.namePlaceholder')}
                                        input={value}
                                        onChangeFunction={onChange}
                                        required={true}
                                        error={form.formState.errors.name?.message}
                                        size="large"
                                        label={t('editUser.nameLabel')}
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
                                        inputPlaceholder={t('editUser.emailPlaceholder')}
                                        input={value}
                                        onChangeFunction={onChange}
                                        required={true}
                                        error={form.formState.errors.email?.message}
                                        size="large"
                                        label={t('editUser.emailLabel')}
                                        {...field}
                                        className="w-96"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <MultiSelectDropdown
                        form={form}
                        label={t('editUser.roleTypeLabel')}
                        name="roleType"
                        options={roleOptions.map((option, index) => ({
                            value: option.name,
                            label: option.name,
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
                            {t('editUser.submit')}
                        </MyButton>
                    </div>
                </form>
            </FormProvider>
        </DialogContent>
    );
};

interface ResendInviteComponentProps {
    student: UserRolesDataEntry;
    onClose: () => void;
    refetchData: () => void;
}

const ResendInviteComponent: React.FC<ResendInviteComponentProps> = ({
    student,
    onClose,
    refetchData,
}) => {
    const { t } = useTranslation('dashboardInviteUsersOptions');
    const handleResendUserMutation = useMutation({
        mutationFn: ({ userId }: { userId: string }) => handleResendUserInvitation(userId),
        onSuccess: () => {
            onClose();
            refetchData();
            toast.success(t('resendInvite.toast.success'), {
                className: 'success-toast',
                duration: 2000,
            });
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handlResendUser = () => {
        handleResendUserMutation.mutate({
            userId: student.id,
        });
    };
    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('resendInvite.title')}
            </h1>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center text-danger-600">
                    <p>{t('resendInvite.attention')}</p>
                    <WarningCircle size={18} />
                </div>
                <h1>
                    {t('resendInvite.confirmPrefix')}{' '}
                    <span className="text-primary-500">{student.full_name}</span>
                    {t('resendInvite.confirmSuffix')}
                </h1>
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="mt-4 font-medium"
                        onClick={handlResendUser} // Close the dialog when clicked
                    >
                        {t('resendInvite.confirmButton')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};

interface CancelInviteComponentProps {
    student: UserRolesDataEntry;
    onClose: () => void;
    refetchData: () => void;
}

const CancelInviteComponent: React.FC<CancelInviteComponentProps> = ({
    student,
    onClose,
    refetchData,
}) => {
    const { t } = useTranslation('dashboardInviteUsersOptions');
    const instituteId = getInstituteId();
    const handleDisableUserMutation = useMutation({
        mutationFn: ({
            instituteId,
            status,
            userId,
        }: {
            instituteId: string | undefined;
            status: string;
            userId: string;
        }) => handleDeleteDisableDashboardUsers(instituteId, status, userId),
        onSuccess: () => {
            onClose();
            refetchData();
            toast.success(t('cancelInvite.toast.success'), {
                className: 'success-toast',
                duration: 2000,
            });
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handlCancelInviteUser = () => {
        handleDisableUserMutation.mutate({
            instituteId,
            status: 'CANCEL',
            userId: student.id,
        });
    };
    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('cancelInvite.title')}
            </h1>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center text-danger-600">
                    <p>{t('cancelInvite.attention')}</p>
                    <WarningCircle size={18} />
                </div>
                <h1>
                    {t('cancelInvite.confirmPrefix')}{' '}
                    <span className="text-primary-500">{student.full_name}</span>
                    {t('cancelInvite.confirmSuffix')}
                </h1>
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="mt-4 font-medium"
                        onClick={handlCancelInviteUser} // Close the dialog when clicked
                    >
                        {t('cancelInvite.confirmButton')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};

// Internal action codes for the options menu — used for dispatch/comparison
// only, never rendered directly (the visible labels are translated separately).
type MenuAction = 'editUser' | 'resendInvite' | 'cancelInvite';

const InviteUsersOptions = ({
    user,
    refetchData,
    availableRoles,
}: {
    user: UserRolesDataEntry;
    refetchData: () => void;
    availableRoles?: { id: string; name: string }[];
}) => {
    const { t } = useTranslation('dashboardInviteUsersOptions');
    const [openDialog, setOpenDialog] = useState(false);
    // Internal action codes used for dispatch/comparison only — never rendered.
    // Kept separate from the translated menu labels shown below so switching
    // locale can never break which dialog opens.
    const [selectedOption, setSelectedOption] = useState<MenuAction | null>(null);

    const handleDropdownMenuClick = (value: MenuAction) => {
        setOpenDialog(true);
        setSelectedOption(value);
    };
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger>
                    <p className="cursor-pointer rounded-md border p-0.5">
                        <DotsThree size={20} />
                    </p>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => handleDropdownMenuClick('editUser')}>
                        {t('menu.editUser')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDropdownMenuClick('resendInvite')}>
                        {t('menu.resendInvite')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDropdownMenuClick('cancelInvite')}>
                        {t('menu.cancelInvite')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                {selectedOption === 'editUser' && (
                    <EditComponent
                        student={user}
                        onClose={() => setOpenDialog(false)}
                        refetchData={refetchData}
                        availableRoles={availableRoles}
                    />
                )}
                {selectedOption === 'resendInvite' && (
                    <ResendInviteComponent
                        student={user}
                        onClose={() => setOpenDialog(false)}
                        refetchData={refetchData}
                    />
                )}
                {selectedOption === 'cancelInvite' && (
                    <CancelInviteComponent
                        student={user}
                        onClose={() => setOpenDialog(false)}
                        refetchData={refetchData}
                    />
                )}
            </Dialog>
        </>
    );
};

export default InviteUsersOptions;
