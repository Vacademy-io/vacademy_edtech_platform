import { MyButton } from '@/components/design-system/button';
import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, CaretDown, Check } from '@phosphor-icons/react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import GenerateInviteLinkDialog from './GenerateInviteLinkDialog';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useStudyLibraryQuery } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import { transformApiDataToDummyStructure } from './-utils/helper';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
    createInviteSchema,
    CreateInviteFormValues,
    defaultCreateInviteValues,
    Course,
    Session,
    Level,
    Batch,
} from './CreateInviteSchema';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

type DummyBatchesType = {
    [key: string]: Session[];
};

const CreateInvite = () => {
    const { t } = useTranslation('manageStudentsCreateInvite');
    const { data: studyLibraryCoursesData } = useSuspenseQuery(useStudyLibraryQuery());
    const dummyCourses = transformApiDataToDummyStructure(studyLibraryCoursesData).dummyCourses;
    const dummyBatches = transformApiDataToDummyStructure(studyLibraryCoursesData).dummyBatches;
    const dummyBatchesTyped: DummyBatchesType = dummyBatches;
    const queryClient = useQueryClient();

    // Initialize form with react-hook-form
    const form = useForm<CreateInviteFormValues>({
        resolver: zodResolver(createInviteSchema),
        defaultValues: defaultCreateInviteValues,
        mode: 'onChange',
    });

    const { watch, setValue } = form;

    // Watch form values
    const selectedCourse = watch('selectedCourse');
    const selectedSession = watch('selectedSession');
    const selectedLevel = watch('selectedLevel');
    const selectedBatches = watch('selectedBatches');
    const showCourseDropdown = watch('showCourseDropdown');
    const showSessionDropdown = watch('showSessionDropdown');
    const showLevelDropdown = watch('showLevelDropdown');
    const showSummaryDialog = watch('showSummaryDialog');
    const dialogOpen = watch('dialogOpen');

    // Refs for dropdowns
    const courseDropdownRef = useRef<HTMLDivElement>(null);
    const sessionDropdownRef = useRef<HTMLDivElement>(null);
    const levelDropdownRef = useRef<HTMLDivElement>(null);

    const handleSelectCourse = (course: Course): void => {
        setValue('selectedCourse', course);
        setValue('selectedSession', null);
        setValue('selectedLevel', null);
        // Don't clear existing batches - allow cross-course bundles
        setValue('showCourseDropdown', false);
    };

    const handleSelectSession = (session: Session): void => {
        setValue('selectedSession', session);
        setValue('selectedLevel', null);
        setValue('showSessionDropdown', false);
    };

    const handleSelectLevel = (level: Level): void => {
        setValue('selectedLevel', level);
        setValue('showLevelDropdown', false);
    };

    const handleAddBatch = (): void => {
        if (selectedSession && selectedLevel && selectedCourse) {
            const newBatch: Batch = {
                sessionId: selectedSession.sessionId,
                levelId: selectedLevel.levelId,
                sessionName: selectedSession.sessionName,
                levelName: selectedLevel.levelName,
                courseId: selectedCourse.id,
                courseName: selectedCourse.name,
                isParent: selectedBatches.length === 0, // First batch is parent by default
            };
            setValue('selectedBatches', [...selectedBatches, newBatch]);
            setValue('selectedSession', null);
            setValue('selectedLevel', null);
        }
    };

    const handleRemoveBatch = (idx: number): void => {
        const updatedBatches = selectedBatches.filter((_, i) => i !== idx);
        // If removing parent batch and there are other batches, make first one parent
        if (selectedBatches[idx]?.isParent && updatedBatches.length > 0) {
            updatedBatches[0]!.isParent = true;
        }
        setValue('selectedBatches', updatedBatches);
    };

    const handleSetParentBatch = (idx: number): void => {
        const updatedBatches = selectedBatches.map((batch, i) => ({
            ...batch,
            isParent: i === idx,
        }));
        setValue('selectedBatches', updatedBatches);
    };

    const sessions: Session[] = selectedCourse ? dummyBatchesTyped[selectedCourse.id] || [] : [];
    const levels: Level[] = selectedSession ? selectedSession.levels : [];

    // Click outside for course dropdown
    useEffect(() => {
        if (!showCourseDropdown) return;
        function handleClick(e: MouseEvent) {
            if (
                courseDropdownRef.current &&
                !courseDropdownRef.current.contains(e.target as Node)
            ) {
                setValue('showCourseDropdown', false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showCourseDropdown, setValue]);

    // Click outside for session dropdown
    useEffect(() => {
        if (!showSessionDropdown) return;
        function handleClick(e: MouseEvent) {
            if (
                sessionDropdownRef.current &&
                !sessionDropdownRef.current.contains(e.target as Node)
            ) {
                setValue('showSessionDropdown', false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showSessionDropdown, setValue]);

    // Click outside for level dropdown
    useEffect(() => {
        if (!showLevelDropdown) return;
        function handleClick(e: MouseEvent) {
            if (levelDropdownRef.current && !levelDropdownRef.current.contains(e.target as Node)) {
                setValue('showLevelDropdown', false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showLevelDropdown, setValue]);

    return (
        <>
            <div>
                <Dialog open={dialogOpen} onOpenChange={(open) => setValue('dialogOpen', open)}>
                    <DialogTrigger asChild>
                        <MyButton
                            type="button"
                            scale="medium"
                            buttonType="secondary"
                            className="flex items-center gap-1 border-none bg-gray-100 p-4 py-5 font-semibold hover:bg-gray-200"
                        >
                            <Plus size={18} weight="fill" />
                            {t('trigger.createLink', {
                                term: getTerminology(OtherTerms.Invite, SystemTerms.Invite),
                            })}
                        </MyButton>
                    </DialogTrigger>
                    <DialogContent className="animate-fadeIn w-dialog-md">
                        <DialogHeader>
                            <DialogTitle>{t('dialog.title')}</DialogTitle>
                        </DialogHeader>
                        {/* Course Select */}
                        <div className="mb-1 mt-4 flex flex-col gap-2 text-sm font-medium">
                            <span>
                                {t('courseSelect.label', {
                                    term: getTerminology(ContentTerms.Course, SystemTerms.Course),
                                })}
                            </span>
                            <div className="relative" ref={courseDropdownRef}>
                                <button
                                    className="flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 shadow-sm transition-all duration-150 hover:shadow-md"
                                    onClick={() =>
                                        setValue('showCourseDropdown', !showCourseDropdown)
                                    }
                                    type="button"
                                >
                                    <span
                                        className={
                                            selectedCourse ? 'text-gray-900' : 'text-gray-400'
                                        }
                                    >
                                        {selectedCourse
                                        ? selectedCourse.name
                                        : t('courseSelect.placeholder')}
                                    </span>
                                    <CaretDown size={18} />
                                </button>
                                {showCourseDropdown && (
                                    <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded border bg-white shadow">
                                        {dummyCourses.map((course) => (
                                            <div
                                                key={course.id}
                                                className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-gray-100"
                                                onClick={() => handleSelectCourse(course)}
                                            >
                                                {selectedCourse ? (
                                                    <span
                                                        style={{
                                                            width: 20,
                                                            display: 'inline-block',
                                                        }}
                                                    >
                                                        {selectedCourse.id === course.id && (
                                                            <Check
                                                                size={18}
                                                                className="text-black"
                                                            />
                                                        )}
                                                    </span>
                                                ) : null}
                                                <span>{course.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        {/* Add Batch Section */}
                        {selectedCourse && (
                            <div className="animate-fadeIn mt-3">
                                <div className="mb-2 text-sm font-semibold">
                                    {t('addBatch.heading')}
                                </div>
                                <div className="mb-2 flex gap-2">
                                    {/* Session Dropdown */}
                                    <div className="relative flex-1" ref={sessionDropdownRef}>
                                        <button
                                            className="flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 shadow-sm transition-all duration-150 hover:shadow-md"
                                            onClick={() =>
                                                setValue(
                                                    'showSessionDropdown',
                                                    !showSessionDropdown
                                                )
                                            }
                                            type="button"
                                        >
                                            <span
                                                className={
                                                    selectedSession
                                                        ? 'text-gray-900'
                                                        : 'text-gray-400'
                                                }
                                            >
                                                {selectedSession
                                                    ? selectedSession.sessionName
                                                    : t('addBatch.sessionPlaceholder')}
                                            </span>
                                            <CaretDown size={18} />
                                        </button>
                                        {showSessionDropdown && (
                                            <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded border bg-white shadow">
                                                {sessions.map((session) => (
                                                    <div
                                                        key={session.sessionId}
                                                        className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-gray-100"
                                                        onClick={() => handleSelectSession(session)}
                                                    >
                                                        {selectedSession ? (
                                                            <span
                                                                style={{
                                                                    width: 20,
                                                                    display: 'inline-block',
                                                                }}
                                                            >
                                                                {selectedSession.sessionId ===
                                                                    session.sessionId && (
                                                                    <Check
                                                                        size={18}
                                                                        className="text-black"
                                                                    />
                                                                )}
                                                            </span>
                                                        ) : null}
                                                        <span>{session.sessionName}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    {/* Level Dropdown */}
                                    <div className="relative flex-1" ref={levelDropdownRef}>
                                        <button
                                            className={`flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 shadow-sm transition-all duration-150 ${!selectedSession ? 'cursor-not-allowed opacity-50' : 'hover:shadow-md'}`}
                                            onClick={() =>
                                                selectedSession &&
                                                setValue('showLevelDropdown', !showLevelDropdown)
                                            }
                                            type="button"
                                            disabled={!selectedSession}
                                        >
                                            <span
                                                className={
                                                    selectedLevel
                                                        ? 'text-gray-900'
                                                        : 'text-gray-400'
                                                }
                                            >
                                                {selectedLevel
                                                    ? selectedLevel.levelName
                                                    : t('addBatch.levelPlaceholder')}
                                            </span>
                                            <CaretDown size={18} />
                                        </button>
                                        {showLevelDropdown && selectedSession && (
                                            <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded border bg-white shadow">
                                                {levels.map((level) => (
                                                    <div
                                                        key={level.levelId}
                                                        className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-gray-100"
                                                        onClick={() => handleSelectLevel(level)}
                                                    >
                                                        {selectedLevel ? (
                                                            <span
                                                                style={{
                                                                    width: 20,
                                                                    display: 'inline-block',
                                                                }}
                                                            >
                                                                {selectedLevel.levelId ===
                                                                    level.levelId && (
                                                                    <Check
                                                                        size={18}
                                                                        className="text-black"
                                                                    />
                                                                )}
                                                            </span>
                                                        ) : null}
                                                        <span>{level.levelName}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <MyButton
                                    type="button"
                                    scale="small"
                                    buttonType="secondary"
                                    className="mt-2 w-full border-none bg-neutral-200 p-5 transition-transform duration-150 hover:border-none hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:opacity-50"
                                    disable={!(selectedSession && selectedLevel)}
                                    onClick={handleAddBatch}
                                >
                                    <Plus size={16} className="me-1" /> {t('addBatch.button')}
                                </MyButton>
                                {/* Selected Batches List */}
                                {selectedBatches.length > 0 && (
                                    <div className="animate-fadeIn mt-4">
                                        <div className="mb-1 text-sm font-semibold">
                                            {t('selectedBatches.heading')}
                                            {selectedBatches.length > 1 && (
                                                <span className="block text-xs text-gray-500">
                                                    {t('selectedBatches.parentHint')}
                                                </span>
                                            )}
                                        </div>
                                        <ul className="mt-2 space-y-1">
                                            {selectedBatches.length > 1 && (
                                                <RadioGroup
                                                    value={selectedBatches
                                                        .findIndex((batch) => batch.isParent)
                                                        .toString()}
                                                    onValueChange={(value) =>
                                                        handleSetParentBatch(parseInt(value))
                                                    }
                                                >
                                                    {selectedBatches.map((batch, idx) => (
                                                        <li
                                                            key={batch.sessionId + batch.levelId}
                                                            className={`flex items-center justify-between rounded-lg px-5 py-3 ${
                                                                batch.isParent
                                                                    ? 'border border-primary-200 bg-primary-50'
                                                                    : 'bg-gray-50'
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <RadioGroupItem
                                                                    value={idx.toString()}
                                                                    id={`batch-${idx}`}
                                                                />
                                                                <div className="flex flex-col">
                                                                    <span className="text-xs font-bold">
                                                                        {batch.courseName} -{' '}
                                                                        {batch.sessionName} -{' '}
                                                                        {batch.levelName}
                                                                    </span>
                                                                    {batch.isParent && (
                                                                        <span className="text-xs font-medium text-blue-600">
                                                                            {t(
                                                                                'selectedBatches.parentBadge'
                                                                            )}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <button
                                                                className="ml-2 text-gray-400 transition-colors hover:text-red-500"
                                                                onClick={() =>
                                                                    handleRemoveBatch(idx)
                                                                }
                                                                type="button"
                                                            >
                                                                <X size={16} />
                                                            </button>
                                                        </li>
                                                    ))}
                                                </RadioGroup>
                                            )}
                                            {selectedBatches.length === 1 && (
                                                <li
                                                    key={
                                                        (selectedBatches[0]?.sessionId || '') +
                                                        (selectedBatches[0]?.levelId || '')
                                                    }
                                                    className="flex items-center justify-between rounded-lg border border-primary-200 bg-primary-50 px-5 py-3"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex flex-col">
                                                            <span className="text-xs font-bold">
                                                                {selectedBatches[0]?.courseName} -{' '}
                                                                {selectedBatches[0]?.sessionName} -{' '}
                                                                {selectedBatches[0]?.levelName}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <button
                                                        className="ml-2 text-gray-400 transition-colors hover:text-red-500"
                                                        onClick={() => handleRemoveBatch(0)}
                                                        type="button"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </li>
                                            )}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                        {/* Action Buttons */}
                        <div className="mt-8 flex justify-end gap-3">
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                onClick={() => setValue('dialogOpen', false)}
                                className="bg-neutral-100 hover:border-none hover:bg-neutral-200"
                            >
                                {t('actions.cancel')}
                            </MyButton>
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="primary"
                                disable={selectedBatches.length === 0}
                                onClick={async () => {
                                    setValue('showSummaryDialog', true);
                                    await queryClient.invalidateQueries({
                                        queryKey: ['GET_PAYMENT_DETAILS'],
                                    });
                                }}
                            >
                                {t('actions.continue')}
                            </MyButton>
                        </div>
                    </DialogContent>
                    {/* Summary Dialog */}
                    <GenerateInviteLinkDialog
                        selectedCourse={selectedCourse}
                        selectedBatches={selectedBatches}
                        showSummaryDialog={showSummaryDialog}
                        setShowSummaryDialog={(open) => setValue('showSummaryDialog', open)}
                        setDialogOpen={(open) => setValue('dialogOpen', open)}
                        selectCourseForm={form}
                    />
                </Dialog>
            </div>
        </>
    );
};

export default CreateInvite;
