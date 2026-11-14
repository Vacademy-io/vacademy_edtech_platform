// CreateCourseStep.tsx
import { RadioGroup } from '@/components/ui/radio-group';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BatchItemSelect } from './batch-item-select';
import { ChoiceCard } from './choice-card';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { AddCourseButton } from '@/components/common/study-library/add-course/add-course-button';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { BookOpen, Plus, PlusCircle } from '@phosphor-icons/react';
import { getPublicUrls } from '@/services/upload_file';

/** fileId → signed url, shared across openings of the dialog. */
const thumbnailCache = new Map<string, string>();

/**
 * Signed urls for the given thumbnail file ids, fetched in one call. Plain
 * state rather than react-query so the step renders without a QueryClient.
 */
function useThumbnailUrls(fileIds: string[]) {
    const [, setVersion] = useState(0);
    const key = fileIds.join(',');

    useEffect(() => {
        const missing = fileIds.filter((id) => !thumbnailCache.has(id));
        if (missing.length === 0) return;
        let cancelled = false;
        getPublicUrls(missing.join(',')).then((details: unknown) => {
            if (cancelled || !Array.isArray(details)) return;
            details.forEach((entry: { id?: string; url?: string }) => {
                if (entry?.id && entry?.url) thumbnailCache.set(entry.id, entry.url);
            });
            setVersion((v) => v + 1);
        });
        return () => {
            cancelled = true;
        };
    }, [key]);

    return (fileId?: string | null) => (fileId ? thumbnailCache.get(fileId) : undefined);
}

export const CreateCourseStep = () => {
    const { t } = useTranslation('manageInstituteCreateCourseStep');
    const { getCourseFromPackage, instituteDetails } = useInstituteDetailsStore();
    const [courseList, setCourseList] = useState(getCourseFromPackage());
    const form = useFormContext();
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const courseLower = courseTerm.toLocaleLowerCase();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    useEffect(() => {
        setCourseList(getCourseFromPackage());
    }, [instituteDetails]);

    useEffect(() => {
        if (courseList.length === 0) {
            form.setValue('courseCreationType', 'new');
        }
    }, [courseList.length, form]);

    /**
     * A course made from here lands in the institute details a moment later.
     * When it does, pick it — the admin came here to put a batch on it. Exactly
     * one new course, so the institute details loading late is not mistaken for it.
     */
    const knownCourseIds = useRef(new Set(courseList.map((course) => course.id)));
    useEffect(() => {
        const added = courseList.filter((course) => !knownCourseIds.current.has(course.id));
        knownCourseIds.current = new Set(courseList.map((course) => course.id));
        if (added.length === 1) {
            form.setValue('courseCreationType', 'existing');
            form.setValue('selectedCourse', added[0], { shouldValidate: true });
        }
    }, [courseList]);

    /** Thumbnail file id and batch count per course, from the batches the institute already has. */
    const courseInfo = useMemo(() => {
        const info = new Map<string, { thumbnailId?: string | null; batches: number }>();
        (instituteDetails?.batches_for_sessions ?? []).forEach((batch) => {
            const current = info.get(batch.package_dto.id);
            info.set(batch.package_dto.id, {
                thumbnailId: current?.thumbnailId ?? batch.package_dto.thumbnail_id,
                batches: (current?.batches ?? 0) + 1,
            });
        });
        return info;
    }, [instituteDetails]);

    const thumbnailUrl = useThumbnailUrls(
        Array.from(courseInfo.values())
            .map((info) => info.thumbnailId)
            .filter((id): id is string => !!id)
    );

    const creationType = form.watch('courseCreationType');

    const createCourseTrigger = (
        <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-lg border border-primary-100 bg-primary-50 px-4 text-body font-semibold text-primary-500 transition-colors hover:bg-primary-100"
        >
            <PlusCircle size={18} />
            {t('createNewButton', { course: courseTerm })}
        </button>
    );

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                    <p className="text-title font-semibold text-neutral-800">
                        {t('title', { course: courseTerm })}
                    </p>
                    <p className="text-body text-neutral-500">
                        {t('subtitle', { course: courseLower })}
                    </p>
                </div>
                <AddCourseButton trigger={createCourseTrigger} />
            </div>

            <FormField
                control={form.control}
                name="courseCreationType"
                render={({ field }) => (
                    <FormItem>
                        <FormControl>
                            <RadioGroup
                                className="grid gap-4 md:grid-cols-2"
                                onValueChange={(value) => {
                                    field.onChange(value);
                                    form.setValue('selectedCourse', null); // Reset dependent field
                                }}
                                value={field.value}
                            >
                                <ChoiceCard
                                    id="existing-course"
                                    value="existing"
                                    selected={field.value === 'existing'}
                                    disabled={courseList.length === 0}
                                    icon={<BookOpen size={22} />}
                                    iconClassName="bg-primary-50 text-primary-500"
                                    title={t('selectExisting', { course: courseLower })}
                                    description={t('selectExistingHint', {
                                        courses: getTerminologyPlural(
                                            ContentTerms.Course,
                                            SystemTerms.Course
                                        ).toLocaleLowerCase(),
                                    })}
                                />
                                <ChoiceCard
                                    id="new-course"
                                    value="new"
                                    selected={field.value === 'new'}
                                    icon={<Plus size={22} />}
                                    iconClassName="bg-success-50 text-success-600"
                                    title={t('createNew', { course: courseLower })}
                                    description={t('createNewHint', {
                                        course: courseLower,
                                        batch: batchTerm.toLocaleLowerCase(),
                                    })}
                                />
                            </RadioGroup>
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />

            {creationType === 'existing' && (
                <FormField
                    control={form.control}
                    name="selectedCourse"
                    rules={{ required: t('validation.selectCourse') }}
                    render={({ field }) => (
                        <FormItem className="flex flex-col gap-1.5">
                            <FormLabel className="text-subtitle font-semibold text-neutral-700">
                                {courseTerm} <span className="text-danger-500">*</span>
                            </FormLabel>
                            <FormControl>
                                <BatchItemSelect
                                    items={courseList}
                                    value={field.value}
                                    onChange={field.onChange}
                                    placeholder={t('selectPlaceholder', { course: courseLower })}
                                    searchPlaceholder={t('searchPlaceholder', {
                                        course: courseLower,
                                    })}
                                    emptyMessage={t('emptyCourses')}
                                    noMatchMessage={t('noMatch', { course: courseLower })}
                                    renderVisual={(course) => {
                                        const url = thumbnailUrl(
                                            courseInfo.get(course.id)?.thumbnailId
                                        );
                                        return url ? (
                                            <img
                                                src={url}
                                                alt=""
                                                className="size-10 shrink-0 rounded-md object-cover"
                                            />
                                        ) : (
                                            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                                                <BookOpen size={18} />
                                            </span>
                                        );
                                    }}
                                    renderMeta={(course) =>
                                        t('batchCount', {
                                            count: courseInfo.get(course.id)?.batches ?? 0,
                                            batch: batchTerm.toLocaleLowerCase(),
                                            batches: getTerminologyPlural(
                                                ContentTerms.Batch,
                                                SystemTerms.Batch
                                            ).toLocaleLowerCase(),
                                        })
                                    }
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            )}

            {creationType === 'new' && (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center">
                    <p className="max-w-md text-body text-neutral-600">
                        {t('newCourseHint', {
                            course: courseLower,
                            batch: batchTerm.toLocaleLowerCase(),
                        })}
                    </p>
                    {/* The full course wizard; once the course exists it is picked above. */}
                    <AddCourseButton />
                </div>
            )}
        </div>
    );
};
