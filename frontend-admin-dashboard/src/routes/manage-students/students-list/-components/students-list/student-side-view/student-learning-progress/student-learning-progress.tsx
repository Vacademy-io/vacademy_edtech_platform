import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStudentSubjectsProgressQuery } from '@/routes/manage-students/students-list/-services/getStudentSubjects';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { BatchPicker } from '../BatchPicker';
import {
    SubjectWithDetails,
} from '@/routes/manage-students/students-list/-types/student-subjects-details-types';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { BatchForSessionType } from '@/schemas/student/student-list/institute-schema';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { StatusChip } from '@/components/design-system/status-chips';
import calculateLearningPercentage from '@/routes/manage-students/students-list/-utils/calculateLearningPercentage';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useForm, FormProvider } from 'react-hook-form';
import { useRouter } from '@tanstack/react-router';
import {
    GraduationCap,
    Stack,
    ChartLineUp,
    ClockCounterClockwise,
    CaretDown,
    CaretRight,
    VideoCamera,
    FileText,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    ProfileSectionCard,
    ProfileRing,
    ProfileSkeleton,
    ProfileError,
    ProfileEmpty,
    ProfileHero,
    ProfileActionBar,
    ProfileMiniBar,
} from '../profile-ui';
import { InlineProgress } from './inline-progress';
import { ChapterSlideList } from './chapter-slide-list';

// ── Per-subject completion helper ─────────────────────────────────────────────
// Mirrors calculateLearningPercentage (the backend subject rollup) scoped to a
// single subject: subject% = mean of its modules' canonical percentage_completed,
// every module counted, missing → 0. Kept consistent with the overall gauge so a
// subject's "behind" status matches how it weighs into the course number.
function calcSubjectPercentage(subject: SubjectWithDetails): number {
    const modules = subject.modules ?? [];
    if (modules.length === 0) return 0;
    const moduleSum = modules.reduce(
        (sum, mod) => sum + (mod.percentage_completed ?? 0),
        0
    );
    return moduleSum / modules.length;
}

