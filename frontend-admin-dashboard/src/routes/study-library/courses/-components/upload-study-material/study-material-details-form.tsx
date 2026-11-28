import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { MyDropdown } from '../../../../../components/common/students/enroll-manually/dropdownForPackageItems';
import { MyButton } from '@/components/design-system/button';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getCourseSubjects } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getSubjects';
import { ModulesWithChapters } from '@/stores/study-library/use-modules-with-chapters-store';
import { useEffect, useMemo, useState } from 'react';
import { getChaptersByModuleId } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getChaptersByModuleId';
import { useModulesWithChaptersQuery } from '@/routes/study-library/courses/-services/getModulesWithChapters';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useTranslation } from 'react-i18next';

export type AvailableFields =
    | 'course'
    | 'session'
    | 'level'
    | 'subject'
    | 'module'
    | 'chapter'
    | 'file_type';

export type FieldValue = {
    id: string;
    name: string;
};

export type StudyMaterialDetailsFormProps = {
    fields: AvailableFields[];
    onFormSubmit: (data: {
        [x: string]:
            | {
                  id: string;
                  name: string;
              }
            | undefined;
    }) => void;
    submitButtonName: string;
};

// Form validation schema
const fieldObjectSchema = z
    .object({
        id: z.string(),
        name: z.string(),
    })
    .optional();

const createFormSchema = (fields: AvailableFields[]) => {
    const schemaObject: Record<string, typeof fieldObjectSchema> = {};

    fields.forEach((field) => {
        schemaObject[field] = fieldObjectSchema;
    });

    return z.object(schemaObject);
};

// Custom hook to fetch modules with chapters
const useModulesWithChapters = (subjectId: string, packageSessionId?: string) => {
    return useModulesWithChaptersQuery(subjectId, packageSessionId || '');
};

