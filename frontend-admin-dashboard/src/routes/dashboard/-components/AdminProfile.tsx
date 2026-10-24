'use client';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { buildAdminProfileSchema, type AdminProfileFormValues } from '../-utils/admin-profile-schema';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { useEffect, useRef, useState } from 'react';
import { getInstituteId } from '@/constants/helper';
import { UploadFileInS3Public } from '@/routes/signup/-services/signup-services';
import {
    UploadSimple,
    Trash,
    PencilSimple,
    Camera,
    CircleNotch,
    LockSimple,
} from '@phosphor-icons/react';
import { MyInput } from '@/components/design-system/input';
import PhoneInputField from '@/components/design-system/phone-input-field';
import { UserProfile } from '@/services/student-list-section/getAdminDetails';
import useAdminLogoStore from '@/components/common/layout-container/sidebar/admin-logo-zustand';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { handleUpdateAdminDetails } from '../-services/dashboard-services';
import { Menu, Transition } from '@headlessui/react';
import { useTranslation } from 'react-i18next';

// Define form values type
const AdminProfile = ({ adminDetails }: { adminDetails: UserProfile }) => {
    const { t } = useTranslation(['dashboardAdminProfile', 'dashboardAdminProfileSchema']);
    const instituteId = getInstituteId();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const queryClient = useQueryClient();
    const [newRoles, setNewRoles] = useState<string[]>([]);
    const oldRoles = useRef<string[]>([]);
    const [removeImage, setRemoveImage] = useState(false);

    const adminProfileSchema = buildAdminProfileSchema(t);

    const form = useForm<AdminProfileFormValues>({
        resolver: zodResolver(adminProfileSchema),
        defaultValues: {
            profilePictureUrl: '',
            profilePictureId: undefined, // ✅ not null
            name: '',
            roleType: [], // ✅ correct
            email: '',
            phone: '',
        },
        mode: 'onChange',
    });

    const { handleSubmit } = form;
    const [isUploading, setIsUploading] = useState(false);

    const handleSubmitEditDataMutation = useMutation({
        mutationFn: ({ data }: { data: any }) => {
            if (removeImage) {
                data.profilePictureId = null;
                data.profilePictureUrl = '';
            }
            return handleUpdateAdminDetails(data, adminDetails.roles, oldRoles.current, newRoles);
        },
        onSuccess: () => {
            toast.success(t('toast.updateSuccess'), {
                className: 'success-toast',
                duration: 2000,
            });
            setOpen(false);
            queryClient.invalidateQueries({ queryKey: ['GET_ADMIN_DETAILS'] });
        },
        onError: (error: unknown) => {
            if (error instanceof AxiosError) {
                toast.error(error.message, { className: 'error-toast', duration: 2000 });
            } else {
                console.error('Unexpected error:', error);
            }
        },
    });

    const onSubmit = (values: any) => {
        handleSubmitEditDataMutation.mutate({ data: values });
    };

    const handleFileSubmit = async (file: File) => {
        try {
            setIsUploading(true);
            const fileId = await UploadFileInS3Public(
                file,
                setIsUploading,
                instituteId,
                'STUDENTS'
            );
            const imageUrl = URL.createObjectURL(file);
            form.setValue('profilePictureUrl', imageUrl);
            form.setValue('profilePictureId', fileId);
            setRemoveImage(false);
        } catch (error) {
            console.error('Upload failed:', error);
        } finally {
            setIsUploading(false);
        }
    };

    const { adminLogo } = useAdminLogoStore();

    useEffect(() => {
        form.reset({
            profilePictureUrl: adminLogo || '',
            profilePictureId: adminDetails?.profile_pic_file_id ?? null,
            name: adminDetails?.full_name || '',
            roleType: adminDetails.roles.map((role) => role.role_name) || [],
            email: adminDetails?.email,
            phone: adminDetails?.mobile_number || '',
        });
        oldRoles.current = adminDetails.roles.map((role) => role.role_name);
        setRemoveImage(false);
    }, [adminDetails, adminLogo]);

    useEffect(() => {
        const subscription = form.watch(() => {
            setNewRoles([...form.getValues('roleType')]);
        });
        return () => subscription.unsubscribe();
    }, [form.watch]);

    const profilePictureUrl = form.watch('profilePictureUrl');
    const watchedName = form.watch('name');
    const isSaving = handleSubmitEditDataMutation.isPending;

    return (
        <MyDialog
            open={open}
            onOpenChange={setOpen}
            heading={t('dialog.title')}
            dialogWidth="max-w-lg"
            trigger={
                <MyButton type="button" scale="medium" buttonType="secondary">
                    <PencilSimple className="size-4" />
                    {t('trigger.editProfile')}
                </MyButton>
            }
            footer={
                <>
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={() => setOpen(false)}
                        disable={isSaving}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        type="submit"
                        form={ADMIN_PROFILE_FORM_ID}
                        scale="medium"
                        buttonType="primary"
                        disable={
                            isSaving || isUploading || Object.keys(form.formState.errors).length > 0
                        }
                    >
                        {isSaving && <CircleNotch className="size-4 animate-spin" />}
                        {t('actions.saveChanges')}
                    </MyButton>
                </>
            }
        >
            <FormProvider {...form}>
                <form
                    id={ADMIN_PROFILE_FORM_ID}
                    onSubmit={handleSubmit(onSubmit)}
                    className="flex flex-col gap-6"
                >
                    <div className="flex flex-col items-center gap-2">
                        <div className="relative">
                            <Avatar className="size-28 border-4 border-primary-50">
                                {profilePictureUrl ? (
                                    <AvatarImage
                                        src={profilePictureUrl}
                                        alt={t('logoAlt')}
                                        className="object-cover"
                                    />
                                ) : null}
                                <AvatarFallback className="bg-primary-100 text-h2 font-semibold text-primary-500">
                                    {isUploading ? (
                                        <CircleNotch className="size-6 animate-spin" />
                                    ) : (
                                        getInitials(watchedName)
                                    )}
                                </AvatarFallback>
                            </Avatar>

                            <Menu as="div" className="absolute bottom-0 right-0 z-10">
                                <Menu.Button
                                    className="flex size-9 items-center justify-center rounded-full border-2 border-white bg-primary-500 text-white shadow-md transition-colors hover:bg-primary-400 disabled:opacity-60"
                                    aria-label={t('menu.uploadNew')}
                                    disabled={isUploading}
                                >
                                    <Camera className="size-4" weight="bold" />
                                </Menu.Button>
                                <Transition>
                                    <Menu.Items className="absolute left-1/2 top-11 z-20 w-44 -translate-x-1/2 rounded-md bg-white p-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
                                        <Menu.Item>
                                            {({ active }) => (
                                                <button
                                                    type="button"
                                                    onClick={() => fileInputRef.current?.click()}
                                                    className={cn(
                                                        'flex w-full items-center gap-2 rounded-md p-2 text-body text-neutral-700',
                                                        active && 'bg-neutral-100'
                                                    )}
                                                >
                                                    <UploadSimple className="size-4" />
                                                    {t('menu.uploadNew')}
                                                </button>
                                            )}
                                        </Menu.Item>
                                        {profilePictureUrl ? (
                                            <Menu.Item>
                                                {({ active }) => (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            form.setValue('profilePictureUrl', '');
                                                            form.setValue(
                                                                'profilePictureId',
                                                                undefined
                                                            );
                                                            setRemoveImage(true);
                                                        }}
                                                        className={cn(
                                                            'flex w-full items-center gap-2 rounded-md p-2 text-body text-danger-600',
                                                            active && 'bg-danger-50'
                                                        )}
                                                    >
                                                        <Trash className="size-4" />
                                                        {t('menu.removeImage')}
                                                    </button>
                                                )}
                                            </Menu.Item>
                                        ) : null}
                                    </Menu.Items>
                                </Transition>
                            </Menu>

                            <FileUploadComponent
                                fileInputRef={fileInputRef}
                                onFileSubmit={handleFileSubmit}
                                control={form.control}
                                name="profilePictureId"
                                acceptedFileTypes="image/*"
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            {...field}
                                            inputType="text"
                                            inputPlaceholder={t('fields.name.placeholder')}
                                            input={field.value}
                                            onChangeFunction={field.onChange}
                                            required
                                            error={form.formState.errors.name?.message}
                                            size="large"
                                            label={t('fields.name.label')}
                                            className="sm:w-full"
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        {/* Roles are read-only here — a user must not be able to
                            change their own roles from self-service profile editing
                            (that would allow granting themselves ADMIN). Role
                            management is done by an administrator elsewhere. */}
                        <div className="flex flex-col gap-2">
                            <span className="text-subtitle font-regular">{t('roles.label')}</span>
                            <div className="flex flex-wrap gap-2">
                                {adminDetails.roles?.length ? (
                                    adminDetails.roles.map((role, idx) => (
                                        <span
                                            key={idx}
                                            className="rounded-md border border-primary-200 bg-primary-50 px-2 py-0.5 text-caption font-semibold uppercase text-primary-500"
                                        >
                                            {role.role_name}
                                        </span>
                                    ))
                                ) : (
                                    <span className="text-body text-neutral-400">
                                        {t('roles.empty')}
                                    </span>
                                )}
                            </div>
                            <p className="flex items-start gap-1.5 text-caption text-neutral-500">
                                <LockSimple className="mt-0.5 size-3.5 shrink-0" />
                                {t('roles.managedNote')}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col gap-4 border-t border-neutral-200 pt-6">
                        <h3 className="text-subtitle font-semibold text-neutral-700">
                            {t('sections.contactInformation')}
                        </h3>

                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            {...field}
                                            inputType="text"
                                            inputPlaceholder={t('fields.email.placeholder')}
                                            input={field.value}
                                            onChangeFunction={field.onChange}
                                            error={form.formState.errors.email?.message}
                                            size="large"
                                            label={t('fields.email.label')}
                                            className="sm:w-full"
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="phone"
                            render={() => (
                                <FormItem>
                                    <FormControl>
                                        <PhoneInputField
                                            label={t('fields.phone.label')}
                                            placeholder={t('fields.phone.placeholder')}
                                            name="phone"
                                            control={form.control}
                                            labelStyle="text-subtitle font-regular"
                                            required={false}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </div>
                </form>
            </FormProvider>
        </MyDialog>
    );
};

const ADMIN_PROFILE_FORM_ID = 'admin-profile-form';

function getInitials(name?: string | null) {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return parts
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('');
}

export default AdminProfile;
