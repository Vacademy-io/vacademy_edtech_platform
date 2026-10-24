import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from '@/components/ui/dialog';
import { Fragment, useEffect, useState } from 'react';
import { CreateCourseStep } from './create-course-step';
import { CreateSessionStep } from './create-session-step';
import { CreateLevelStep } from './create-level-step';
import { FormProvider, useForm, useFormContext } from 'react-hook-form';
import { toast } from 'sonner';
import { useAddCourse } from '@/services/study-library/course-operations/add-course';
import { CourseFormData } from '@/components/common/study-library/add-course/add-course-form';
import { useCopyStudyMaterialFromSession } from '../../../manage-students/students-list/-services/copyStudyMaterialFromSession';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    ArrowRight,
    BookOpen,
    CalendarCheck,
    Check,
    Copy,
    Plus,
    Stack,
    X,
} from '@phosphor-icons/react';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import dayjs from 'dayjs';
import { DEFAULT_LEVEL_ID, DEFAULT_SESSION_ID } from '../-utils/batch-defaults';

interface FormData {
    // Course step
    courseCreationType: 'existing' | 'new';
    selectedCourse: { id: string; name: string } | null;

    // Session step
    sessionCreationType: 'existing' | 'new';
    selectedSession: { id: string; name: string } | null;
    selectedStartDate: string | null;

    // Level step
    levelCreationType: 'existing' | 'new';
    selectedLevel: { id: string; name: string } | null;
    selectedLevelDuration: number | null;
    duplicateStudyMaterials: boolean;
    selectedDuplicateSession: { id: string; name: string } | null;

    // Review step. Optional: blank = the batch shows as level + course name.
    batchName: string;
}

const DEFAULT_VALUES: FormData = {
    courseCreationType: 'existing',
    selectedCourse: null,
    sessionCreationType: 'existing',
    selectedSession: null,
    selectedStartDate: null,
    levelCreationType: 'existing',
    selectedLevel: null,
    selectedLevelDuration: null,
    duplicateStudyMaterials: false,
    selectedDuplicateSession: null,
    batchName: '',
};

const BATCH_NAME_MAX_LENGTH = 255;

// Session and level are optional; skipping either lands on the shared default.
const hasSession = (values: FormData) =>
    values.sessionCreationType === 'new'
        ? !!values.selectedSession?.name
        : !!values.selectedSession?.id;
const hasLevel = (values: FormData) =>
    values.levelCreationType === 'new' ? !!values.selectedLevel?.name : !!values.selectedLevel?.id;

const REVIEW_STEP = 3;

const Stepper = ({ steps, current }: { steps: string[]; current: number }) => (
    <ol className="flex items-center gap-3">
        {steps.map((label, index) => {
            const done = index < current;
            const active = index === current;
            return (
                <Fragment key={label}>
                    {index > 0 && (
                        <li
                            aria-hidden
                            className={cn(
                                'hidden h-px min-w-6 flex-1 sm:block',
                                done || active ? 'bg-primary-500' : 'bg-neutral-200'
                            )}
                        />
                    )}
                    <li
                        className="flex shrink-0 items-center gap-2.5"
                        aria-current={active ? 'step' : undefined}
                    >
                        <span
                            className={cn(
                                'flex size-9 items-center justify-center rounded-full border text-body font-semibold',
                                done || active
                                    ? 'border-primary-500 bg-primary-500 text-white'
                                    : 'border-neutral-200 bg-white text-neutral-500'
                            )}
                        >
                            {done ? <Check size={16} weight="bold" /> : index + 1}
                        </span>
                        <span
                            className={cn(
                                'hidden text-body md:inline',
                                active ? 'font-semibold text-primary-500' : 'text-neutral-600'
                            )}
                        >
                            {label}
                        </span>
                    </li>
                </Fragment>
            );
        })}
    </ol>
);