export const StudyMaterialDetailsForm = ({
    fields,
    onFormSubmit,
    submitButtonName,
}: StudyMaterialDetailsFormProps) => {
    const { t } = useTranslation('studyLibraryStudyMaterialDetailsForm');
    const {
        getCourseFromPackage,
        getSessionFromPackage,
        getLevelsFromPackage,
        getPackageSessionId,
    } = useInstituteDetailsStore();

    const formSchema = createFormSchema(fields);
    type FormValues = z.infer<typeof formSchema>;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: fields.reduce<Partial<FormValues>>(
            (acc, field) => ({
                ...acc,
                [field]: field === 'file_type' ? { id: '', name: '' } : undefined,
            }),
            {}
        ),
        mode: 'onTouched',
    });

    const { watch, getValues } = form;

    // Get course list
    const courseList = getCourseFromPackage();

    // Get session list based on selected course
    const sessionList = getSessionFromPackage({
        courseId: getValues('course')?.id,
    });

    // Get level list based on selected course and session
    const levelList = getLevelsFromPackage({
        courseId: getValues('course')?.id,
        sessionId: getValues('session')?.id,
    });

    // Get subject list
    const subjectList = getCourseSubjects(
        getValues('course')?.id || '',
        getValues('session')?.id || '',
        getValues('level')?.id || ''
    );
    const formattedSubjectList = useMemo(
        () =>
            subjectList.map((subject) => ({
                id: subject.id,
                name: subject.subject_name,
            })),
        [subjectList]
    );

    // Get package session ID for modules
    const fetchPackageSessionId = () => {
        return getPackageSessionId({
            courseId: getValues('course')?.id || '',
            sessionId: getValues('session')?.id || '',
            levelId: getValues('level')?.id || '',
        });
    };

    const [packageSessionId, setPackageSessionId] = useState(fetchPackageSessionId());

    useEffect(() => {
        const newPackageSessionId = fetchPackageSessionId();
        setPackageSessionId(newPackageSessionId);
    }, [watch('course'), watch('session'), watch('level')]);

    const { data: modulesWithChaptersData, error: modulesError } = useModulesWithChapters(
        form.watch('subject')?.id || '',
        packageSessionId || undefined
    );

    if (modulesError) {
        console.error('Error fetching modules with chapters:', modulesError);
    }

    // Format module list
    const formattedModuleList = useMemo(() => {
        return (
            modulesWithChaptersData?.map((object: ModulesWithChapters) => ({
                id: object.module.id,
                name: object.module.module_name,
            })) || []
        );
    }, [modulesWithChaptersData]);

    // Get chapters list based on selected module
    const chaptersList = getChaptersByModuleId(getValues('module')?.id || '');

    const formattedChapterList = useMemo(() => {
        if (!chaptersList) return [];
        return chaptersList.map((chapter) => ({
            id: chapter.chapter.id,
            name: chapter.chapter.chapter_name,
        }));
    }, [chaptersList]);

    // File type list formatted to match the FieldValue type (values are fixed enum
    // identifiers, not translated)
    const fileTypeList = [
        { id: 'PDF', name: 'PDF' },
        { id: 'DOC', name: 'DOC' },
        { id: 'VIDEO', name: 'VIDEO' },
    ];

    // Function to determine if a dropdown should be disabled
    const isDropdownDisabled = (fieldName: AvailableFields): boolean => {
        switch (fieldName) {
            case 'course':
                return false;
            case 'session':
                return !watch('course');
            case 'level':
                return !watch('session');
            case 'subject':
                return !watch('level');
            case 'module':
                return !watch('subject');
            case 'chapter':
                return !watch('module');
            case 'file_type':
                return false;
            default:
                return false;
        }
    };

    // Get the appropriate list for each field
    const getListForField = (fieldName: AvailableFields): FieldValue[] => {
        switch (fieldName) {
            case 'course':
                return courseList;
            case 'session':
                return sessionList;
            case 'level':
                return levelList;
            case 'subject':
                return formattedSubjectList;
            case 'module':
                return formattedModuleList;
            case 'chapter':
                return formattedChapterList;
            case 'file_type':
                return fileTypeList;
            default:
                return [];
        }
    };

    // Get label and placeholder for each field
    const getFieldConfig = (fieldName: AvailableFields) => {
        const config = {
            course: {
                label: getTerminology(ContentTerms.Course, SystemTerms.Course),
                placeholder: t('selectPlaceholder', {
                    term: getTerminology(ContentTerms.Course, SystemTerms.Course),
                }),
            },
            session: {
                label: getTerminology(ContentTerms.Session, SystemTerms.Session),
                placeholder: t('selectPlaceholder', {
                    term: getTerminology(ContentTerms.Session, SystemTerms.Session),
                }),
            },
            level: { label: t('yearClass'), placeholder: t('selectYearClass') },
            subject: {
                label: getTerminology(ContentTerms.Subject, SystemTerms.Subject),
                placeholder: t('selectPlaceholder', {
                    term: getTerminology(ContentTerms.Subject, SystemTerms.Subject),
                }),
            },
            module: {
                label: getTerminology(ContentTerms.Module, SystemTerms.Module),
                placeholder: t('selectPlaceholder', {
                    term: getTerminology(ContentTerms.Module, SystemTerms.Module),
                }),
            },
            chapter: {
                label: getTerminology(ContentTerms.Chapter, SystemTerms.Chapter),
                placeholder: t('selectPlaceholder', {
                    term: getTerminology(ContentTerms.Chapter, SystemTerms.Chapter),
                }),
            },
            file_type: { label: t('fileType'), placeholder: t('selectFileType') },
        };

        return config[fieldName];
    };

    const onSubmit = async (data: FormValues) => {
        try {
            await onFormSubmit(data);
        } catch (error) {
            console.error('Form submission error:', error);
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {fields.map((fieldName) => {
                    const config = getFieldConfig(fieldName);
                    const list = getListForField(fieldName);

                    return (
                        <FormField
                            key={fieldName}
                            control={form.control}
                            name={fieldName}
                            render={({ field, fieldState }) => (
                                <FormItem>
                                    <FormControl>
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-1">
                                                <span>{config.label}</span>
                                                <span className="text-primary-500">*</span>
                                            </div>
                                            <MyDropdown
                                                placeholder={config.placeholder}
                                                currentValue={field.value}
                                                dropdownList={list}
                                                onSelect={field.onChange}
                                                disable={isDropdownDisabled(fieldName)}
                                                error={fieldState.error?.message}
                                            />
                                            <FormMessage className="text-danger-600" />
                                        </div>
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    );
                })}
                <div className="w-full px-6 py-4">
                    <MyButton
                        type="submit"
                        buttonType="primary"
                        layoutVariant="default"
                        scale="large"
                        className="w-full"
                    >
                        {submitButtonName}
                    </MyButton>
                </div>
            </form>
        </Form>
    );
};
