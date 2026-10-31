import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyDropdown } from '@/components/common/students/enroll-manually/dropdownForPackageItems';
import { MyInput } from '@/components/design-system/input';
import PhoneInputField from '@/components/design-system/phone-input-field';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import EnrollFormUploadImage from '@/assets/svgs/enroll-form-upload-image.svg';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { useFileUpload } from '@/hooks/use-file-upload';

import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useEditStudentDetails } from '@/routes/manage-students/students-list/-services/editStudentDetails';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { useGetStudentDetails } from '@/services/get-student-details';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { DropdownValueType } from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import {
    PencilSimple,
    Upload,
    Trash,
    UserCircle,
    Phone,
    MapPin,
    Buildings,
    UsersThree,
    Image as ImageIcon,
    SlidersHorizontal,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import {
    getCustomFieldSettingsFromCache,
    type CustomField,
    type FieldGroup,
} from '@/services/custom-field-settings';
import { getFieldsForLocation, type FieldForLocation } from '@/lib/custom-fields/utils';
import { getSystemFieldColumnVisibility } from '@/components/design-system/utils/constants/system-field-columns';
import { cn } from '@/lib/utils';

const buildEditStudentDetailsFormSchema = (t: TFunction) =>
    z.object({
        user_id: z.string().min(1, t('manageStudentsEditStudentDetails:validation.required')),
        username: z.string().optional(),
        email: z.string().email(t('manageStudentsEditStudentDetails:validation.invalidEmail')),
        full_name: z.string().min(1, t('manageStudentsEditStudentDetails:validation.required')),
        contact_number: z
            .string()
            .min(1, t('manageStudentsEditStudentDetails:validation.required')),
        gender: z.string().optional(),
        date_of_birth: z.string().optional(),
        address_line: z.string().optional(),
        state: z.string().optional(),
        city: z.string().optional(),
        pin_code: z.string().optional(),
        institute_name: z.string().optional(),
        fathers_name: z.string().optional(),
        mothers_name: z.string().optional(),
        father_mobile_number: z.string().optional(),
        father_email: z
            .string()
            .email(t('manageStudentsEditStudentDetails:validation.invalidEmailShort'))
            .optional()
            .or(z.literal('')),
        mother_mobile_number: z.string().optional(),
        mother_email: z
            .string()
            .email(t('manageStudentsEditStudentDetails:validation.invalidEmailShort'))
            .optional()
            .or(z.literal('')),
        face_file_id: z.string().optional().or(z.literal('')),
        custom_fields: z.record(z.string()).optional(),
    });

export type EditStudentDetailsFormValues = z.infer<
    ReturnType<typeof buildEditStudentDetailsFormSchema>
>;

// ── Local presentational helpers ──────────────────────────────────────────────

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

const Grid2 = ({ children }: { children: React.ReactNode }) => (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
);

const Grid3 = ({ children }: { children: React.ReactNode }) => (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">{children}</div>
);

const SubGroupTitle = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-2 border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {children}
        </span>
    </div>
);

// Style block that normalizes PhoneInputField to the same chrome as MyInput.
//
// react-phone-input-2 bundles its own bootstrap.css with rules like:
//   `.react-tel-input .form-control { width: 300px; padding: 18.5px 14px 18.5px 60px; font-size: 16px; }`
// These are loaded at runtime via the import in PhoneInputField, and Tailwind's
// arbitrary-variant overrides DON'T reliably win because of CSS cascade timing
// — bootstrap may load AFTER Tailwind's bundle, beating equal-specificity rules.
//
// The only bulletproof fix is an explicit `!important` rule keyed on a unique
// class. Targeting `.efp-phone` ensures these rules only apply to phone inputs
// inside THIS form, never bleeding into PhoneInputField's 8 other consumers.
const PHONE_INPUT_OVERRIDE_CSS = `
.efp-phone > div { display: flex; flex-direction: column; row-gap: 4px; }
.efp-phone .react-tel-input { width: 100% !important; font-size: 14px !important; }
.efp-phone .react-tel-input .form-control {
  width: 100% !important;
  height: 36px !important;
  padding: 4px 12px 4px 52px !important;
  font-size: 14px !important;
  line-height: 1.2 !important;
}
.efp-phone .react-tel-input .flag-dropdown,
.efp-phone .react-tel-input .selected-flag {
  height: 36px !important;
}
`;

