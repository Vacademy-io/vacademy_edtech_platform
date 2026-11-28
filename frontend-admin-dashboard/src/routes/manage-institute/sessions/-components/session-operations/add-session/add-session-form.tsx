import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { Separator } from '@/components/ui/separator';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Plus, DotsThree } from '@phosphor-icons/react';
import { AddLevelInput } from '@/components/design-system/add-level-input';
import { AddCourseButton } from '@/components/common/study-library/add-course/add-course-button';
import { CourseFormData } from '@/components/common/study-library/add-course/add-course-form';
import { toast } from 'sonner';
import { useAddCourse } from '@/services/study-library/course-operations/add-course';
import { Checkbox } from '@/components/ui/checkbox';
import { LevelType, levelWithDetails } from '@/schemas/student/student-list/institute-schema';
import { SessionData } from '@/types/study-library/session-types';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useTranslation } from 'react-i18next';

const formSchema = z.object({
    id: z.string().nullable(),
    session_name: z.string(),
    status: z.string(),
    start_date: z.string(),
    new_session: z.boolean(),
    levels: z.array(
        z.object({
            level_dto: z.object({
                id: z.string().nullable(),
                new_level: z.boolean(),
                level_name: z.string(),
                duration_in_days: z.number().nullable(),
                thumbnail_file_id: z.string().nullable(),
                package_id: z.string(), // Moved package_id into level_dto
                is_parent: z.boolean().optional(),
                parent_id: z.string().nullable().optional(),
            }),
            package_session_id: z.string(),
            package_session_status: z.string(),
            start_date: z.string(),
            is_parent: z.boolean().optional(),
            parent_id: z.string().nullable().optional(),
        })
    ),
});

export type LevelForSession = z.infer<typeof formSchema>['levels'][number];
export type AddSessionDataType = z.infer<typeof formSchema>;