export const StudentLearningProgress = ({ isSubmissionTab }: { isSubmissionTab?: boolean }) => {
    const { t } = useTranslation('manageStudentsLearningProgress');
    const [currentSubjectDetails, setCurrentSubjectDetails] = useState<SubjectWithDetails | null>(
        null
    );
    // Only one module accordion can be open at a time per handoff.
    const [openModuleId, setOpenModuleId] = useState<string>('');
    // Chapter drill-down: expanding a chapter loads its slide-level breakdown.
    const [openChapterId, setOpenChapterId] = useState<string>('');

    const { selectedStudent } = useStudentSidebar();
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();

    const [batch, setBatch] = useState<BatchForSessionType | null>(null);
    const [percentageCompleted, setPercentageCompleted] = useState<number>(0);
    const router = useRouter();

    // Multi-enrollment: admin scopes the progress view to a specific batch.
    // Defaults to the row's primary (latest) ps_id; falls back to the legacy single field.
    const enrollmentPsIds: string[] = (selectedStudent?.all_package_session_ids?.length
        ? selectedStudent.all_package_session_ids
        : selectedStudent?.package_session_id
          ? [selectedStudent.package_session_id]
          : []) as string[];
    const [selectedPsId, setSelectedPsId] = useState<string>(enrollmentPsIds[0] ?? '');
    useEffect(() => {
        setSelectedPsId(enrollmentPsIds[0] ?? '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStudent?.user_id]);
    const activePsId = isSubmissionTab
        ? selectedStudent?.package_id || ''
        : selectedPsId;

    // Initialize the form and its methods
    const formMethods = useForm({
        defaultValues: {
            subject: '',
            module: '',
        },
    });

    useEffect(() => {
        setBatch(
            getDetailsFromPackageSessionId({ packageSessionId: activePsId })
        );
    }, [selectedStudent, activePsId]);

    const {
        data: subjectsWithChapters,
        isLoading,
        isError,
        error,
        refetch,
    } = useStudentSubjectsProgressQuery({
        userId: isSubmissionTab ? selectedStudent?.id || '' : selectedStudent?.user_id || '',
        packageSessionId: activePsId,
    });

    useEffect(() => {
        if (subjectsWithChapters && subjectsWithChapters !== null) {
            const percentage = calculateLearningPercentage(subjectsWithChapters);
            setPercentageCompleted(percentage);
        }
    }, [subjectsWithChapters]);

    useEffect(() => {
        if (subjectsWithChapters && subjectsWithChapters.length > 0 && subjectsWithChapters[0]) {
            setCurrentSubjectDetails(subjectsWithChapters[0]);
            formMethods.setValue('subject', subjectsWithChapters[0].subject_dto.id.toString());
        } else {
            setCurrentSubjectDetails(null);
        }
    }, [subjectsWithChapters]);

    useEffect(() => {
        if (
            currentSubjectDetails &&
            currentSubjectDetails.modules.length > 0 &&
            currentSubjectDetails.modules[0]
        ) {
            const firstModuleId = currentSubjectDetails.modules[0].module.id.toString();
            setOpenModuleId(firstModuleId);
            formMethods.setValue('module', firstModuleId);
        } else {
            setOpenModuleId('');
        }
    }, [currentSubjectDetails]);

    const handleSubjectChange = (subject: SubjectWithDetails) => {
        setCurrentSubjectDetails(subject);
        formMethods.setValue('subject', subject.subject_dto.id.toString());
        // Reset module accordion to the new subject's first module.
        const firstModuleId = subject.modules[0]?.module.id.toString() ?? '';
        setOpenModuleId(firstModuleId);
        if (firstModuleId) {
            formMethods.setValue('module', firstModuleId);
        }
    };

    if (selectedStudent == null)
        return <ProfileEmpty icon={GraduationCap} title={t('emptyState.learnerUnavailable')} />;

    // Picker stays visible across loading/error/empty so admin can still switch batches.
    const picker = !isSubmissionTab && (
        <BatchPicker
            packageSessionIds={enrollmentPsIds}
            value={selectedPsId}
            onChange={setSelectedPsId}
            label={t('batchPicker.label')}
        />
    );

    if (isLoading)
        return (
            <div className="flex flex-col gap-3">
                {picker}
                <ProfileSkeleton blocks={2} />
            </div>
        );
    if (isError || error)
        return (
            <div className="flex flex-col gap-3">
                {picker}
                <ProfileError
                    title={t('errorState.title')}
                    hint={t('errorState.hint')}
                    onRetry={() => refetch()}
                />
            </div>
        );
    if (
        subjectsWithChapters == null ||
        subjectsWithChapters == undefined ||
        subjectsWithChapters.length == 0 ||
        subjectsWithChapters[0] == undefined
    )
        return (
            <div className="flex flex-col gap-3">
                {picker}
                <ProfileEmpty
                    icon={Stack}
                    title={t('emptyState.noCourseContent')}
                    hint={t('emptyState.noCourseContentHint')}
                />
            </div>
        );

    // ── Report navigation handlers ───────────────────────────────────────────
    // learningTab is lower-cased to match the Tabs `value` in studentReports.tsx
    // (`timeline` / `progress`). levelId uses batch.level.id — was incorrectly
    // set to batch.session.id, which made the Level prefill always miss.
    const handleLearningTimeLineClick = () => {
        router.navigate({
            to: '/study-library/reports',
            search: {
                studentReport: {
                    tab: 'STUDENT',
                    learningTab: 'timeline',
                    courseId: batch?.package_dto.id,
                    sessionId: batch?.session.id,
                    levelId: batch?.level.id,
                    fullName: selectedStudent.full_name,
                    userId: isSubmissionTab
                        ? selectedStudent?.id || ''
                        : selectedStudent?.user_id || '',
                },
            },
        });
    };
    const handleLearningProgressClick = () => {
        router.navigate({
            to: '/study-library/reports',
            search: {
                studentReport: {
                    tab: 'STUDENT',
                    learningTab: 'progress',
                    courseId: batch?.package_dto.id,
                    sessionId: batch?.session.id,
                    levelId: batch?.level.id,
                    fullName: selectedStudent.full_name,
                    userId: isSubmissionTab
                        ? selectedStudent?.id || ''
                        : selectedStudent?.user_id || '',
                },
            },
        });
    };

    // ── Hero derived values ──────────────────────────────────────────────────
    const heroTone =
        percentageCompleted >= 75
            ? 'success'
            : percentageCompleted >= 40
              ? 'primary'
              : 'warning';

    // Count subjects where per-subject completion is below 25%
    const behindCount = subjectsWithChapters.filter(
        (s) => calcSubjectPercentage(s) < 25
    ).length;

    const subjectTermLabel = getTerminology(ContentTerms.Subjects, SystemTerms.Subjects);
    const moduleTermLabel = getTerminology(ContentTerms.Modules, SystemTerms.Modules);
    // The learner id the slide-progress endpoint expects (submission tab keys off
    // the row id; the normal progress view keys off user_id) — same rule as the
    // subjects query above.
    const learnerUserId = isSubmissionTab
        ? selectedStudent.id || ''
        : selectedStudent.user_id || '';

    return (
        <FormProvider {...formMethods}>
            <div className="flex flex-col gap-3">
                {picker}

                {/* ── Hero ─────────────────────────────────────────────── */}
                <ProfileHero
                    eyebrow={batch?.package_dto.package_name || t('hero.courseFallback')}
                    title={t('hero.percentComplete', { percent: Math.round(percentageCompleted) })}
                    subtitle={
                        batch
                            ? `${batch.session.session_name} · ${batch.level.level_name}`
                            : undefined
                    }
                    icon={GraduationCap}
                    tone={heroTone}
                >
                    <div className="flex items-center gap-4">
                        <ProfileRing value={percentageCompleted} />
                        {behindCount > 0 && (
                            <StatusChip
                                status="WARNING"
                                textSize="text-caption"
                                text={t('hero.behindOn', {
                                    count: behindCount,
                                    term: subjectTermLabel.toLowerCase(),
                                })}
                            />
                        )}
                    </div>
                </ProfileHero>

                {/* ── Report action bar ─────────────────────────────────── */}
                <ProfileActionBar>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={handleLearningTimeLineClick}
                    >
                        <ClockCounterClockwise className="size-4" />
                        {t('actions.learningTimeline')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={handleLearningProgressClick}
                    >
                        <ChartLineUp className="size-4" />
                        {t('actions.learningProgress')}
                    </MyButton>
                </ProfileActionBar>

                {/* ── Course content — Subject dropdown selects which subject's
                       modules to show; modules are an accordion stack. ─────── */}
                <ProfileSectionCard
                    icon={Stack}
                    heading={t('courseContent.heading')}
                    action={
                        subjectsWithChapters.length > 1 ? (
                            <MyDropdown
                                currentValue={
                                    currentSubjectDetails?.subject_dto.subject_name ?? ''
                                }
                                dropdownList={subjectsWithChapters.map(
                                    (s) => s.subject_dto.subject_name
                                )}
                                placeholder={t('courseContent.selectSubject', {
                                    term: subjectTermLabel.toLowerCase(),
                                })}
                                handleChange={(value: string) => {
                                    const next = subjectsWithChapters.find(
                                        (s) => s.subject_dto.subject_name === value
                                    );
                                    if (next) handleSubjectChange(next);
                                }}
                            />
                        ) : null
                    }
                >
                    {currentSubjectDetails == null ||
                    currentSubjectDetails.modules.length === 0 ? (
                        <p className="px-1 py-2 text-caption italic text-muted-foreground">
                            {t('courseContent.noModules', {
                                moduleTerm: moduleTermLabel.toLowerCase(),
                                subjectTerm: subjectTermLabel.toLowerCase(),
                            })}
                        </p>
                    ) : (
                        <div className="flex flex-col gap-2.5">
                            {currentSubjectDetails.modules.map((mod) => {
                                // Use the module's actual completion (backend
                                // PERCENTAGE_MODULE_COMPLETED), not the count of fully-100%
                                // chapters — otherwise a module whose chapters are all
                                // partial (e.g. 66%) shows 0% despite being in progress.
                                const modPct = mod.percentage_completed ?? 0;
                                const isOpen = openModuleId === mod.module.id.toString();

                                return (
                                    <div
                                        key={mod.module.id}
                                        className="overflow-hidden rounded-md border border-border"
                                    >
                                        {/* Header (tinted surface-2 strip) */}
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setOpenModuleId(
                                                    isOpen ? '' : mod.module.id.toString()
                                                )
                                            }
                                            aria-expanded={isOpen}
                                            className={cn(
                                                'flex w-full items-center gap-3 bg-muted px-4 py-3 text-left transition',
                                                'hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400'
                                            )}
                                        >
                                            <span className="shrink-0 text-muted-foreground">
                                                {isOpen ? (
                                                    <CaretDown
                                                        className="size-4"
                                                        weight="bold"
                                                    />
                                                ) : (
                                                    <CaretRight
                                                        className="size-4"
                                                        weight="bold"
                                                    />
                                                )}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-body font-semibold text-card-foreground">
                                                {t('courseContent.moduleLabel', {
                                                    moduleTerm: moduleTermLabel,
                                                    moduleName: mod.module.module_name,
                                                })}
                                            </span>
                                            <div className="w-24 shrink-0">
                                                <ProfileMiniBar value={modPct} label="" />
                                            </div>
                                            <span className="w-10 shrink-0 text-right text-caption font-semibold text-primary-600">
                                                {Math.round(modPct)}%
                                            </span>
                                        </button>

                                        {/* Body: flat list of chapters as Done / Behind rows */}
                                        {isOpen && (
                                            <div className="flex flex-col bg-card px-4 pb-3 pt-1.5">
                                                {mod.chapters.length === 0 ? (
                                                    <p className="py-2 text-caption italic text-muted-foreground">
                                                        {t('courseContent.noChapters', {
                                                            moduleTerm:
                                                                moduleTermLabel.toLowerCase(),
                                                        })}
                                                    </p>
                                                ) : (
                                                    mod.chapters.map((chapter, idx) => {
                                                        const chapterPct =
                                                            chapter.percentage_completed ?? 0;
                                                        const isDone = chapterPct >= 100;
                                                        // Treat the chapter as a video if any of
                                                        // its slides are videos, otherwise show
                                                        // the document icon.
                                                        const isVideo =
                                                            (chapter.video_count ?? 0) > 0;
                                                        const TypeIcon = isVideo
                                                            ? VideoCamera
                                                            : FileText;
                                                        const isChapterOpen =
                                                            openChapterId === chapter.id;
                                                        return (
                                                            <div
                                                                key={chapter.id}
                                                                className={cn(
                                                                    idx > 0 &&
                                                                        'border-t border-neutral-100'
                                                                )}
                                                            >
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setOpenChapterId(
                                                                            isChapterOpen
                                                                                ? ''
                                                                                : chapter.id
                                                                        )
                                                                    }
                                                                    aria-expanded={isChapterOpen}
                                                                    className="flex w-full items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                                                                >
                                                                    <span className="shrink-0 text-muted-foreground">
                                                                        {isChapterOpen ? (
                                                                            <CaretDown
                                                                                className="size-3.5"
                                                                                weight="bold"
                                                                            />
                                                                        ) : (
                                                                            <CaretRight
                                                                                className="size-3.5"
                                                                                weight="bold"
                                                                            />
                                                                        )}
                                                                    </span>
                                                                    <span
                                                                        className={cn(
                                                                            'flex size-7 shrink-0 items-center justify-center rounded-md',
                                                                            isDone
                                                                                ? 'bg-success-50 text-success-600'
                                                                                : 'bg-warning-50 text-warning-600'
                                                                        )}
                                                                    >
                                                                        <TypeIcon
                                                                            className="size-4"
                                                                            weight="duotone"
                                                                        />
                                                                    </span>
                                                                    <span className="min-w-0 flex-1 truncate text-body text-card-foreground">
                                                                        {chapter.chapter_name}
                                                                    </span>
                                                                    <InlineProgress
                                                                        percentage={chapterPct}
                                                                    />
                                                                </button>
                                                                {isChapterOpen && (
                                                                    <ChapterSlideList
                                                                        userId={learnerUserId}
                                                                        chapterId={chapter.id}
                                                                    />
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </ProfileSectionCard>
            </div>
        </FormProvider>
    );

};
