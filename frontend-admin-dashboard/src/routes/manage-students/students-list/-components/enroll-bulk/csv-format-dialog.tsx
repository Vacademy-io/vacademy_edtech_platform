import { MyDialog } from '@/components/design-system/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { UploadCSVButton } from './upload-csv-button';
import { enrollBulkFormType } from '@/routes/manage-students/students-list/-schemas/student-bulk-enroll/enroll-bulk-schema';
import { CSVFormatFormType } from '@/routes/manage-students/students-list/-schemas/student-bulk-enroll/enroll-bulk-schema';
import { csvFormatSchema } from '@/routes/manage-students/students-list/-schemas/student-bulk-enroll/enroll-bulk-schema';

export const CSVFormatDialog = ({
    packageDetails,
    openDialog,
    setOpenDialog,
}: {
    packageDetails: enrollBulkFormType;
    openDialog: boolean;
    setOpenDialog: Dispatch<SetStateAction<boolean>>;
}) => {
    const { t } = useTranslation('manageStudentsCsvFormatDialog');
    const defaultValues = {
        autoGenerateUsername: true,
        autoGeneratePassword: true,
        autoGenerateEnrollmentId: true,
        setCommonExpiryDate: true,
        daysFromToday: '365',
        addStudentStatus: true,
        studentStatus: 'ACTIVE',
        fatherName: false,
        motherName: false,
        fatherEmail: false,
        motherEmail: false,
        fatherMobile: false,
        motherMobile: false,
        collegeName: false,
        state: false,
        city: false,
        pincode: false,
    };
    const [csvFormatFormValues, setCsvFormatFormValues] = useState(defaultValues);

    const form = useForm<CSVFormatFormType>({
        resolver: zodResolver(csvFormatSchema),
        defaultValues: defaultValues,
    });

    const handleOpenChange = () => {
        setOpenDialog(!openDialog);
    };

    const onSubmit = (data: CSVFormatFormType) => {
        setCsvFormatFormValues(data);
    };

    const footer = (
        <div
            className="flex justify-end"
            onClick={() => {
                formRef.current?.requestSubmit();
            }}
        >
            <UploadCSVButton
                packageDetails={packageDetails}
                csvFormatDetails={csvFormatFormValues}
                setOpenDialog={setOpenDialog} // Pass down the setter function
            />
        </div>
    );

    const formRef = useRef<HTMLFormElement>(null);

    return (
        <MyDialog
            heading={t('title')}
            dialogWidth="w-full"
            open={openDialog}
            onOpenChange={handleOpenChange}
            footer={footer}
        >
            <div className="px-6 text-neutral-600">
                <Form {...form}>
                    <form
                        ref={formRef}
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="flex flex-col gap-6"
                    >
                        <div className="flex flex-col gap-4">
                            <h3 className="font-medium text-neutral-900">
                                {t('sections.enrollmentPreferences')}
                            </h3>
                            <div className="flex flex-col gap-3">
                                <FormField
                                    control={form.control}
                                    name="autoGenerateUsername"
                                    render={({ field }) => (
                                        <FormItem className="flex items-end space-x-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                            </FormControl>
                                            <FormLabel className="font-normal">
                                                {t('preferences.autoGenerateUsername')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="autoGeneratePassword"
                                    render={({ field }) => (
                                        <FormItem className="flex items-end space-x-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                            </FormControl>
                                            <FormLabel className="font-normal">
                                                {t('preferences.autoGeneratePassword')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="autoGenerateEnrollmentId"
                                    render={({ field }) => (
                                        <FormItem className="flex items-end space-x-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                            </FormControl>
                                            <FormLabel className="font-normal">
                                                {t('preferences.autoGenerateEnrollmentId')}
                                            </FormLabel>
                                        </FormItem>
                                    )}
                                />

                                <div className="flex items-center gap-6">
                                    <FormField
                                        control={form.control}
                                        name="setCommonExpiryDate"
                                        render={({ field }) => (
                                            <FormItem className="flex items-end space-x-2">
                                                <FormControl className="flex items-center">
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                    />
                                                </FormControl>
                                                <FormLabel className="font-normal">
                                                    {t('preferences.setCommonExpiryDate')}
                                                </FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="daysFromToday"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <Input {...field} className="w-14" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <span className="text-neutral-600">
                                        {t('preferences.daysFromToday')}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <FormField
                                        control={form.control}
                                        name="addStudentStatus"
                                        render={({ field }) => (
                                            <FormItem className="flex items-end space-x-2">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                    />
                                                </FormControl>
                                                <FormLabel className="font-normal">
                                                    {t('preferences.addStudentStatus')}
                                                </FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="studentStatus"
                                        render={({ field }) => (
                                            <FormItem>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    defaultValue={field.value}
                                                >
                                                    <SelectTrigger className="w-32">
                                                        <SelectValue
                                                            placeholder={t(
                                                                'preferences.selectStatusPlaceholder'
                                                            )}
                                                        />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="ACTIVE">
                                                            {t('preferences.statusActive')}
                                                        </SelectItem>
                                                        <SelectItem value="INACTIVE">
                                                            {t('preferences.statusInactive')}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-4">
                            <h3 className="font-medium text-neutral-900">
                                {t('sections.optionalColumnSelection')}
                            </h3>
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { name: 'fatherName', label: t('columns.fatherName') },
                                    { name: 'collegeName', label: t('columns.collegeName') },
                                    { name: 'motherName', label: t('columns.motherName') },
                                    { name: 'state', label: t('columns.state') },
                                    // { name: 'guardianName', label: "Guardian's Name" },
                                    { name: 'city', label: t('columns.city') },
                                    { name: 'fatherEmail', label: t('columns.fatherEmail') },
                                    {
                                        name: 'motherEmail',
                                        label: t('columns.motherEmail'),
                                    },
                                    { name: 'pincode', label: t('columns.pincode') },
                                    {
                                        name: 'fatherMobile',
                                        label: t('columns.fatherMobile'),
                                    },
                                    {
                                        name: 'motherMobile',
                                        label: t('columns.motherMobile'),
                                    },
                                ].map((field) => (
                                    <FormField
                                        key={field.name}
                                        control={form.control}
                                        name={field.name as keyof CSVFormatFormType}
                                        render={({ field: formField }) => (
                                            <FormItem className="flex items-end space-x-2">
                                                <FormControl>
                                                    <Checkbox
                                                        // checked={formField.value}
                                                        onCheckedChange={formField.onChange}
                                                    />
                                                </FormControl>
                                                <FormLabel className="font-normal">
                                                    {field.label}
                                                </FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                ))}
                            </div>
                        </div>
                    </form>
                </Form>
            </div>
        </MyDialog>
    );
};
