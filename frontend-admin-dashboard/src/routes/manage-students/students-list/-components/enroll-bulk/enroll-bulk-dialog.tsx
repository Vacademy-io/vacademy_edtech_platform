import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Form, FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { MyDropdown } from '@/components/common/students/enroll-manually/dropdownForPackageItems';
import { DropdownItemType } from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import { CSVFormatDialog } from './csv-format-dialog';
import {
    enrollBulkFormSchema,
    enrollBulkFormType,
} from '@/routes/manage-students/students-list/-schemas/student-bulk-enroll/enroll-bulk-schema';
import { MyButton } from '@/components/design-system/button';
import { CourseFormData } from '@/components/common/study-library/add-course/add-course-form';
import { toast } from 'sonner';
import { useAddCourse } from '@/services/study-library/course-operations/add-course';
import { useAddSession } from '@/services/study-library/session-management/addSession';
import { useAddLevel } from '@/routes/study-library/courses/course-details/-services/add-level';
import { AddSessionDataType } from '@/routes/manage-institute/sessions/-components/session-operations/add-session/add-session-form';
import { AddLevelData } from '@/routes/study-library/courses/course-details/-components/add-course-details-form';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';

export const EnrollBulkDialog = () => {
    const { t } = useTranslation('manageStudentsEnrollBulkDialog');
    const { getCourseFromPackage, getSessionFromPackage, getLevelsFromPackage, instituteDetails } =
        useInstituteDetailsStore();
    const [openSetFormatDialog, setOpenSetFormatDialog] = useState(false);

    const defaultFormValues = {
        course: {
            id: '',
            name: '',
        },
        session: {
            id: '',
            name: '',
        },
        level: {
            id: '',
            name: '',
        },
    };

    useEffect(() => {
        setCourseList(getCourseFromPackage());
        form.reset({
            course: {
                id: '',
                name: '',
            },
        });
        setSessionList(getSessionFromPackage());
        form.reset({
            session: {
                id: '',
                name: '',
            },
        });
        setLevelList(getLevelsFromPackage());
        form.reset({
            level: {
                id: '',
                name: '',
            },
        });
    }, [instituteDetails]);

    const [formValues, setFormValues] = useState<enrollBulkFormType>(defaultFormValues);
    const [courseList, setCourseList] = useState<DropdownItemType[]>(getCourseFromPackage());
    const [sessionList, setSessionList] = useState<DropdownItemType[]>(getSessionFromPackage());
    const [levelList, setLevelList] = useState<DropdownItemType[]>(getLevelsFromPackage());
    const addCourseMutation = useAddCourse();
    const addSessionMutation = useAddSession();
    const addLevelMutation = useAddLevel();

    const form = useForm<enrollBulkFormType>({
        resolver: zodResolver(enrollBulkFormSchema),
        defaultValues: defaultFormValues,
    });

    const onSubmitEnrollBulkForm = (values: enrollBulkFormType) => {
        setFormValues(values);
        setOpenSetFormatDialog(true);
    };

    // This handles form submission without page reload
    const handleDoneClick = () => {
        form.handleSubmit(onSubmitEnrollBulkForm)();
    };

    const handleAddCourse = ({ requestData }: { requestData: CourseFormData }) => {
        addCourseMutation.mutate(
            { requestData: requestData },
            {
                onSuccess: () => {
                    toast.success(t('toasts.courseCreatedSuccess'));
                },
                onError: () => {
                    toast.error(t('toasts.createBatchFailed'));
                },
            }
        );
    };

    const handleAddSession = (sessionData: AddSessionDataType) => {
        const processedData = structuredClone(sessionData);

        const transformedData = {
            ...processedData,
            levels: processedData.levels.map((level) => ({
                id: level.level_dto?.id,
                new_level: level.level_dto?.new_level === true,
                level_name: level.level_dto?.level_name,
                duration_in_days: level.level_dto?.duration_in_days,
                thumbnail_file_id: level.level_dto?.thumbnail_file_id,
                package_id: level.level_dto?.package_id,
            })),
        };

        // Use type assertion since we know this is the correct format for the API
        addSessionMutation.mutate(
            { requestData: transformedData as unknown as AddSessionDataType },
            {
                onSuccess: () => {
                    toast.success(
                        t('toasts.itemAddedSuccess', {
                            term: getTerminology(ContentTerms.Session, SystemTerms.Session),
                        })
                    );
                },
                onError: (error) => {
                    toast.error(
                        error.message ||
                            t('toasts.addItemFailed', {
                                term: getTerminology(
                                    ContentTerms.Session,
                                    SystemTerms.Session
                                ).toLocaleLowerCase(),
                            })
                    );
                },
            }
        );
    };

    const handleAddLevel = ({
        requestData,
        packageId,
        sessionId,
    }: {
        requestData: AddLevelData;
        packageId?: string;
        sessionId?: string;
        levelId?: string;
    }) => {
        addLevelMutation.mutate(
            { requestData: requestData, packageId: packageId || '', sessionId: sessionId || '' },
            {
                onSuccess: () => {
                    toast.success(t('toasts.levelAddedSuccess'));
                },
                onError: (error) => {
                    toast.error(error.message || t('toasts.addLevelFailedFallback'));
                },
            }
        );
    };

    useEffect(() => {
        const values = form.watch();
        // Update session list when course or level changes
        if (!values.level?.id || !values.session?.id) {
            setSessionList(
                getSessionFromPackage({
                    courseId: values.course?.id,
                    levelId: values.level?.id,
                })
            );

            // Update level list when course or session changes
            setLevelList(
                getLevelsFromPackage({
                    courseId: values.course?.id,
                    sessionId: values.session?.id,
                })
            );
        }
    }, [form.watch('course')]);

    useEffect(() => {
        const values = form.watch();

        if (!values.course?.id || !values.session?.id) {
            // Update session list when course or level changes
            setSessionList(
                getSessionFromPackage({
                    courseId: values.course?.id,
                    levelId: values.level?.id,
                })
            );

            // Update course list when session or level changes
            setCourseList(
                getCourseFromPackage({
                    sessionId: values.session?.id,
                    levelId: values.level?.id,
                })
            );
        }
    }, [form.watch('level')]);

    useEffect(() => {
        const values = form.watch();
        // Update course list when session or level changes
        if (!values.course?.id || !values.level?.id) {
            setCourseList(
                getCourseFromPackage({
                    sessionId: values.session?.id,
                    levelId: values.level?.id,
                })
            );

            // Update level list when course or session changes
            setLevelList(
                getLevelsFromPackage({
                    courseId: values.course?.id,
                    sessionId: values.session?.id,
                })
            );
        }
    }, [form.watch('session')]);

    return (
        <>
            <Form {...form} className="w-full">
                <FormProvider {...form}>
                    <form onSubmit={form.handleSubmit(onSubmitEnrollBulkForm)}>
                        <div className="flex w-full flex-col gap-4">
                            <FormField
                                control={form.control}
                                name="course"
                                render={({ field: { onChange, value } }) => (
                                    <FormItem className="w-full">
                                        <FormControl>
                                            <div className="flex flex-col gap-1">
                                                <div>
                                                    {getTerminology(
                                                        ContentTerms.Course,
                                                        SystemTerms.Course
                                                    )}
                                                    <span className="text-subtitle text-danger-600">
                                                        *
                                                    </span>
                                                </div>
                                                <MyDropdown
                                                    currentValue={value?.name ?? ''}
                                                    dropdownList={courseList}
                                                    handleChange={onChange}
                                                    placeholder={t('placeholders.select', {
                                                        term: getTerminology(
                                                            ContentTerms.Course,
                                                            SystemTerms.Course
                                                        ),
                                                    })}
                                                    error={
                                                        form.formState.errors.course?.id?.message ||
                                                        form.formState.errors.course?.name?.message
                                                    }
                                                    required={true}
                                                    showAddCourseButton={true}
                                                    onAddCourse={handleAddCourse}
                                                />
                                            </div>
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="session"
                                render={({ field: { onChange, value } }) => (
                                    <FormItem className="w-full">
                                        <FormControl>
                                            <div className="flex flex-col gap-1">
                                                <div>
                                                    {getTerminology(
                                                        ContentTerms.Session,
                                                        SystemTerms.Session
                                                    )}{' '}
                                                    <span className="text-subtitle text-danger-600">
                                                        *
                                                    </span>
                                                </div>
                                                <MyDropdown
                                                    currentValue={value?.name ?? ''}
                                                    dropdownList={sessionList}
                                                    handleChange={onChange}
                                                    placeholder={t('placeholders.select', {
                                                        term: getTerminology(
                                                            ContentTerms.Session,
                                                            SystemTerms.Session
                                                        ),
                                                    })}
                                                    error={
                                                        form.formState.errors.session?.id
                                                            ?.message ||
                                                        form.formState.errors.session?.name?.message
                                                    }
                                                    required={true}
                                                    showAddSessionButton={true}
                                                    onAddSession={handleAddSession}
                                                />
                                            </div>
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="level"
                                render={({ field: { onChange, value } }) => (
                                    <FormItem className="w-full">
                                        <FormControl>
                                            <div className="flex flex-col gap-1">
                                                <div>
                                                    {getTerminology(
                                                        ContentTerms.Level,
                                                        SystemTerms.Level
                                                    )}{' '}
                                                    <span className="text-subtitle text-danger-600">
                                                        *
                                                    </span>
                                                </div>
                                                <MyDropdown
                                                    currentValue={value?.name ?? ''}
                                                    dropdownList={levelList}
                                                    handleChange={onChange}
                                                    placeholder={t('placeholders.select', {
                                                        term: getTerminology(
                                                            ContentTerms.Level,
                                                            SystemTerms.Level
                                                        ),
                                                    })}
                                                    error={
                                                        form.formState.errors.level?.id?.message ||
                                                        form.formState.errors.level?.name?.message
                                                    }
                                                    required={true}
                                                    showAddLevelButton={true}
                                                    onAddLevel={handleAddLevel}
                                                    packageId={form.getValues('course')?.id ?? ''}
                                                    disableAddLevelButton={
                                                        form.getValues('course')?.id === ''
                                                    }
                                                />
                                            </div>
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <MyButton
                                buttonType="primary"
                                layoutVariant="default"
                                scale="large"
                                type="button"
                                onClick={handleDoneClick}
                                disable={
                                    form.getValues('course')?.id === '' ||
                                    form.getValues('session')?.id === '' ||
                                    form.getValues('level')?.id === ''
                                }
                            >
                                {t('buttons.enroll')}
                            </MyButton>
                        </div>
                    </form>
                </FormProvider>
            </Form>
            <CSVFormatDialog
                packageDetails={formValues}
                openDialog={openSetFormatDialog}
                setOpenDialog={setOpenSetFormatDialog}
            />
        </>
    );
};
