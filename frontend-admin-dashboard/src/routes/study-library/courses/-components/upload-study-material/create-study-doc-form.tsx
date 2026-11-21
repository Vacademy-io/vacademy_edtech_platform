import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { useTranslation } from 'react-i18next';
import { MyDropdown } from '../../../../../components/common/students/enroll-manually/dropdownForPackageItems';
import { MyButton } from '@/components/design-system/button';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getCourseSubjects } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getSubjects';
import { ModulesWithChaptersProvider } from '@/providers/study-library/modules-with-chapters-provider';
import {
    ChapterWithSlides,
    ModulesWithChapters,
    useModulesWithChaptersStore,
} from '@/stores/study-library/use-modules-with-chapters-store';
import { useEffect, useState } from 'react';
import { getChaptersByModuleId } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getChaptersByModuleId';
import { useDialogStore } from '@/routes/study-library/courses/-stores/slide-add-dialogs-store';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// Form validation schema
const formSchema = z.object({
    course: z
        .object({
            id: z.string(),
            name: z.string(),
        })
        .optional(),
    session: z
        .object({
            id: z.string(),
            name: z.string(),
        })
        .optional(),
    level: z
        .object({
            id: z.string(),
            name: z.string(),
        })
        .optional(),
    subject: z
        .object({
            id: z.string(),
            name: z.string(),
        })
        .optional(),
    module: z
        .object({
            id: z.string(),
            name: z.string(),
        })
        .optional(),
    chapter: z
        .object({
            id: z.string(),
            name: z.string(),
        })
        .optional(),
});

