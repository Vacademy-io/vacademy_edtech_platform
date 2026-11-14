import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DotsThree, WarningCircle, PencilSimple, UserCircle } from '@phosphor-icons/react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useEffect, useState } from 'react';
import { MyButton } from '@/components/design-system/button';
import { z } from 'zod';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import MultiSelectDropdown from '@/components/design-system/multiple-select-field';
import { RoleType } from '@/constants/dummy-data';
import { UserRolesDataEntry } from '@/types/dashboard/user-roles';
import { getInstituteId } from '@/constants/helper';
import { useMutation } from '@tanstack/react-query';
import {
    handleAddUserDashboardRoles,
    handleDeleteDisableDashboardUsers,
} from '../-services/dashboard-services';
import { toast } from 'sonner';
import { mapRoleToCustomName } from '@/utils/roleUtils';
import AssignSubOrgsDialog from '@/routes/manage-institute/teams/-components/assign-sub-orgs-dialog';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { UPDATE_ADMIN_DETAILS_URL } from '@/constants/urls';
import { UploadFileInS3Public } from '@/routes/signup/-services/signup-services';
import { getPublicUrl } from '@/services/upload_file';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export const buildInviteUsersSchema = (t: TFunction) =>
    z.object({
        roleType: z
            .array(z.string())
            .min(1, t('changeRoleType.validation.roleRequired')),
    });
type FormValues = z.infer<ReturnType<typeof buildInviteUsersSchema>>;

interface ChangeRoleTypeComponentProps {
    student: UserRolesDataEntry;
    onClose: () => void;
    refetchData: () => void;
    availableRoles?: { id: string; name: string }[];
}