const ReviewRow = ({
    icon,
    label,
    value,
    hint,
    isNew,
}: {
    icon: JSX.Element;
    label: string;
    value: string;
    hint?: string | null;
    isNew?: boolean;
}) => {
    const { t } = useTranslation('manageInstituteCreateBatchDialog');
    return (
        <div className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                {icon}
            </span>
            <div className="flex min-w-0 grow flex-col">
                <span className="text-caption text-neutral-500">{label}</span>
                <span className="truncate text-subtitle font-semibold text-neutral-800">
                    {value || '—'}
                </span>
                {hint && <span className="text-caption text-neutral-500">{hint}</span>}
            </div>
            {isNew && (
                <span className="rounded-full bg-success-50 px-2.5 py-0.5 text-caption font-medium text-success-600">
                    {t('review.new')}
                </span>
            )}
        </div>
    );
};

const ReviewStep = () => {
    const { t } = useTranslation('manageInstituteCreateBatchDialog');
    const { getValues, watch, setValue } = useFormContext<FormData>();
    const values = getValues();
    const batchName = watch('batchName');
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const sessionTerm = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const levelTerm = getTerminology(ContentTerms.Level, SystemTerms.Level);
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const startDate = values.selectedStartDate ? dayjs(values.selectedStartDate) : null;
    const sessionChosen = hasSession(values);
    const levelChosen = hasLevel(values);
    // What the card shows when no name is given (mirrors the batches query).
    const fallbackName = [
        levelChosen ? values.selectedLevel?.name : 'default',
        values.selectedCourse?.name,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <p className="text-title font-semibold text-neutral-800">{t('review.title')}</p>
                <p className="text-body text-neutral-500">{t('review.subtitle')}</p>
            </div>
            <div className="flex flex-col gap-1.5">
                <MyInput
                    inputType="text"
                    label={t('review.batchName', { batchTerm })}
                    input={batchName}
                    onChangeFunction={(e) => setValue('batchName', e.target.value)}
                    inputPlaceholder={fallbackName}
                    maxLength={BATCH_NAME_MAX_LENGTH}
                    size="large"
                    className="w-full sm:w-full"
                />
                <span className="text-caption text-neutral-500">{t('review.batchNameHint')}</span>
            </div>
            <div className="flex flex-col divide-y divide-neutral-100 rounded-xl border border-neutral-200 p-5">
                <ReviewRow
                    icon={<BookOpen size={20} />}
                    label={courseTerm}
                    value={values.selectedCourse?.name ?? ''}
                />
                <ReviewRow
                    icon={<CalendarCheck size={20} />}
                    label={sessionTerm}
                    value={
                        sessionChosen
                            ? values.selectedSession?.name ?? ''
                            : t('review.defaultValue')
                    }
                    hint={
                        sessionChosen &&
                        values.sessionCreationType === 'new' &&
                        startDate?.isValid()
                            ? t('review.startsOn', { date: startDate.format('DD MMM YYYY') })
                            : null
                    }
                    isNew={sessionChosen && values.sessionCreationType === 'new'}
                />
                <ReviewRow
                    icon={<Stack size={20} />}
                    label={levelTerm}
                    value={
                        levelChosen ? values.selectedLevel?.name ?? '' : t('review.defaultValue')
                    }
                    hint={
                        levelChosen &&
                        values.levelCreationType === 'new' &&
                        values.selectedLevelDuration
                            ? t('review.duration', { count: values.selectedLevelDuration })
                            : null
                    }
                    isNew={levelChosen && values.levelCreationType === 'new'}
                />
                {values.duplicateStudyMaterials && values.selectedDuplicateSession && (
                    <ReviewRow
                        icon={<Copy size={20} />}
                        label={t('review.copyFrom')}
                        value={values.selectedDuplicateSession.name}
                    />
                )}
            </div>
            <p className="rounded-lg bg-info-50 px-4 py-3 text-body text-info-700">
                {t('review.inviteNote')}
            </p>
        </div>
    );
};

interface CreateBatchDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Pre-selects this course, e.g. when opened from a course's own menu. */
    initialCourse?: { id: string; name: string } | null;
}