export const CreateStudyDocForm = () => {
    const { t } = useTranslation('studyLibraryCreateStudyDocForm');
    const {
        getCourseFromPackage,
        getSessionFromPackage,
        getLevelsFromPackage,
        getPackageSessionId,
    } = useInstituteDetailsStore();

    const { openDocUploadDialog } = useDialogStore();
    const router = useRouter();
    const { sessionId } = router.state.location.search;

    const navigate = useNavigate();

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            course: undefined,
            session: undefined,
            level: undefined,
            subject: undefined,
            module: undefined,
            chapter: undefined,
        },
    });

    const courseList = getCourseFromPackage();
    const sessionList = getSessionFromPackage({ courseId: form.getValues('course')?.id });
    const levelList = getLevelsFromPackage({
        courseId: form.getValues('course')?.id,
        sessionId: form.getValues('session')?.id,
    });
    const subjectList = getCourseSubjects(
        form.getValues('course')?.id || '',
        form.getValues('session')?.id || '',
        form.getValues('level')?.id || ''
    );
    const formattedSubjectList = subjectList.map((subject) => ({
        id: subject.id,
        name: subject.subject_name,
    }));

    const fetchPackageSessionId = () => {
        return getPackageSessionId({
            courseId: form.getValues('course')?.id || '',
            sessionId: form.getValues('session')?.id || '',
            levelId: form.getValues('level')?.id || '',
        });
    };

    const [packageSessionId, setPackageSessionId] = useState(fetchPackageSessionId());
    const { modulesWithChaptersData } = useModulesWithChaptersStore();

    const formatModule = (moduleData: ModulesWithChapters[] | null) => {
        return moduleData?.map((object) => ({
            id: object.module.id,
            name: object.module.module_name,
        }));
    };

    const [formattedModuleList, setFormattedModuleList] = useState(
        formatModule(modulesWithChaptersData)
    );
    const chaptersList = getChaptersByModuleId(form.getValues('module')?.id || '');

    const formatChapter = (chaptersList: ChapterWithSlides[] | null) => {
        if (!chaptersList) return;
        return chaptersList.map((chapter) => ({
            id: chapter.chapter.id,
            name: chapter.chapter.chapter_name,
        }));
    };

    const [formattedChapterList, setFormattedChapterList] = useState(formatChapter(chaptersList));

    useEffect(() => {
        setPackageSessionId(fetchPackageSessionId());
        setFormattedModuleList(formatModule(modulesWithChaptersData));
        setFormattedChapterList(
            formatChapter(getChaptersByModuleId(form.getValues('module')?.id || ''))
        );
    }, [
        form.watch('course'),
        form.watch('session'),
        form.watch('level'),
        form.watch('subject'),
        form.watch('module'),
        packageSessionId,
    ]);

    const { watch } = form;
    const course = watch('course');
    const session = watch('session');
    const yearClass = watch('level');
    const subject = watch('subject');
    const module = watch('module');
    const chapter = watch('chapter');

    const formData = [
        {
            fieldName: 'course' as const,
            label: getTerminology(ContentTerms.Course, SystemTerms.Course),
            placeholder: t('selectPlaceholder', {
                term: getTerminology(ContentTerms.Course, SystemTerms.Course),
            }),
            list: courseList,
        },
        {
            fieldName: 'session' as const,
            label: getTerminology(ContentTerms.Session, SystemTerms.Session),
            placeholder: t('selectPlaceholder', {
                term: getTerminology(ContentTerms.Session, SystemTerms.Session),
            }),
            list: sessionList,
        },
        {
            fieldName: 'level' as const,
            label: t('yearClass'),
            placeholder: t('selectPlaceholder', { term: t('yearClass') }),
            list: levelList,
        },
        {
            fieldName: 'subject' as const,
            label: getTerminology(ContentTerms.Subject, SystemTerms.Subject),
            placeholder: t('selectPlaceholder', {
                term: getTerminology(ContentTerms.Subject, SystemTerms.Subject),
            }),
            list: formattedSubjectList,
        },
        {
            fieldName: 'module' as const,
            label: getTerminology(ContentTerms.Module, SystemTerms.Module),
            placeholder: t('selectPlaceholder', {
                term: getTerminology(ContentTerms.Module, SystemTerms.Module),
            }),
            list: formattedModuleList || [],
        },
        {
            fieldName: 'chapter' as const,
            label: getTerminology(ContentTerms.Chapter, SystemTerms.Chapter),
            placeholder: t('selectPlaceholder', {
                term: getTerminology(ContentTerms.Chapter, SystemTerms.Chapter),
            }),
            list: formattedChapterList || [],
        },
    ];

    const isDropdownDisabled = (index: number): boolean => {
        switch (index) {
            case 0:
                return false;
            case 1:
                return !course;
            case 2:
                return !session;
            case 3:
                return !yearClass;
            case 4:
                return !subject;
            case 5:
                return !module;
            case 6:
                return !chapter;
            default:
                return false;
        }
    };

    const onSubmit = (data: z.infer<typeof formSchema>) => {
        navigate({
            to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
            search: {
                courseId: data.course?.id || '',
                levelId: data.level?.id || '',
                subjectId: data.subject?.id || '',
                moduleId: data.module?.id || '',
                chapterId: data.chapter?.id || '',
                slideId: '',
                sessionId: sessionId || '',
            },
        });
        openDocUploadDialog();
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {formData.map((obj, index) => (
                    <ModulesWithChaptersProvider
                        // subjectId={form.getValues("subject")?.id || ""}
                        // packageSessionId={packageSessionId || ""}
                        key={index}
                    >
                        <FormField
                            key={obj.fieldName}
                            control={form.control}
                            name={obj.fieldName}
                            render={({ field, fieldState }) => (
                                <FormItem>
                                    <FormControl>
                                        <div className="flex flex-col gap-1">
                                            <div>
                                                {obj.label}
                                                <span className="text-primary-500">*</span>
                                            </div>
                                            <MyDropdown
                                                placeholder={obj.placeholder}
                                                currentValue={field.value}
                                                dropdownList={obj.list}
                                                onSelect={field.onChange}
                                                disable={isDropdownDisabled(index)}
                                                error={fieldState.error?.message}
                                            />
                                            <FormMessage className="text-danger-600" />
                                        </div>
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </ModulesWithChaptersProvider>
                ))}
                <div className="w-full px-6 py-4">
                    <MyButton
                        type="submit"
                        buttonType="primary"
                        layoutVariant="default"
                        scale="large"
                        className="w-full"
                    >
                        {t('submit')}
                    </MyButton>
                </div>
            </form>
        </Form>
    );
};