const FullWidth = ({ children }: { children: React.ReactNode }) => (
    <div className="efp-phone w-full">{children}</div>
);

// ── Main component ───────────────────────────────────────────────────────────

export const EditStudentDetails = () => {
    const { t } = useTranslation('manageStudentsEditStudentDetails');
    const editStudentDetailsFormSchema = useMemo(() => buildEditStudentDetailsFormSchema(t), [t]);
    const { selectedStudent, setSelectedStudent } = useStudentSidebar();
    const { data: studentDetails } = useGetStudentDetails(selectedStudent?.user_id || '');
    const form = useForm<EditStudentDetailsFormValues>({
        resolver: zodResolver(editStudentDetailsFormSchema),
        defaultValues: {},
    });

    const { setValue } = form;
    const { instituteDetails } = useInstituteDetailsStore();
    const genderList: DropdownValueType[] =
        instituteDetails?.genders.map((gender) => ({ id: crypto.randomUUID(), name: gender })) ||
        [];

    const INSTITUTE_ID = getCurrentInstituteId();

    const [faceUrl, setFaceUrl] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const { uploadFile, getPublicUrl } = useFileUpload();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const [openDialog, setOpenDialog] = useState(false);
    const [removedImage, setRemovedImage] = useState(false);

    // Gate custom fields on the SAME "Learner's List" visibility toggle the
    // Overview tab uses, so a field hidden there is also hidden here when editing.
    // (Previously this also merged in "Learner's Enrollment" fields, so a field
    // toggled off for the Learner's List still appeared in the edit form.)
    const customFieldsData = useMemo(() => {
        const fields = getFieldsForLocation("Learner's List");

        const settings = getCustomFieldSettingsFromCache();
        if (!settings) {
            return { customFields: fields, fieldGroups: [], individualFields: fields };
        }

        const visibilityKey = 'learnersList';
        const visibleGroups = settings.fieldGroups.filter((group) =>
            group.fields.some((field) => field.visibility[visibilityKey])
        );
        const filteredGroups = visibleGroups.map((group) => ({
            ...group,
            fields: group.fields.filter((field) => field.visibility[visibilityKey]),
        }));
        const fieldIdsInGroups = new Set(
            filteredGroups.flatMap((group) => group.fields.map((f) => f.id))
        );
        const individualFields = fields.filter((field) => !fieldIdsInGroups.has(field.id));

        return { customFields: fields, fieldGroups: filteredGroups, individualFields };
    }, []);

    const hasCustomFields =
        customFieldsData.fieldGroups.length > 0 || customFieldsData.individualFields.length > 0;

    // Gate the optional system fields (address, institute, parents/guardians) by
    // the SAME visibility toggle the Overview uses — a field turned off in
    // settings should be hidden in the edit form too. Required core fields
    // (name, email, mobile, gender) always show since the form needs them.
    const sysVisible = getSystemFieldColumnVisibility();
    const showField = (accessor: string) => sysVisible[accessor] !== false;

    const loadImage = async (fileId: string) => {
        if (fileId) {
            const url = await getPublicUrl(fileId);
            setFaceUrl(url || '');
        }
    };

    useEffect(() => {
        if (selectedStudent && openDialog) {
            const s = studentDetails || selectedStudent;

            const customFieldsValues: Record<string, string> = {};
            const customFieldsSource = s.custom_fields || selectedStudent.custom_fields;
            if (customFieldsSource) {
                Object.entries(customFieldsSource).forEach(([key, value]) => {
                    if (value !== null && value !== undefined) {
                        customFieldsValues[key] = value as string;
                    }
                });
            }

            form.reset({
                user_id: selectedStudent.user_id || '',
                username: s.username || selectedStudent.username || '',
                email: s.email || selectedStudent.email || '',
                full_name: s.full_name || selectedStudent.full_name || '',
                contact_number: s.mobile_number || selectedStudent.mobile_number || '',
                gender: s.gender || selectedStudent.gender || '',
                date_of_birth: s.date_of_birth || selectedStudent.date_of_birth || '',
                address_line: s.address_line || selectedStudent.address_line || '',
                city: s.city || selectedStudent.city || '',
                state: s.region || selectedStudent.region || '',
                pin_code: s.pin_code || selectedStudent.pin_code || '',
                institute_name: s.linked_institute_name || selectedStudent.linked_institute_name || '',
                fathers_name: s.fathers_name || selectedStudent.fathers_name || '',
                mothers_name: s.mothers_name || selectedStudent.mothers_name || '',
                father_mobile_number:
                    s.parents_mobile_number ||
                    selectedStudent.parents_mobile_number ||
                    selectedStudent.father_mobile_number ||
                    '',
                father_email:
                    s.parents_email ||
                    selectedStudent.parents_email ||
                    selectedStudent.father_email ||
                    '',
                mother_mobile_number:
                    s.parents_to_mother_mobile_number ||
                    selectedStudent.parents_to_mother_mobile_number ||
                    selectedStudent.mother_mobile_number ||
                    '',
                mother_email:
                    s.parents_to_mother_email ||
                    selectedStudent.parents_to_mother_email ||
                    selectedStudent.mother_email ||
                    '',
                face_file_id: s.face_file_id || selectedStudent.face_file_id || '',
                custom_fields: customFieldsValues,
            });

            const faceFileId = s.face_file_id || selectedStudent.face_file_id;
            if (faceFileId && !removedImage) {
                loadImage(faceFileId);
            } else {
                setFaceUrl(null);
            }

            setRemovedImage(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStudent, openDialog, studentDetails]);

    const handleFileSubmit = async (file: File) => {
        setIsUploading(true);
        const fileId = await uploadFile({
            file,
            setIsUploading,
            userId: selectedStudent?.user_id || '',
            source: INSTITUTE_ID || '',
            sourceId: 'STUDENTS',
        });

        if (fileId) {
            await loadImage(fileId);
            setValue('face_file_id', fileId, { shouldDirty: true });
        }

        setIsUploading(false);
    };

    const handleRemoveImage = () => {
        setFaceUrl(null);
        setValue('face_file_id', '', { shouldDirty: true });
        setRemovedImage(true);
    };

    const handleDialogChange = (isOpen: boolean) => {
        if (!isOpen && form.formState.isDirty) {
            const ok = window.confirm(t('discardConfirm'));
            if (!ok) return;
        }
        setOpenDialog(isOpen);
    };

    const editStudentDetailsMutation = useEditStudentDetails();
    const onSubmit = async (values: EditStudentDetailsFormValues) => {
        try {
            const face_file_id = form.getValues('face_file_id') ?? '';
            const payload = { ...values, face_file_id };

            await editStudentDetailsMutation.mutateAsync(payload);

            if (selectedStudent) {
                const updatedStudent = {
                    ...selectedStudent,
                    ...payload,
                    id: selectedStudent.id,
                    mobile_number: payload.contact_number,
                    region: payload.state ?? null,
                    linked_institute_name: payload.institute_name ?? null,
                    face_file_id: payload.face_file_id ?? '',
                };
                setSelectedStudent(updatedStudent);
            }

            if (face_file_id) {
                const newFaceUrl = await getPublicUrl(face_file_id);
                setFaceUrl(newFaceUrl || '');
            } else {
                setFaceUrl(null);
            }

            setOpenDialog(false);
        } catch (err) {
            console.error('Failed to update student:', err);
        }
    };

    const isDirty = form.formState.isDirty;

    const footer = (
        <>
            <span
                className={cn(
                    'mr-auto flex items-center gap-1.5 text-xs font-medium',
                    isDirty ? 'text-primary-600' : 'text-neutral-400'
                )}
            >
                <span
                    className={cn(
                        'flex size-1.5 rounded-full',
                        isDirty ? 'bg-primary-500' : 'bg-success-500'
                    )}
                />
                {isDirty ? t('unsavedChanges') : t('allChangesSaved')}
            </span>
            <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                onClick={() => handleDialogChange(false)}
            >
                {t('cancel')}
            </MyButton>
            <MyButton
                onAsyncClick={async () => {
                    const isValid = await form.trigger();
                    if (isValid) await form.handleSubmit(onSubmit)();
                }}
                disable={!isDirty}
                loadingText={t('saving')}
            >
                {t('saveChanges')}
            </MyButton>
        </>
    );

    // ── Field cells — declared once, reused inside the layout ────────────────

    const fullNameField = (
        <FormField
            control={form.control}
            name="full_name"
            render={({ field }) => (
                <FormItem className="w-full sm:w-full">
                    <FormControl className="w-full sm:w-full">
                        <MyInput
                            input={field.value}
                            onChangeFunction={(e) => field.onChange(e.target.value)}
                            inputType="text"
                            inputPlaceholder={t('fields.fullName.placeholder')}
                            className="w-full sm:w-full"
                            required={true}
                            label={t('fields.fullName.label')}
                            error={form.formState.errors.full_name?.message}
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const genderField = (
        <FormField
            control={form.control}
            name="gender"
            render={({ field }) => {
                const selectedGender = field.value
                    ? genderList.find(
                          (g) =>
                              (typeof g === 'object' && 'name' in g && g.name === field.value) ||
                              g === field.value
                      )
                    : undefined;
                return (
                    <FormItem className="w-full sm:w-full">
                        <FormControl>
                            <div className="flex w-full flex-col gap-1">
                                <label className="text-sm font-medium text-neutral-700">
                                    {t('fields.gender.label')}
                                </label>
                                <MyDropdown
                                    currentValue={selectedGender}
                                    dropdownList={genderList}
                                    handleChange={(value) => {
                                        if (typeof value === 'object' && 'name' in value) {
                                            field.onChange(value.name);
                                        } else if (typeof value === 'string') {
                                            field.onChange(value);
                                        }
                                    }}
                                    placeholder={t('fields.gender.placeholder')}
                                    error={form.formState.errors.gender?.message}
                                    required={false}
                                />
                            </div>
                        </FormControl>
                    </FormItem>
                );
            }}
        />
    );

    const emailField = (
        <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
                <FormItem className="w-full sm:w-full">
                    <FormControl className="w-full sm:w-full">
                        <MyInput
                            input={field.value}
                            onChangeFunction={(e) => field.onChange(e.target.value)}
                            inputType="text"
                            inputPlaceholder={t('fields.email.placeholder')}
                            className="w-full sm:w-full"
                            required={true}
                            label={t('fields.email.label')}
                            error={form.formState.errors.email?.message}
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const mobileField = (
        <FormField
            control={form.control}
            name="contact_number"
            render={() => (
                <FormItem className="w-full sm:w-full">
                    <FormControl>
                        <FullWidth>
                            <PhoneInputField
                                label={t('fields.mobile.label')}
                                placeholder={t('fields.mobile.placeholder')}
                                name="contact_number"
                                control={form.control}
                                required={true}
                            />
                            {form.formState.errors.contact_number?.message && (
                                <p className="mt-1 text-caption text-danger-600">
                                    {form.formState.errors.contact_number?.message}
                                </p>
                            )}
                        </FullWidth>
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const addressLineField = (
        <FormField
            control={form.control}
            name="address_line"
            render={({ field }) => (
                <FormItem className="w-full sm:w-full">
                    <FormControl className="w-full sm:w-full">
                        <MyInput
                            input={field.value}
                            onChangeFunction={(e) => field.onChange(e.target.value)}
                            inputType="text"
                            inputPlaceholder={t('fields.addressLine.placeholder')}
                            className="w-full sm:w-full"
                            label={t('fields.addressLine.label')}
                            error={form.formState.errors.address_line?.message}
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const cityField = (
        <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
                <FormItem className="w-full sm:w-full">
                    <FormControl className="w-full sm:w-full">
                        <MyInput
                            input={field.value}
                            onChangeFunction={(e) => field.onChange(e.target.value)}
                            inputType="text"
                            inputPlaceholder={t('fields.city.placeholder')}
                            className="w-full sm:w-full"
                            label={t('fields.city.label')}
                            error={form.formState.errors.city?.message}
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const stateField = (
        <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
                <FormItem className="w-full sm:w-full">
                    <FormControl className="w-full sm:w-full">
                        <MyInput
                            input={field.value}
                            onChangeFunction={(e) => field.onChange(e.target.value)}
                            inputType="text"
                            inputPlaceholder={t('fields.state.placeholder')}
                            className="w-full sm:w-full"
                            label={t('fields.state.label')}
                            error={form.formState.errors.state?.message}
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const pinField = (
        <FormField
            control={form.control}
            name="pin_code"
            render={({ field: { onChange, value, ...field } }) => (
                <FormItem className="w-full sm:w-full">
                    <FormControl className="w-full sm:w-full">
                        {/* Pincode rendered as text — `type="number"` adds a stepper
                            and strips leading zeros, both wrong for a postal code.
                            `inputMode="numeric"` keeps the numeric keypad on mobile. */}
                        <MyInput
                            inputType="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            label={t('fields.pincode.label')}
                            inputPlaceholder={t('fields.pincode.placeholder')}
                            input={value}
                            onChangeFunction={onChange}
                            className="w-full sm:w-full"
                            {...field}
                            error={form.formState.errors.pin_code?.message}
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const instituteField = (
        <FormField
            control={form.control}
            name="institute_name"
            render={({ field }) => (
                <FormItem className="w-full sm:w-full">
                    <FormControl className="w-full sm:w-full">
                        <MyInput
                            input={field.value}
                            onChangeFunction={(e) => field.onChange(e.target.value)}
                            inputType="text"
                            inputPlaceholder={t('fields.instituteName.placeholder')}
                            className="w-full sm:w-full"
                            label={t('fields.instituteName.label')}
                            error={form.formState.errors.institute_name?.message}
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const fathersNameField = (
        <FormField
            control={form.control}
            name="fathers_name"
            render={({ field }) => (
                <FormItem className="w-full sm:w-full">
                    <FormControl className="w-full sm:w-full">
                        <MyInput
                            input={field.value}
                            onChangeFunction={(e) => field.onChange(e.target.value)}
                            inputType="text"
                            inputPlaceholder={t('fields.fatherName.placeholder')}
                            className="w-full sm:w-full"
                            label={t('fields.fatherName.label')}
                            error={form.formState.errors.fathers_name?.message}
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const fatherMobileField = (
        <FormField
            control={form.control}
            name="father_mobile_number"
            render={() => (
                <FormItem className="w-full sm:w-full">
                    <FormControl>
                        <FullWidth>
                            <PhoneInputField
                                label={t('fields.mobile.label')}
                                placeholder={t('fields.mobile.placeholder')}
                                name="father_mobile_number"
                                control={form.control}
                                required={false}
                            />
                        </FullWidth>
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const fatherEmailField = (
        <FormField
            control={form.control}
            name="father_email"
            render={({ field }) => (
                <FormItem className="w-full sm:w-full">
                    <FormControl className="w-full sm:w-full">
                        <MyInput
                            input={field.value}
                            onChangeFunction={(e) => field.onChange(e.target.value)}
                            inputType="email"
                            inputPlaceholder={t('fields.email.placeholder')}
                            className="w-full sm:w-full"
                            label={t('fields.email.label')}
                            error={form.formState.errors.father_email?.message}
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const mothersNameField = (
        <FormField
            control={form.control}
            name="mothers_name"
            render={({ field }) => (
                <FormItem className="w-full sm:w-full">
                    <FormControl className="w-full sm:w-full">
                        <MyInput
                            input={field.value}
                            onChangeFunction={(e) => field.onChange(e.target.value)}
                            inputType="text"
                            inputPlaceholder={t('fields.motherName.placeholder')}
                            className="w-full sm:w-full"
                            label={t('fields.motherName.label')}
                            error={form.formState.errors.mothers_name?.message}
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const motherMobileField = (
        <FormField
            control={form.control}
            name="mother_mobile_number"
            render={() => (
                <FormItem className="w-full sm:w-full">
                    <FormControl>
                        <FullWidth>
                            <PhoneInputField
                                label={t('fields.mobile.label')}
                                placeholder={t('fields.mobile.placeholder')}
                                name="mother_mobile_number"
                                control={form.control}
                                required={false}
                            />
                        </FullWidth>
                    </FormControl>
                </FormItem>
            )}
        />
    );

    const motherEmailField = (
        <FormField
            control={form.control}
            name="mother_email"
            render={({ field }) => (
                <FormItem className="w-full sm:w-full">
                    <FormControl className="w-full sm:w-full">
                        <MyInput
                            input={field.value}
                            onChangeFunction={(e) => field.onChange(e.target.value)}
                            inputType="email"
                            inputPlaceholder={t('fields.email.placeholder')}
                            className="w-full sm:w-full"
                            label={t('fields.email.label')}
                            error={form.formState.errors.mother_email?.message}
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    // Accepts EITHER shape — grouped fields come through as CustomField[] while
    // ungrouped fields are FieldForLocation[]; the two differ only in fields this
    // function never reads (e.g. groupName: string|null vs string|undefined). It
    // only uses id/name/type/options/required, common to both, so the union is safe.
    const renderCustomField = (customField: CustomField | FieldForLocation) => {
        if (customField.type === 'dropdown') {
            const dropdownOptions =
                customField.options?.map((option) => ({ id: option, name: option })) || [];
            return (
                <FormField
                    key={customField.id}
                    control={form.control}
                    name="custom_fields"
                    render={({ field }) => {
                        const currentValue = field.value?.[customField.id];
                        const selectedOption = currentValue
                            ? { id: currentValue, name: currentValue }
                            : undefined;
                        return (
                            <FormItem className="w-full sm:w-full">
                                <FormControl>
                                    <div className="flex w-full flex-col gap-1">
                                        <label className="text-sm font-medium text-neutral-700">
                                            {customField.name}
                                            {customField.required && (
                                                <span className="ml-1 text-danger-500">*</span>
                                            )}
                                        </label>
                                        <MyDropdown
                                            currentValue={selectedOption}
                                            dropdownList={dropdownOptions}
                                            handleChange={(value) => {
                                                if (typeof value === 'object' && 'id' in value) {
                                                    const next = {
                                                        ...(field.value || {}),
                                                        [customField.id]: value.id,
                                                    };
                                                    field.onChange(next);
                                                }
                                            }}
                                            placeholder={t('customField.selectPlaceholder', {
                                                name: customField.name,
                                            })}
                                            required={customField.required}
                                            disable={false}
                                        />
                                    </div>
                                </FormControl>
                            </FormItem>
                        );
                    }}
                />
            );
        }

        return (
            <FormField
                key={customField.id}
                control={form.control}
                name="custom_fields"
                render={({ field }) => (
                    <FormItem className="w-full sm:w-full">
                        <FormControl>
                            <MyInput
                                inputType={customField.type === 'number' ? 'number' : 'text'}
                                label={customField.name}
                                inputPlaceholder={t('customField.enterPlaceholder', {
                                    name: customField.name,
                                })}
                                input={field.value?.[customField.id] || ''}
                                onChangeFunction={(e) => {
                                    const next = {
                                        ...(field.value || {}),
                                        [customField.id]: e.target.value,
                                    };
                                    field.onChange(next);
                                }}
                                required={customField.required}
                                className="w-full sm:w-full"
                            />
                        </FormControl>
                    </FormItem>
                )}
            />
        );
    };

    // ── Render ───────────────────────────────────────────────────────────────

    if (!selectedStudent) return <p>{t('noStudentFound')}</p>;

    return (
        <MyDialog
            trigger={
                <MyButton buttonType="secondary" scale="medium">
                    <PencilSimple className="size-4" />
                    {t('trigger')}
                </MyButton>
            }
            footer={footer}
            heading={t('dialogHeading', {
                term: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
            })}
            open={openDialog}
            onOpenChange={handleDialogChange}
            dialogWidth="max-w-2xl"
        >
            <FormProvider {...form}>
                {/* Phone-input chrome override — see PHONE_INPUT_OVERRIDE_CSS. */}
                <style dangerouslySetInnerHTML={{ __html: PHONE_INPUT_OVERRIDE_CSS }} />
                <form
                    ref={formRef}
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-5"
                >
                    {/* PROFILE PHOTO */}
                    <FormCard
                        icon={ImageIcon}
                        title={t('sections.photo.title')}
                        helper={t('sections.photo.helper')}
                    >
                        <div className="flex items-center gap-4">
                            {isUploading ? (
                                <div className="flex size-20 items-center justify-center">
                                    <DashboardLoader />
                                </div>
                            ) : faceUrl ? (
                                <img
                                    src={faceUrl}
                                    alt={t('photo.alt')}
                                    className="size-20 shrink-0 rounded-full object-cover ring-2 ring-primary-100"
                                />
                            ) : (
                                <div className="flex size-20 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-neutral-200 bg-neutral-50">
                                    <EnrollFormUploadImage />
                                </div>
                            )}

                            <div className="flex flex-wrap gap-2">
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => fileInputRef.current?.click()}
                                    disable={isUploading}
                                >
                                    <Upload className="size-4" />
                                    {faceUrl ? t('photo.replace') : t('photo.upload')}
                                </MyButton>
                                {faceUrl && (
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        scale="small"
                                        onClick={handleRemoveImage}
                                        disable={isUploading}
                                    >
                                        <Trash className="size-4" />
                                        {t('photo.remove')}
                                    </MyButton>
                                )}
                            </div>

                            <FileUploadComponent
                                fileInputRef={fileInputRef}
                                onFileSubmit={handleFileSubmit}
                                control={form.control}
                                name="face_file_id"
                                acceptedFileTypes="image/*"
                            />
                        </div>
                    </FormCard>

                    {/* IDENTITY */}
                    <FormCard
                        icon={UserCircle}
                        title={t('sections.identity.title')}
                        helper={t('sections.identity.helper')}
                    >
                        <Grid2>
                            {fullNameField}
                            {genderField}
                        </Grid2>
                    </FormCard>

                    {/* CONTACT */}
                    <FormCard
                        icon={Phone}
                        title={t('sections.contact.title')}
                        helper={t('sections.contact.helper')}
                    >
                        <Grid2>
                            {emailField}
                            {mobileField}
                        </Grid2>
                    </FormCard>

                    {/* ADDRESS — each field gated by its visibility toggle; the
                        whole card hides when every address field is off. */}
                    {(showField('address_line') ||
                        showField('city') ||
                        showField('region') ||
                        showField('pin_code')) && (
                        <FormCard
                            icon={MapPin}
                            title={t('sections.address.title')}
                            helper={t('sections.address.helper')}
                        >
                            {showField('address_line') && addressLineField}
                            <Grid3>
                                {showField('city') && cityField}
                                {showField('region') && stateField}
                                {showField('pin_code') && pinField}
                            </Grid3>
                        </FormCard>
                    )}

                    {/* INSTITUTE */}
                    {showField('linked_institute_name') && (
                        <FormCard
                            icon={Buildings}
                            title={t('sections.institute.title')}
                            helper={t('sections.institute.helper')}
                        >
                            {instituteField}
                        </FormCard>
                    )}

                    {/* FAMILY — subgroups + the whole card hide when their fields
                        are toggled off. */}
                    {(showField('fathers_name') ||
                        showField('parents_mobile_number') ||
                        showField('parents_email') ||
                        showField('mothers_name') ||
                        showField('parents_to_mother_mobile_number') ||
                        showField('parents_to_mother_email')) && (
                        <FormCard
                            icon={UsersThree}
                            title={t('sections.family.title')}
                            helper={t('sections.family.helper')}
                        >
                            {/* Father */}
                            {(showField('fathers_name') ||
                                showField('parents_mobile_number') ||
                                showField('parents_email')) && (
                                <>
                                    <SubGroupTitle>{t('subgroups.father')}</SubGroupTitle>
                                    {showField('fathers_name') && fathersNameField}
                                    <Grid2>
                                        {showField('parents_mobile_number') && fatherMobileField}
                                        {showField('parents_email') && fatherEmailField}
                                    </Grid2>
                                </>
                            )}
                            {/* Mother */}
                            {(showField('mothers_name') ||
                                showField('parents_to_mother_mobile_number') ||
                                showField('parents_to_mother_email')) && (
                                <>
                                    <SubGroupTitle>{t('subgroups.mother')}</SubGroupTitle>
                                    {showField('mothers_name') && mothersNameField}
                                    <Grid2>
                                        {showField('parents_to_mother_mobile_number') &&
                                            motherMobileField}
                                        {showField('parents_to_mother_email') && motherEmailField}
                                    </Grid2>
                                </>
                            )}
                        </FormCard>
                    )}

                    {/* CUSTOM */}
                    {hasCustomFields && (
                        <FormCard
                            icon={SlidersHorizontal}
                            title={t('sections.custom.title')}
                            helper={t('sections.custom.helper')}
                        >
                            {customFieldsData.fieldGroups.map((group: FieldGroup) => (
                                <div key={group.id} className="flex flex-col gap-3">
                                    <SubGroupTitle>{group.name}</SubGroupTitle>
                                    <div className="flex w-full flex-col gap-4">
                                        {group.fields.map((cf: CustomField) =>
                                            renderCustomField(cf)
                                        )}
                                    </div>
                                </div>
                            ))}
                            {customFieldsData.individualFields.length > 0 && (
                                <div className="flex flex-col gap-4">
                                    {customFieldsData.individualFields.map((cf) =>
                                        renderCustomField(cf)
                                    )}
                                </div>
                            )}
                        </FormCard>
                    )}
                </form>
            </FormProvider>
        </MyDialog>
    );
};