export const CreateBatchDialog = ({
    open,
    onOpenChange,
    initialCourse,
}: CreateBatchDialogProps) => {
    const { t } = useTranslation('manageInstituteCreateBatchDialog');
    const [currentStep, setCurrentStep] = useState(0);
    const addCourseMutation = useAddCourse();
    const copyStudyMaterialFromSession = useCopyStudyMaterialFromSession();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const methods = useForm<FormData>({ defaultValues: DEFAULT_VALUES });

    // Every opening starts clean, on the course step, with the caller's course if any.
    useEffect(() => {
        if (!open) return;
        setCurrentStep(0);
        methods.reset({ ...DEFAULT_VALUES, selectedCourse: initialCourse ?? null });
    }, [open, initialCourse]);

    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    const nextStep = async () => {
        const values = methods.getValues();
        if (currentStep === 0) {
            if (values.courseCreationType === 'new') {
                toast.error(t('validation.createCourseFirst'));
                return;
            }
            if (await methods.trigger(['courseCreationType', 'selectedCourse'])) setCurrentStep(1);
        } else if (currentStep === 1) {
            // A new session needs both a name and a date; neither = the default session.
            if (
                values.sessionCreationType === 'new' &&
                !!values.selectedSession?.name !== !!values.selectedStartDate
            ) {
                toast.error(t('validation.sessionDetails'));
                return;
            }
            if (await methods.trigger(['sessionCreationType', 'selectedSession']))
                setCurrentStep(2);
        } else if (currentStep === 2) {
            if (await methods.trigger(['selectedLevel', 'selectedDuplicateSession']))
                setCurrentStep(REVIEW_STEP);
        }
    };

    const prevStep = () => setCurrentStep(currentStep - 1);

    const handleAddCourse = ({
        requestData,
        duplicateFromSession,
        duplicationSessionId,
        courseId,
        levelId,
        sessionId,
    }: {
        requestData: CourseFormData;
        duplicateFromSession: boolean;
        duplicationSessionId: string;
        courseId: string;
        levelId: string;
        sessionId: string;
    }) => {
        addCourseMutation.mutate(
            { requestData: requestData },
            {
                onSuccess: (responseData) => {
                    if (duplicateFromSession) {
                        setTimeout(() => {
                            const toPackageSessionId = getPackageSessionId({
                                courseId: responseData.data,
                                levelId: levelId,
                                sessionId: sessionId,
                            });
                            const fromPackageSessionId = getPackageSessionId({
                                courseId: courseId,
                                levelId: levelId,
                                sessionId: duplicationSessionId,
                            });
                            copyStudyMaterialFromSession.mutate(
                                {
                                    fromPackageSessionId: fromPackageSessionId || '',
                                    toPackageSessionId: toPackageSessionId || '',
                                },
                                {
                                    onSuccess: () => {
                                        toast.success(t('toast.studyMaterialCopiedSuccess'));
                                    },
                                    onError: (error) => {
                                        toast.error(
                                            error.message || t('toast.studyMaterialCopyFailed')
                                        );
                                    },
                                }
                            );
                        }, 3000);
                    }

                    toast.success(t('toast.batchCreatedSuccess'));
                    onOpenChange(false);
                },
                onError: (error) => {
                    toast.error(error.message || t('toast.batchCreateFailed'));
                },
            }
        );
    };

    const submit = () => {
        methods.handleSubmit((data) => {
            const levelChosen = hasLevel(data);
            const sessionChosen = hasSession(data);
            const newLevel = levelChosen && data.levelCreationType === 'new';
            // A name only for a new level: the backend renames an existing level
            // to whatever name is sent, and the default level is shared by every
            // institute.
            const levelData = {
                id: levelChosen ? data.selectedLevel?.id || '' : DEFAULT_LEVEL_ID,
                new_level: newLevel,
                level_name: newLevel ? data.selectedLevel?.name || '' : '',
                duration_in_days: levelChosen ? data.selectedLevelDuration || null : null,
                thumbnail_id: null,
                package_id: data.selectedCourse?.id || '',
                batch_name: data.batchName.trim() || undefined,
            };

            const sessionData = {
                id: sessionChosen ? data.selectedSession?.id || '' : DEFAULT_SESSION_ID,
                new_session: sessionChosen && data.sessionCreationType === 'new',
                session_name: sessionChosen ? data.selectedSession?.name || '' : '',
                start_date: sessionChosen ? data.selectedStartDate || '' : '',
                levels: [levelData],
                status: 'ACTIVE',
                duplicate_from_session_id: data.duplicateStudyMaterials
                    ? data.selectedDuplicateSession?.id
                    : undefined,
            };

            // The course step only lets an existing course through.
            //
            // useAddCourse posts this object as-is, and the endpoint reads the
            // snake_case session/level fields above (session_name, new_session,
            // start_date, ...). CourseFormData describes the course wizard's form
            // state (name, startDate, newSession, ...) instead, so the payload is
            // cast rather than reshaped — reshaping it would change what is sent.
            const courseData = {
                id: data.selectedCourse?.id || '',
                course_name: data.selectedCourse?.name || '',
                thumbnail_file_id: '',
                new_course: false,
                contain_levels: true,
                sessions: [sessionData],
            } as unknown as CourseFormData;
            handleAddCourse({
                requestData: courseData,
                duplicateFromSession: data.duplicateStudyMaterials,
                duplicationSessionId: data.selectedDuplicateSession?.id || '',
                courseId: data.selectedCourse?.id || '',
                levelId: levelData.id,
                sessionId: sessionData.id,
            });
        })();
    };

    const steps = [
        <CreateCourseStep key="course" />,
        <CreateSessionStep key="session" />,
        <CreateLevelStep key="level" />,
        <ReviewStep key="review" />,
    ];

    const stepTitles = [
        t('step.selectTerm', { term: getTerminology(ContentTerms.Course, SystemTerms.Course) }),
        t('step.selectTerm', { term: getTerminology(ContentTerms.Session, SystemTerms.Session) }),
        t('step.selectTerm', { term: getTerminology(ContentTerms.Level, SystemTerms.Level) }),
        t('step.review'),
    ];

    const isReview = currentStep === REVIEW_STEP;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="dialog-no-close-icon flex max-h-[90vh] w-11/12 max-w-5xl flex-col gap-0 rounded-2xl border-0 bg-white p-0 shadow-2xl" // design-lint-ignore: viewport cap, as MyDialog
            >
                <div className="flex shrink-0 flex-col gap-6 px-6 pt-6 sm:px-9 sm:pt-8">
                    <div className="flex items-start gap-4">
                        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
                            <Stack size={28} />
                        </span>
                        <div className="flex grow flex-col gap-1">
                            <DialogTitle className="text-h2 font-semibold text-neutral-800">
                                {t('dialog.title', { batchTerm })}
                            </DialogTitle>
                            <DialogDescription className="text-body text-neutral-500">
                                {t('dialog.subtitle', {
                                    batchTerm: batchTerm.toLocaleLowerCase(),
                                })}
                            </DialogDescription>
                        </div>
                        <DialogClose
                            aria-label={t('button.close')}
                            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                        >
                            <X size={22} />
                        </DialogClose>
                    </div>
                    <Stepper steps={stepTitles} current={currentStep} />
                </div>

                <div className="min-h-0 grow overflow-y-auto px-6 py-6 sm:px-9">
                    <FormProvider {...methods}>
                        <form
                            onSubmit={(e) => e.preventDefault()}
                            className="rounded-xl border border-neutral-200 p-5 sm:p-6"
                        >
                            {steps[currentStep]}
                        </form>
                    </FormProvider>
                </div>

                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-100 px-6 py-5 sm:px-9">
                    {currentStep === 0 ? (
                        <MyButton
                            buttonType="secondary"
                            scale="large"
                            className="min-w-32"
                            onClick={() => onOpenChange(false)}
                        >
                            {t('button.cancel')}
                        </MyButton>
                    ) : (
                        <MyButton
                            buttonType="secondary"
                            scale="large"
                            className="min-w-32"
                            onClick={prevStep}
                            disable={addCourseMutation.isPending}
                        >
                            {t('button.back')}
                        </MyButton>
                    )}
                    <MyButton
                        buttonType="primary"
                        scale="large"
                        className="min-w-36 gap-2"
                        onClick={isReview ? submit : nextStep}
                        disable={addCourseMutation.isPending}
                    >
                        {isReview ? (
                            <>
                                <Plus size={18} />
                                {addCourseMutation.isPending
                                    ? t('button.creating')
                                    : t('trigger.createBatch', { term: batchTerm })}
                            </>
                        ) : (
                            <>
                                {t('button.nextStep')}
                                <ArrowRight size={18} />
                            </>
                        )}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
};