const ChangeRoleTypeComponent: React.FC<ChangeRoleTypeComponentProps> = ({
    student,
    onClose,
    refetchData,
    availableRoles,
}) => {
    const { t } = useTranslation('dashboardInstituteUsersOptions');
    const roleOptions = availableRoles || RoleType;
    const instituteId = getInstituteId();
    //need to previous already assigned roles
    const form = useForm<FormValues>({
        resolver: zodResolver(buildInviteUsersSchema(t)),
        defaultValues: {
            roleType: [],
        },
        mode: 'onChange',
    });
    const { getValues } = form;
    const isValid = getValues('roleType').length > 0 ? true : false;
    form.watch('roleType');

    const getDashboardUsersData = useMutation({
        mutationFn: ({
            roles,
            userId,
            instituteId,
        }: {
            roles: string[];
            userId: string;
            instituteId: string | undefined;
        }) => handleAddUserDashboardRoles(roles, userId, instituteId),
        onSuccess: () => {
            onClose();
            refetchData();
            toast.success(t('changeRoleType.toast.success'), {
                className: 'success-toast',
                duration: 2000,
            });
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    function onSubmit(values: FormValues) {
        getDashboardUsersData.mutate({
            roles: values.roleType,
            userId: student.id,
            instituteId,
        });
    }

    useEffect(() => {
        form.reset({
            roleType: student.roles.map((role) => role.role_name) || [],
        });
    }, []);

    return (
        <DialogContent className="flex w-96 flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('changeRoleType.title')}
            </h1>
            <FormProvider {...form}>
                <form className="flex flex-col items-start justify-center gap-4 px-4">
                    <MultiSelectDropdown
                        form={form}
                        label={t('changeRoleType.roleTypeLabel')}
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
                            {t('changeRoleType.submit')}
                        </MyButton>
                    </div>
                </form>
            </FormProvider>
        </DialogContent>
    );
};

interface DisableUserComponentProps {
    student: UserRolesDataEntry;
    onClose: () => void;
    refetchData: () => void;
}

const DisableUserComponent: React.FC<DisableUserComponentProps> = ({
    student,
    onClose,
    refetchData,
}) => {
    const { t } = useTranslation('dashboardInstituteUsersOptions');
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
            toast.success(t('disableUser.toast.success'), {
                className: 'success-toast',
                duration: 2000,
            });
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handlDisableUser = () => {
        handleDisableUserMutation.mutate({
            instituteId,
            status: 'DISABLED',
            userId: student.id,
        });
    };
    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('disableUser.title')}
            </h1>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center text-danger-600">
                    <p>{t('disableUser.attention')}</p>
                    <WarningCircle size={18} />
                </div>
                <h1>
                    {t('disableUser.confirmPrefix')}{' '}
                    <span className="text-primary-500">{student.full_name}</span>
                    {t('disableUser.confirmSuffix')}
                </h1>
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="mt-4 font-medium"
                        onClick={handlDisableUser} // Close the dialog when clicked
                    >
                        {t('disableUser.confirmButton')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};

interface EnableUserComponentProps {
    student: UserRolesDataEntry;
    onClose: () => void;
    refetchData: () => void;
}

const EnableUserComponent: React.FC<EnableUserComponentProps> = ({
    student,
    onClose,
    refetchData,
}) => {
    const { t } = useTranslation('dashboardInstituteUsersOptions');
    const instituteId = getInstituteId();
    const handleEnableUserMutation = useMutation({
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
            toast.success(t('enableUser.toast.success'), {
                className: 'success-toast',
                duration: 2000,
            });
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handlEnableUser = () => {
        handleEnableUserMutation.mutate({
            instituteId,
            status: 'ACTIVE',
            userId: student.id,
        });
    };
    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('enableUser.title')}
            </h1>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center text-danger-600">
                    <p>{t('enableUser.attention')}</p>
                    <WarningCircle size={18} />
                </div>
                <h1>
                    {t('enableUser.confirmPrefix')}{' '}
                    <span className="text-primary-500">{student.full_name}</span>
                    {t('enableUser.confirmSuffix')}
                </h1>
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="mt-4 font-medium"
                        onClick={handlEnableUser} // Close the dialog when clicked
                    >
                        {t('enableUser.confirmButton')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};

interface DeleteUserComponentProps {
    student: UserRolesDataEntry;
    onClose: () => void;
    refetchData: () => void;
}

// Internal action codes for the options menu — used for dispatch/comparison
// only, never rendered directly (the visible labels are translated separately).
type MenuAction = 'editProfile' | 'changeRoleType' | 'disableUser' | 'enableUser' | 'assignSubOrgs' | 'deleteUser';

/**
 * "{{name}}'s profile" — the photo, designation and bio are shared, so they show
 * wherever this person appears on a course rather than being set per course.
 */
const EditTeamMemberComponent = ({
    student,
    onClose,
    refetchData,
}: {
    student: UserRolesDataEntry;
    onClose: () => void;
    refetchData: () => void;
}) => {
    const { t } = useTranslation('dashboardInstituteUsersOptions');
    const instituteId = getInstituteId();
    const [fullName, setFullName] = useState(student.full_name ?? '');
    const [email, setEmail] = useState(student.email ?? '');
    const [mobileNumber, setMobileNumber] = useState(student.mobile_number ?? '');
    const [subtitle, setSubtitle] = useState(student.author_subtitle ?? '');
    const [description, setDescription] = useState(student.author_description ?? '');
    const [photoId, setPhotoId] = useState<string | null>(student.profile_pic_file_id);
    // Resolved public URL for the avatar circle. Best-effort: a failed lookup
    // just leaves the placeholder icon, it never blocks editing.
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!photoId) {
            setPhotoUrl(null);
            return;
        }
        let cancelled = false;
        getPublicUrl(photoId)
            .then((url) => {
                if (!cancelled) setPhotoUrl(url || null);
            })
            .catch(() => {
                if (!cancelled) setPhotoUrl(null);
            });
        return () => {
            cancelled = true;
        };
    }, [photoId]);

    const uploadPhoto = async (file?: File) => {
        if (!file || !file.type.startsWith('image/')) {
            toast.error(t('editProfile.toast.notImage'));
            return;
        }

        try {
            setSaving(true);
            const uploadedFileId = await UploadFileInS3Public(
                file,
                () => undefined,
                instituteId,
                'STUDENTS'
            );
            if (!uploadedFileId) throw new Error('The image did not return a file id.');
            setPhotoId(uploadedFileId);
        } catch {
            toast.error(t('editProfile.toast.uploadFailed'));
        } finally {
            setSaving(false);
        }
    };

    const save = async () => {
        try {
            setSaving(true);
            await authenticatedAxiosInstance.post(
                `${UPDATE_ADMIN_DETAILS_URL}?userId=${student.id}&instituteId=${instituteId}`,
                {
                    id: student.id,
                    full_name: fullName.trim(),
                    email: email.trim(),
                    mobile_number: mobileNumber.trim(),
                    profile_pic_file_id: photoId,
                    // Empty strings deliberately clear a previously saved designation/bio.
                    author_subtitle: subtitle.trim(),
                    author_description: description.trim(),
                    delete_user_role_request: [],
                    add_user_role_request: [],
                }
            );
            toast.success(t('editProfile.toast.success'));
            refetchData();
            onClose();
        } catch {
            toast.error(t('editProfile.toast.error'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <DialogContent className="max-w-md">
            <div className="flex items-center gap-4">
                <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-100">
                    {photoUrl ? (
                        <img src={photoUrl} alt={fullName} className="size-full object-cover" />
                    ) : (
                        <UserCircle size={40} className="text-neutral-300" />
                    )}
                </div>
                <div>
                    <h2 className="text-h3 font-semibold">
                        {t('editProfile.title', { name: student.full_name })}
                    </h2>
                    <p className="mt-1 text-sm text-neutral-500">
                        {t('editProfile.hint', { name: student.full_name })}
                    </p>
                </div>
            </div>
            <div className="space-y-3 py-4">
                <label className="block text-sm font-medium">
                    {t('editProfile.nameLabel')}
                    <Input className="mt-1" value={fullName} onChange={(event) => setFullName(event.target.value)} />
                </label>
                <label className="block text-sm font-medium">
                    {t('editProfile.emailLabel')}
                    <Input className="mt-1" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
                </label>
                <label className="block text-sm font-medium">
                    {t('editProfile.mobileNumberLabel')}
                    <Input className="mt-1" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} />
                </label>
                <label className="block text-sm font-medium">
                    {t('editProfile.photoLabel')}
                    <Input
                        type="file"
                        accept="image/*"
                        className="mt-1"
                        disabled={saving}
                        onChange={(event) => void uploadPhoto(event.target.files?.[0])}
                    />
                </label>
                <label className="block text-sm font-medium">
                    {t('editProfile.designationLabel')}
                    <Input
                        className="mt-1"
                        maxLength={255}
                        value={subtitle}
                        onChange={(event) => setSubtitle(event.target.value)}
                        placeholder={t('editProfile.designationPlaceholder')}
                    />
                </label>
                <label className="block text-sm font-medium">
                    {t('editProfile.bioLabel')}
                    <Textarea
                        className="mt-1"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder={t('editProfile.bioPlaceholder')}
                    />
                </label>
            </div>
            <div className="flex justify-end gap-2">
                <MyButton buttonType="secondary" onClick={onClose}>
                    {t('editProfile.cancel')}
                </MyButton>
                <MyButton buttonType="primary" disable={saving || !fullName.trim()} onClick={save}>
                    {saving ? t('editProfile.saving') : t('editProfile.save')}
                </MyButton>
            </div>
        </DialogContent>
    );
};

const DeleteUserComponent: React.FC<DeleteUserComponentProps> = ({
    student,
    onClose,
    refetchData,
}) => {
    const { t } = useTranslation('dashboardInstituteUsersOptions');
    const instituteId = getInstituteId();
    const handleDeleteUserMutation = useMutation({
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
            toast.success(t('deleteUser.toast.success'), {
                className: 'success-toast',
                duration: 2000,
            });
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handlDeleteUser = () => {
        handleDeleteUserMutation.mutate({
            instituteId,
            status: 'DELETE',
            userId: student.id,
        });
    };
    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('deleteUser.title')}
            </h1>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center text-danger-600">
                    <p>{t('deleteUser.attention')}</p>
                    <WarningCircle size={18} />
                </div>
                <h1>
                    {t('deleteUser.confirmPrefix')}{' '}
                    <span className="text-primary-500">{student.full_name}</span>
                    {t('deleteUser.confirmSuffix')}
                </h1>
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="mt-4 font-medium"
                        onClick={handlDeleteUser} // Close the dialog when clicked
                    >
                        {t('deleteUser.confirmButton')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};

const InstituteUsersOptions = ({
    user,
    refetchData,
    availableRoles,
    subOrgAssign,
    canEditProfile = false,
}: {
    user: UserRolesDataEntry;
    refetchData: () => void;
    availableRoles?: { id: string; name: string }[];
    /**
     * Opt-in channel-partner assignment. Absent on the dashboard and vimotion team
     * surfaces, which share this menu but have no partner context — passing it only
     * from the institute Teams list keeps those untouched.
     */
    subOrgAssign?: { label: string; currentSubOrgIds: string[] };
    canEditProfile?: boolean;
}) => {
    const { t } = useTranslation('dashboardInstituteUsersOptions');
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
                    {canEditProfile && (
                        <DropdownMenuItem onClick={() => handleDropdownMenuClick('editProfile')}>
                            <PencilSimple className="mr-2 size-4" /> {t('menu.editProfile')}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                        onClick={() => handleDropdownMenuClick('changeRoleType')}
                    >
                        {t('menu.changeRoleType')}
                    </DropdownMenuItem>
                    {user.roles.some((role) => role.status === 'ACTIVE') && (
                        <DropdownMenuItem
                            onClick={() => handleDropdownMenuClick('disableUser')}
                        >
                            {t('menu.disableUser')}
                        </DropdownMenuItem>
                    )}
                    {!user.roles.some((role) => role.status === 'ACTIVE') && (
                        <DropdownMenuItem
                            onClick={() => handleDropdownMenuClick('enableUser')}
                        >
                            {t('menu.enableUser')}
                        </DropdownMenuItem>
                    )}
                    {subOrgAssign && (
                        <DropdownMenuItem
                            onClick={() => handleDropdownMenuClick('assignSubOrgs')}
                        >
                            {subOrgAssign.label}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => handleDropdownMenuClick('deleteUser')}>
                        {t('menu.deleteUser')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                {selectedOption === 'editProfile' && <EditTeamMemberComponent student={user} onClose={() => setOpenDialog(false)} refetchData={refetchData} />}
                {selectedOption === 'changeRoleType' && (
                    <ChangeRoleTypeComponent
                        student={user}
                        onClose={() => setOpenDialog(false)}
                        refetchData={refetchData}
                        availableRoles={availableRoles}
                    />
                )}
                {selectedOption === 'disableUser' && (
                    <DisableUserComponent
                        student={user}
                        onClose={() => setOpenDialog(false)}
                        refetchData={refetchData}
                    />
                )}
                {selectedOption === 'enableUser' && (
                    <EnableUserComponent
                        student={user}
                        onClose={() => setOpenDialog(false)}
                        refetchData={refetchData}
                    />
                )}
                {selectedOption === 'assignSubOrgs' && subOrgAssign && (
                    <AssignSubOrgsDialog
                        userId={user.id}
                        userName={user.full_name}
                        currentSubOrgIds={subOrgAssign.currentSubOrgIds}
                        onClose={() => setOpenDialog(false)}
                        refetchData={refetchData}
                    />
                )}
                {selectedOption === 'deleteUser' && (
                    <DeleteUserComponent
                        student={user}
                        onClose={() => setOpenDialog(false)}
                        refetchData={refetchData}
                    />
                )}
            </Dialog>
        </>
    );
};

export default InstituteUsersOptions;
