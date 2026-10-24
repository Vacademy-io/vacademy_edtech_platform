import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { Buildings, Camera, CircleNotch, Palette, PencilSimple, Plus } from '@phosphor-icons/react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { buildEditDashboardProfileSchema } from '../-utils/edit-dashboard-profile-schema';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { UploadFileInS3Public } from '@/routes/signup/-services/signup-services';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { getInstituteId } from '@/constants/helper';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { InstituteType } from '@/constants/dummy-data';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { getPublicUrl } from '@/services/upload_file';
import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { handleUpdateInstituteDashboard } from '../-services/dashboard-services';
import PhoneInputField from '@/components/design-system/phone-input-field';
import { getThemeShades, isCustomThemeCode } from '@/constants/themes/preset-themes';
import { rampHexFromHex, SHADES } from '@/lib/theme-ramp';
import { useTranslation } from 'react-i18next';

type FormValues = z.infer<ReturnType<typeof buildEditDashboardProfileSchema>>;

const EditDashboardProfileComponent = ({ isEdit }: { isEdit: boolean }) => {
    const { t } = useTranslation('dashboardEditProfileComponent');
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);

    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const instituteId = getInstituteId();
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const form = useForm<FormValues>({
        resolver: zodResolver(buildEditDashboardProfileSchema(t)),
        defaultValues: {
            instituteProfilePictureUrl: '',
            instituteProfilePictureId: undefined,
            instituteThemeCode: instituteDetails?.institute_theme_code ?? '',
            instituteName: '',
            instituteType: '',
            instituteEmail: '',
            institutePhoneNumber: '',
            instituteWebsite: '',
            instituteAddress: '',
            instituteCountry: '',
            instituteState: '',
            instituteCity: '',
            institutePinCode: '',
        },
        mode: 'onChange',
    });

    const { handleSubmit } = form;
    const handleFileSubmit = async (file: File) => {
        try {
            setIsUploading(true);
            // need to change soruce and soruceid and userId
            const fileId = await UploadFileInS3Public(
                file,
                setIsUploading,
                instituteId,
                'STUDENTS'
            );
            const imageUrl = URL.createObjectURL(file);
            form.setValue('instituteProfilePictureUrl', imageUrl);
            form.setValue('instituteProfilePictureId', fileId);
        } catch (error) {
            console.error('Upload failed:', error);
        } finally {
            setIsUploading(false);
        }
    };

    const handleSubmitEditDataMutation = useMutation({
        mutationFn: ({
            data,
            instituteId,
        }: {
            data: FormValues;
            instituteId: string | undefined;
        }) => handleUpdateInstituteDashboard(data, instituteId),
        onSuccess: () => {
            toast.success(t('toast.updateSuccess'), {
                className: 'success-toast',
                duration: 2000,
            });
            setOpen(false);
            queryClient.invalidateQueries({ queryKey: ['GET_BOTH_INSTITUTE_APIS'] });
        },
        onError: (error: unknown) => {
            if (error instanceof AxiosError) {
                toast.error(error.message, {
                    className: 'error-toast',
                    duration: 2000,
                });
            } else {
                // Handle non-Axios errors if necessary
                console.error('Unexpected error:', error);
            }
        },
    });

    function onSubmit(values: FormValues) {
        handleSubmitEditDataMutation.mutate({
            data: values,
            instituteId: instituteDetails?.id,
        });
    }

    const onInvalid = (err: unknown) => {
        console.log(err);
    };

    useEffect(() => {
        const resetFormWithUrl = async () => {
            const publicUrl = await getPublicUrl(instituteDetails?.institute_logo_file_id);
            form.reset({
                instituteProfilePictureUrl: publicUrl,
                instituteProfilePictureId: instituteDetails?.institute_logo_file_id ?? undefined,
                instituteName: instituteDetails?.institute_name,
                instituteType: instituteDetails?.type,
                instituteEmail: instituteDetails?.email,
                institutePhoneNumber: instituteDetails?.phone,
                instituteWebsite: instituteDetails?.website_url,
                instituteAddress: instituteDetails?.address,
                instituteCountry: instituteDetails?.country,
                instituteState: instituteDetails?.state,
                instituteCity: instituteDetails?.city,
                institutePinCode: instituteDetails?.pin_code,
                instituteThemeCode: instituteDetails?.institute_theme_code ?? 'primary',
            });
        };
        resetFormWithUrl();
    }, [instituteDetails]);

    const logoUrl = form.watch('instituteProfilePictureUrl');
    const currentThemeCode = form.watch('instituteThemeCode') ?? '';
    // A saved code is either a preset or a custom hex — ramp the latter so the
    // "Current" strip isn't blank for it.
    const themeShades = isCustomThemeCode(currentThemeCode)
        ? [...SHADES].reverse().map((shade) => rampHexFromHex(currentThemeCode)[shade])
        : getThemeShades(currentThemeCode);
    const isSaving = handleSubmitEditDataMutation.isPending;

    return (
        <MyDialog
            open={open}
            onOpenChange={setOpen}
            heading={t('dialog.title')}
            dialogWidth="max-w-2xl"
            trigger={
                isEdit ? (
                    <MyButton type="button" scale="medium" buttonType="secondary">
                        <PencilSimple className="size-4" />
                        {t('trigger.editInstitute')}
                    </MyButton>
                ) : (
                    <MyButton type="button" scale="medium" buttonType="secondary">
                        <Plus className="size-4" />
                        {t('trigger.addDetails')}
                    </MyButton>
                )
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
                        form={EDIT_INSTITUTE_FORM_ID}
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
                    id={EDIT_INSTITUTE_FORM_ID}
                    className="flex flex-col gap-6"
                    onSubmit={handleSubmit(onSubmit, onInvalid)}
                >
                    {/* Logo */}
                    <div className="flex justify-center">
                        <div className="relative">
                            <div className="flex size-32 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-white p-2">
                                {isUploading ? (
                                    <CircleNotch className="size-6 animate-spin text-primary-500" />
                                ) : logoUrl ? (
                                    <img
                                        src={logoUrl}
                                        alt={t('logoAlt')}
                                        className="size-full object-contain"
                                    />
                                ) : (
                                    <Buildings className="size-12 text-neutral-300" />
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploading}
                                aria-label={t('logoAlt')}
                                className="absolute -bottom-2 -right-2 flex size-9 items-center justify-center rounded-full border-2 border-white bg-primary-500 text-white shadow-md transition-colors hover:bg-primary-400 disabled:opacity-60"
                            >
                                <Camera className="size-4" weight="bold" />
                            </button>
                            <FileUploadComponent
                                fileInputRef={fileInputRef}
                                onFileSubmit={handleFileSubmit}
                                control={form.control}
                                name="instituteProfilePictureId"
                                acceptedFileTypes="image/*"
                            />
                        </div>
                    </div>

                    {/* Basic details */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="instituteName"
                            render={({ field: { onChange, value, ...field } }) => (
                                <FormItem className="sm:col-span-2">
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t('fields.instituteName.placeholder')}
                                            input={value}
                                            onChangeFunction={onChange}
                                            required
                                            error={form.formState.errors.instituteName?.message}
                                            size="large"
                                            label={t('fields.instituteName.label')}
                                            className="sm:w-full"
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <SelectField
                            label={t('fields.instituteType.label')}
                            name="instituteType"
                            options={InstituteType.map((option, index) => ({
                                value: option,
                                label: option,
                                _id: index,
                            }))}
                            labelStyle="text-subtitle font-regular"
                            control={form.control}
                            className="sm:w-full"
                            required
                        />
                    </div>

                    <FormSection title={t('sections.contactInformation')}>
                        <FormField
                            control={form.control}
                            name="instituteEmail"
                            render={({ field: { onChange, value, ...field } }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t(
                                                'fields.instituteEmail.placeholder'
                                            )}
                                            input={value}
                                            onChangeFunction={onChange}
                                            error={form.formState.errors.instituteEmail?.message}
                                            size="large"
                                            label={t('fields.instituteEmail.label')}
                                            className="sm:w-full"
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="institutePhoneNumber"
                            render={() => (
                                <FormItem>
                                    <FormControl>
                                        <PhoneInputField
                                            label={t('fields.institutePhoneNumber.label')}
                                            placeholder={t(
                                                'fields.institutePhoneNumber.placeholder'
                                            )}
                                            name="institutePhoneNumber"
                                            control={form.control}
                                            labelStyle="text-subtitle font-regular"
                                            required={false}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="instituteWebsite"
                            render={({ field: { onChange, value, ...field } }) => (
                                <FormItem className="sm:col-span-2">
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t(
                                                'fields.instituteWebsite.placeholder'
                                            )}
                                            input={value}
                                            onChangeFunction={onChange}
                                            error={form.formState.errors.instituteWebsite?.message}
                                            size="large"
                                            label={t('fields.instituteWebsite.label')}
                                            className="sm:w-full"
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </FormSection>

                    <FormSection title={t('sections.locationDetails')}>
                        <FormField
                            control={form.control}
                            name="instituteAddress"
                            render={({ field: { onChange, value, ...field } }) => (
                                <FormItem className="sm:col-span-2">
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t(
                                                'fields.instituteAddress.placeholder'
                                            )}
                                            input={value}
                                            onChangeFunction={onChange}
                                            error={form.formState.errors.instituteAddress?.message}
                                            size="large"
                                            label={t('fields.instituteAddress.label')}
                                            className="sm:w-full"
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="instituteCity"
                            render={({ field: { onChange, value, ...field } }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t('fields.instituteCity.placeholder')}
                                            input={value}
                                            onChangeFunction={onChange}
                                            error={form.formState.errors.instituteCity?.message}
                                            size="large"
                                            label={t('fields.instituteCity.label')}
                                            className="sm:w-full"
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="instituteState"
                            render={({ field: { onChange, value, ...field } }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t(
                                                'fields.instituteState.placeholder'
                                            )}
                                            input={value}
                                            onChangeFunction={onChange}
                                            error={form.formState.errors.instituteState?.message}
                                            size="large"
                                            label={t('fields.instituteState.label')}
                                            className="sm:w-full"
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="instituteCountry"
                            render={({ field: { onChange, value, ...field } }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t(
                                                'fields.instituteCountry.placeholder'
                                            )}
                                            input={value}
                                            onChangeFunction={onChange}
                                            error={form.formState.errors.instituteCountry?.message}
                                            size="large"
                                            label={t('fields.instituteCountry.label')}
                                            className="sm:w-full"
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="institutePinCode"
                            render={({ field: { onChange, value, ...field } }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            inputType="text"
                                            inputPlaceholder={t(
                                                'fields.institutePinCode.placeholder'
                                            )}
                                            input={value}
                                            onChangeFunction={(
                                                e: React.ChangeEvent<HTMLInputElement>
                                            ) => {
                                                const filteredValue = e.target.value
                                                    .replace(/[^0-9+]/g, '') // allow only + and numbers
                                                    .slice(0, 11); // limit to 10 characters

                                                onChange(filteredValue);
                                            }}
                                            error={form.formState.errors.institutePinCode?.message}
                                            size="large"
                                            label={t('fields.institutePinCode.label')}
                                            className="sm:w-full"
                                            maxLength={11}
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </FormSection>

                    {/* Institute Theme */}
                    <FormSection title={t('sections.instituteTheme')}>
                        <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-col gap-2">
                                <span className="text-caption text-neutral-500">
                                    {t('theme.current')}
                                </span>
                                <div className="flex h-8 w-60 overflow-hidden rounded-md border border-neutral-200">
                                    {/* Shade hex comes from the institute's saved theme — dynamic, so inline style. */}
                                    {[...themeShades].reverse().map((shade, index) => (
                                        <div
                                            key={index}
                                            className="flex-1"
                                            style={{ backgroundColor: shade }}
                                        />
                                    ))}
                                </div>
                            </div>
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                onClick={() =>
                                    navigate({
                                        to: '/settings',
                                        search: { selectedTab: 'appearance' },
                                    })
                                }
                            >
                                <Palette className="size-4" />
                                {t('theme.changeTheme')}
                            </MyButton>
                        </div>
                    </FormSection>
                </form>
            </FormProvider>
        </MyDialog>
    );
};

const EDIT_INSTITUTE_FORM_ID = 'edit-institute-form';

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-4 border-t border-neutral-200 pt-6">
            <h3 className="text-subtitle font-semibold text-neutral-700">{title}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
        </section>
    );
}

export default EditDashboardProfileComponent;