export const AddSessionForm = ({
    initialValues,
    onSubmit,
    setDisableAddButton,
    submitForm,
}: {
    initialValues?: SessionData;
    onSubmit: (sessionData: AddSessionDataType) => void;
    setDisableAddButton: Dispatch<SetStateAction<boolean>>;
    submitForm: (submitFn: () => void) => void;
}) => {
    const { t } = useTranslation('manageInstituteAddSessionForm');
    const { instituteDetails, getPackageWiseLevels } = useInstituteDetailsStore();

    const [packageWithLevels, setPackageWithLevels] = useState(getPackageWiseLevels());
    const [newLevelName, setNewLevelName] = useState('');
    const [newLevelDuration, setNewLevelDuration] = useState<number | null>(null);
    const addCourseMutation = useAddCourse();
    const [locallyAddedLevels, setLocallyAddedLevels] = useState<Record<string, LevelType[]>>({});

    const getPackages = () => {
        if (!initialValues) {
            return packageWithLevels;
        }
        return initialValues.packages;
    };

    // Add this inside the AddSessionForm component, before the return statement
    useEffect(() => {
        // Initialize selected levels based on initialValues
        if (initialValues) {
            const initialSelectedLevels: LevelForSession[] = [];

            initialValues.packages.forEach((packageItem) => {
                packageItem.level.forEach((levelWithStatus) => {
                    // Only include levels where package_session_status is "ACTIVE"
                    if (levelWithStatus.package_session_status === 'ACTIVE') {
                        initialSelectedLevels.push({
                            start_date: levelWithStatus.start_date,
                            level_dto: {
                                id: levelWithStatus.level_dto.id,
                                new_level: false,
                                level_name: levelWithStatus.level_dto.level_name,
                                duration_in_days: levelWithStatus.level_dto.duration_in_days,
                                thumbnail_file_id: levelWithStatus.level_dto.thumbnail_id,
                                package_id: packageItem.package_dto.id,
                                is_parent: levelWithStatus.is_parent,
                                parent_id: levelWithStatus.parent_id ?? null,
                            },
                            package_session_id: levelWithStatus.package_session_id,
                            package_session_status: levelWithStatus.package_session_status,
                            is_parent: levelWithStatus.is_parent,
                            parent_id: levelWithStatus.parent_id ?? null,
                        });
                    }
                });
            });

            // Set the initial levels in the form
            form.setValue('levels', initialSelectedLevels);
        }
    }, [initialValues]);

    useEffect(() => {
        // When refreshing packageWithLevels, combine existing levels with locally added ones
        const packages = getPackageWiseLevels();

        // Create a deep copy to avoid mutation issues
        const updatedPackages = packages.map((pkg) => {
            const packageId = pkg.package_dto.id;
            const levelsToAdd = locallyAddedLevels[packageId] || [];

            return {
                ...pkg,
                level: [
                    ...pkg.level,
                    ...levelsToAdd.map((level) => ({
                        level_dto: {
                            id: level.id,
                            level_name: level.level_name,
                            duration_in_days: level.duration_in_days,
                            thumbnail_id: level.thumbnail_id,
                            package_id: packageId,
                            new_level: true,
                            start_date: new Date().toISOString(),
                        },
                        package_session_id: '', // Use empty string instead of null
                        package_session_status: 'ACTIVE', // Use "ACTIVE" instead of null
                        start_date: new Date().toISOString(), // Use current date instead of null
                    })),
                ],
            };
        });

        setPackageWithLevels(updatedPackages);
    }, [instituteDetails, locallyAddedLevels]);

    const form = useForm<AddSessionDataType>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            id: initialValues?.session.id || null,
            session_name: initialValues?.session.session_name || '',
            status: initialValues?.session.status || 'ACTIVE',
            start_date: initialValues?.session.start_date
                ? new Date(initialValues.session.start_date).toISOString().split('T')[0]
                : new Date().toISOString().split('T')[0],
            new_session: initialValues ? false : true,
            levels:
                initialValues?.packages.flatMap((pkg) => {
                    const packageId = pkg.package_dto.id;
                    return pkg.level
                        .filter((level) => level.package_session_status === 'ACTIVE')
                        .map((level) => ({
                            level_dto: {
                                start_date: level.start_date,
                                id: level.level_dto.id,
                                new_level: false,
                                level_name: level.level_dto.level_name,
                                duration_in_days: level.level_dto.duration_in_days,
                                thumbnail_file_id: level.level_dto.thumbnail_id,
                                package_id: packageId,
                                is_parent: level.is_parent,
                                parent_id: level.parent_id ?? null,
                            },
                            package_session_id: level.package_session_id,
                            package_session_status: level.package_session_status,
                            start_date: level.start_date,
                            is_parent: level.is_parent,
                            parent_id: level.parent_id ?? null,
                        }));
                }) || [],
        },
    });

    // Add this useEffect to handle the disabled state of the Add button
    useEffect(() => {
        const sessionName = form.watch('session_name');
        const startDate = form.watch('start_date');
        const levels = form.watch('levels');

        const hasValidName = sessionName?.trim() !== '';
        const hasValidDate = startDate !== '';
        const hasSelectedLevels = (levels?.length ?? 0) > 0;

        setDisableAddButton(!(hasValidName && hasValidDate && hasSelectedLevels));
    }, [form.watch('session_name'), form.watch('start_date'), form.watch('levels')]);

    const handleAddLevel = (
        levelName: string,
        durationInDays: number | null,
        packageId: string
    ) => {
        // Create the new level object with the correct structure
        const newLevel: LevelForSession = {
            level_dto: {
                id: '',
                new_level: true, // Ensure this is explicitly set to true
                level_name: levelName,
                duration_in_days: durationInDays,
                thumbnail_file_id: null,
                package_id: packageId,
            },
            package_session_id: '',
            package_session_status: 'ACTIVE',
            start_date: new Date().toISOString(),
        };

        // Add to form values
        const currentLevels = form.getValues('levels');
        form.setValue('levels', [...currentLevels, newLevel]);

        // Add to local state for tracking
        const levelForLocalTracking: LevelType = {
            id: '',
            level_name: levelName,
            duration_in_days: durationInDays,
            thumbnail_id: null,
        };

        setLocallyAddedLevels((prev) => ({
            ...prev,
            [packageId]: [...(prev[packageId] || []), levelForLocalTracking],
        }));

        // Reset inputs
        setNewLevelName('');
        setNewLevelDuration(null);
    };

    const handleSelectLevel = (level: levelWithDetails, packageId: string, isSelected: boolean) => {
        const currentLevels = form.getValues('levels');
        console.log('currentLevels', currentLevels);
        console.log('isSelected', isSelected);

        if (isSelected) {
            // Remove the level if it's already selected
            const updatedLevels = currentLevels.filter(
                (l) =>
                    !(l.level_dto.id === level.level_dto.id && l.level_dto.package_id === packageId)
            );
            form.setValue('levels', updatedLevels);
        } else {
            // Add the level if it's not already selected
            const levelToAdd: LevelForSession = {
                level_dto: {
                    id: level.level_dto.id,
                    new_level: false,
                    level_name: level.level_dto.level_name,
                    duration_in_days: level.level_dto.duration_in_days,
                    thumbnail_file_id: level.level_dto.thumbnail_id || '',
                    package_id: packageId,
                },
                package_session_id: level.package_session_id,
                package_session_status: level.package_session_status,
                start_date: level.start_date,
            };
            form.setValue('levels', [...currentLevels, levelToAdd]);
        }
    };

    const isLevelSelected = (levelId: string, packageId: string) => {
        return form
            .getValues('levels')
            .some(
                (level) =>
                    level.level_dto.id === levelId && level.level_dto.package_id === packageId
            );
    };

    // Add this function to check if a package has any selected levels
    const hasSelectedLevelsInPackage = (packageId: string) => {
        return form.getValues('levels').some((level) => level.level_dto.package_id === packageId);
    };

    const handleAddCourse = ({ requestData }: { requestData: CourseFormData }) => {
        addCourseMutation.mutate(
            { requestData: requestData },
            {
                onSuccess: () => {
                    toast.success(
                        t('toast.courseAddedSuccess', {
                            term: getTerminology(ContentTerms.Course, SystemTerms.Course),
                        })
                    );
                },
                onError: (error) => {
                    toast.error(
                        error.message ||
                            t('toast.courseAddFailed', {
                                term: getTerminology(
                                    ContentTerms.Course,
                                    SystemTerms.Course
                                ).toLocaleLowerCase(),
                            })
                    );
                },
            }
        );
    };

    const formRef = useRef<HTMLFormElement>(null);

    const requestFormSubmit = () => {
        if (formRef.current) {
            formRef.current.requestSubmit();
        }
    };

    useEffect(() => {
        if (submitForm) {
            submitForm(requestFormSubmit);
        }
    }, [submitForm]);

    return (
        <FormProvider {...form}>
            <form
                ref={formRef}
                onSubmit={form.handleSubmit(onSubmit)}
                className="flex max-h-[80vh] flex-col gap-8 p-2 text-neutral-600"
            >
                <FormField
                    control={form.control}
                    name="session_name"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    label={t('form.sessionNameLabel', {
                                        term: getTerminology(
                                            ContentTerms.Session,
                                            SystemTerms.Session
                                        ),
                                    })}
                                    required={true}
                                    inputType="text"
                                    inputPlaceholder={t('form.sessionNamePlaceholder')}
                                    className="w-full"
                                    input={field.value}
                                    onChangeFunction={(e) => field.onChange(e.target.value)}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="start_date"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    label={t('form.startDateLabel')}
                                    required={true}
                                    inputType="date"
                                    inputPlaceholder={t('form.startDatePlaceholder')} // Updated placeholder
                                    className="w-full"
                                    input={field.value}
                                    onChangeFunction={(e) => field.onChange(e.target.value)}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="flex flex-col gap-4">
                    <p className="text-body text-neutral-500">
                        {t('form.selectLevelsHeading')}
                    </p>
                    <FormField
                        control={form.control}
                        name="levels"
                        render={() => (
                            <FormItem className="w-full">
                                <FormControl>
                                    <div className="flex flex-col gap-4">
                                        {getPackages().map((packageItem) => {
                                            const packageHasSelectedLevels =
                                                hasSelectedLevelsInPackage(
                                                    packageItem.package_dto.id
                                                );
                                            return (
                                                <div
                                                    key={packageItem.package_dto.id}
                                                    className={`rounded-lg border border-neutral-200 py-2 ${
                                                        packageHasSelectedLevels
                                                            ? 'bg-neutral-100'
                                                            : ''
                                                    }`}
                                                >
                                                    <div className="flex w-full items-center justify-between p-4 pr-8">
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex flex-col">
                                                                <div className="flex flex-col items-start">
                                                                    <p className="text-subtitle font-semibold">
                                                                        {
                                                                            packageItem.package_dto
                                                                                .package_name
                                                                        }
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <MyButton
                                                                buttonType="secondary"
                                                                layoutVariant="icon"
                                                                scale="small"
                                                                type="button"
                                                            >
                                                                <DotsThree />
                                                            </MyButton>
                                                        </div>
                                                    </div>
                                                    <div className="ml-4 mr-6 mt-2">
                                                        <Separator />
                                                        <div className="grid grid-cols-2">
                                                            {initialValues
                                                                ? packageItem.level.map((level) => {
                                                                      const selected =
                                                                          isLevelSelected(
                                                                              level.level_dto.id,
                                                                              packageItem
                                                                                  .package_dto.id
                                                                          );

                                                                      return (
                                                                          <div
                                                                              key={
                                                                                  level.level_dto.id
                                                                              }
                                                                              className="flex cursor-pointer items-center gap-2 rounded-md p-2"
                                                                          >
                                                                              <Checkbox
                                                                                  className="data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
                                                                                  checked={selected}
                                                                                  onCheckedChange={() =>
                                                                                      handleSelectLevel(
                                                                                          level,
                                                                                          packageItem
                                                                                              .package_dto
                                                                                              .id,
                                                                                          selected
                                                                                      )
                                                                                  }
                                                                              />
                                                                              <span>
                                                                                  {
                                                                                      level
                                                                                          .level_dto
                                                                                          .level_name
                                                                                  }
                                                                              </span>
                                                                          </div>
                                                                      );
                                                                  })
                                                                : packageItem.level.map((level) => {
                                                                      // Your existing code for non-edit mode
                                                                      const selected =
                                                                          isLevelSelected(
                                                                              level.level_dto.id,
                                                                              packageItem
                                                                                  .package_dto.id
                                                                          );
                                                                      return (
                                                                          <div
                                                                              key={
                                                                                  level.level_dto.id
                                                                              }
                                                                              className="flex cursor-pointer items-center gap-2 rounded-md p-2"
                                                                          >
                                                                              <Checkbox
                                                                                  className="data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
                                                                                  checked={selected}
                                                                                  onCheckedChange={() =>
                                                                                      handleSelectLevel(
                                                                                          level,
                                                                                          packageItem
                                                                                              .package_dto
                                                                                              .id,
                                                                                          selected
                                                                                      )
                                                                                  }
                                                                              />
                                                                              <span>
                                                                                  {
                                                                                      level
                                                                                          .level_dto
                                                                                          .level_name
                                                                                  }
                                                                              </span>
                                                                          </div>
                                                                      );
                                                                  })}
                                                            {!initialValues && (
                                                                <div className="mt-2">
                                                                    <AddLevelInput
                                                                        newLevelName={newLevelName}
                                                                        setNewLevelName={
                                                                            setNewLevelName
                                                                        }
                                                                        newLevelDuration={
                                                                            newLevelDuration
                                                                        }
                                                                        setNewLevelDuration={
                                                                            setNewLevelDuration
                                                                        }
                                                                        handleAddLevel={(
                                                                            name,
                                                                            duration
                                                                        ) =>
                                                                            handleAddLevel(
                                                                                name,
                                                                                duration,
                                                                                packageItem
                                                                                    .package_dto.id
                                                                            )
                                                                        }
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {!initialValues && (
                                            <AddCourseButton
                                                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                                                // @ts-expect-error
                                                onSubmit={handleAddCourse}
                                                courseButton={
                                                    <MyButton
                                                        type="button" // Set explicit type to button to prevent form submission
                                                        buttonType="text"
                                                        layoutVariant="default"
                                                        scale="small"
                                                        className="w-fit text-primary-500 hover:bg-white active:bg-white"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                        }}
                                                    >
                                                        <Plus />{' '}
                                                        {t('button.addCourse', {
                                                            term: getTerminology(
                                                                ContentTerms.Course,
                                                                SystemTerms.Course
                                                            ).toLocaleLowerCase(),
                                                        })}
                                                    </MyButton>
                                                }
                                            />
                                        )}
                                    </div>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
            </form>
        </FormProvider>
    );
};
