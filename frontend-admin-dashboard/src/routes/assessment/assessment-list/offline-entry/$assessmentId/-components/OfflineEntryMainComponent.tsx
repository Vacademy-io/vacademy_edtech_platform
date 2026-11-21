import { Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import {
    getAssessmentDetails,
    getQuestionDataForSection,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { Route } from '..';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { StudentSelector, StudentRow } from './StudentSelector';
import { QuestionNavigator } from './QuestionNavigator';
import { QuestionResponseForm } from './QuestionResponseForm';
import { TableViewResponseForm } from './TableViewResponseForm';
import { OfflineEntrySubmitDialog } from './OfflineEntrySubmitDialog';
import { OfflineAttachmentsPanel } from './OfflineAttachmentsPanel';
import { OfflineBulkImportDialog } from './OfflineBulkImportDialog';
import { MyButton } from '@/components/design-system/button';
import { FileZip } from '@phosphor-icons/react';
import {
    attachOfflineFiles,
    createAndSubmitOffline,
    submitDirectMarks,
} from '../-services/offline-entry-services';
import {
    AttachmentSlot,
    OfflineAttachmentFiles,
    OfflineAttachmentsRequest,
    OfflineResponseState,
    QuestionResponseState,
    ScoringMode,
} from '../-utils/types';
import { Section } from '@/types/assessments/assessment-steps';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import { Separator } from '@/components/ui/separator';
import { useFileUpload } from '@/hooks/use-file-upload';
import { ensureFileHasExtension } from '@/lib/file-download';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';

// Which request field each attachment slot maps to.
const ATTACHMENT_FIELD: Record<AttachmentSlot, keyof OfflineAttachmentsRequest> = {
    student: 'student_file_id',
    checked: 'checked_file_id',
    report: 'report_file_id',
};

type Step = 'SELECT_STUDENT' | 'ENTER_RESPONSES' | 'COMPLETED';

export const OfflineEntryMainComponent = () => {
    const { t } = useTranslation('assessmentOfflineEntryMainComponent');
    const { assessmentId } = Route.useParams();
    const navigate = useNavigate();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { setNavHeading } = useNavHeadingStore();

    const { data: assessmentDetails } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId,
            instituteId: instituteDetails?.id,
            type: 'ASSESSMENT',
        })
    );

    const assessmentName = assessmentDetails?.[0]?.saved_data?.name ?? t('defaults.assessmentName');
    const assessmentVisibility = assessmentDetails?.[0]?.saved_data?.assessment_visibility ?? 'PRIVATE';

    const sections: Section[] = useMemo(
        () => assessmentDetails?.[1]?.saved_data?.sections ?? [],
        [assessmentDetails]
    );

    const sectionIds = useMemo(
        () => sections.map((s) => s.id).join(','),
        [sections]
    );

    const { data: questionsDataSectionWise } = useSuspenseQuery(
        getQuestionDataForSection({ assessmentId, sectionIds })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const questionsMap: Record<string, any[]> = questionsDataSectionWise ?? {};

    const allQuestions = useMemo(
        () => Object.values(questionsMap).flat(),
        [questionsMap]
    );

    useEffect(() => {
        setNavHeading(t('navHeading'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const packageSessionIds = useMemo(
        () => (assessmentDetails?.[2]?.saved_data?.pre_batch_registrations ?? []).map(
            (r: { batchId: string }) => r.batchId
        ),
        [assessmentDetails]
    );

    const [step, setStep] = useState<Step>('SELECT_STUDENT');
    const [selectedStudent, setSelectedStudent] = useState<StudentRow | null>(null);
    const [scoringMode, setScoringMode] = useState<ScoringMode>('AUTO_CALCULATE');
    const [viewMode, setViewMode] = useState<'table' | 'preview'>('table');
    const [currentSectionId, setCurrentSectionId] = useState(sections[0]?.id ?? '');
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [responses, setResponses] = useState<OfflineResponseState>({});
    const [attachments, setAttachments] = useState<OfflineAttachmentFiles>({});
    const [showSubmitDialog, setShowSubmitDialog] = useState(false);
    const [showBulkImport, setShowBulkImport] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const { uploadFile } = useFileUpload();
    const adminUserId = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user ?? '';

    const currentQuestions = questionsMap[currentSectionId] ?? [];
    const currentQuestion = currentQuestions[currentQuestionIndex];

    const answeredCount = allQuestions.filter(
        (q) => (responses[q.question_id]?.selectedOptionIds?.length ?? 0) > 0
    ).length;
    const unansweredCount = allQuestions.length - answeredCount;

    const handleStudentSelect = (student: StudentRow) => {
        setSelectedStudent(student);
        setCurrentSectionId(sections[0]?.id ?? '');
        setCurrentQuestionIndex(0);
        setResponses({});
        setAttachments({});
        setStep('ENTER_RESPONSES');
    };

    const handleBackToSelection = () => {
        setSelectedStudent(null);
        setResponses({});
        setAttachments({});
        setCurrentQuestionIndex(0);
        setStep('SELECT_STUDENT');
    };

    const handleResponseChange = (questionId: string, response: QuestionResponseState) => {
        setResponses((prev) => ({ ...prev, [questionId]: response }));
    };

    const handleSelectSection = (sectionId: string) => {
        setCurrentSectionId(sectionId);
        setCurrentQuestionIndex(0);
    };

    const handleSelectQuestion = (_sectionId: string, index: number) => {
        setCurrentQuestionIndex(index);
    };

    const handlePrevious = () => {
        if (currentQuestionIndex > 0) {
            setCurrentQuestionIndex(currentQuestionIndex - 1);
        }
    };

    const handleNext = () => {
        if (currentQuestionIndex < currentQuestions.length - 1) {
            setCurrentQuestionIndex(currentQuestionIndex + 1);
        }
    };

    // Uploads the picked PDFs to S3 and returns the attach-files payload. Runs
    // BEFORE the attempt is created so a failed upload leaves nothing behind for
    // the admin to clean up — they just fix the file and submit again.
    const uploadAttachments = async (instituteId: string): Promise<OfflineAttachmentsRequest> => {
        const slots = Object.keys(attachments) as AttachmentSlot[];
        const payload: OfflineAttachmentsRequest = {};

        for (const slot of slots) {
            const file = attachments[slot];
            if (!file) continue;
            const fileId = await uploadFile({
                // Keep the extension so the PDF later opens as a PDF rather than
                // an extension-less download.
                file: ensureFileHasExtension(file),
                // The whole submit is already showing a spinner; letting the
                // uploader own the flag would clear it after the first file.
                setIsUploading: () => {},
                userId: adminUserId,
                source: instituteId,
                sourceId: 'ASSESSMENT_OFFLINE_ENTRY',
            });
            if (!fileId)
                throw new Error(t('errors.uploadFailed', { fileName: file.name }));
            payload[ATTACHMENT_FIELD[slot]] = fileId;
        }

        return payload;
    };

    const handleSubmit = async () => {
        if (!selectedStudent) return;
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            const iId = instituteDetails?.id ?? '';

            const attachmentPayload = await uploadAttachments(iId);

            // Build sections payload with option selections
            const sectionsPayload = sections.map((section) => ({
                section_id: section.id,
                questions: (questionsMap[section.id] ?? []).map((q: any) => ({
                    question_id: q.question_id,
                    type: q.question_type,
                    option_ids: responses[q.question_id]?.selectedOptionIds ?? [],
                })),
            }));

            const attemptParams = selectedStudent.registrationId
                ? { assessmentId, instituteId: iId, registrationId: selectedStudent.registrationId }
                : {
                      assessmentId,
                      instituteId: iId,
                      userId: selectedStudent.userId,
                      fullName: selectedStudent.name,
                      email: selectedStudent.email,
                      username: selectedStudent.username,
                      mobileNumber: selectedStudent.mobileNumber,
                      batchId: selectedStudent.batchId,
                  };

            // Single API call: create attempt + submit responses + auto-evaluate
            const attemptResponse = await createAndSubmitOffline(attemptParams, {
                sections: sectionsPayload,
            });

            // Override with direct marks for questions where marks were manually entered
            const directMarksQuestions = sections.flatMap((section) =>
                (questionsMap[section.id] ?? [])
                    .filter((q: any) => responses[q.question_id]?.marks != null)
                    .map((q: any) => ({
                        section_id: section.id,
                        question_id: q.question_id,
                        marks: responses[q.question_id]?.marks ?? 0,
                        status: (responses[q.question_id]?.marks ?? 0) > 0 ? 'CORRECT' : 'INCORRECT',
                    }))
            );

            if (directMarksQuestions.length > 0) {
                await submitDirectMarks(
                    assessmentId,
                    attemptResponse?.attempt_id ?? '',
                    iId,
                    { request: directMarksQuestions }
                );
            }

            // Attach the scanned sheets last: submitDirectMarks rewrites
            // evaluated_file_id from its own payload, so attaching the checked
            // copy before it would be overwritten.
            if (Object.keys(attachmentPayload).length > 0) {
                await attachOfflineFiles(
                    assessmentId,
                    attemptResponse?.attempt_id ?? '',
                    iId,
                    attachmentPayload
                );
            }

            toast.success(t('toasts.submitSuccess'));
            setStep('COMPLETED');
        } catch (error) {
            // Surface the real reason — an upload failure names the file that
            // failed, which "Failed to submit" alone never told the admin. Kept
            // on screen as well as toasted: a toast disappears while the admin is
            // still looking at the form they need to fix.
            console.error('Offline entry submit failed:', error);
            const backendMessage = (error as { response?: { data?: { ex?: string } } })?.response
                ?.data?.ex;
            const message =
                backendMessage ??
                (error instanceof Error && error.message
                    ? error.message
                    : t('errors.submitFailed'));
            setSubmitError(message);
            toast.error(message);
        } finally {
            setIsSubmitting(false);
            setShowSubmitDialog(false);
        }
    };

    // Step: SELECT_STUDENT
    if (step === 'SELECT_STUDENT') {
        return (
            <div className="flex flex-col gap-4 p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold">{assessmentName}</h1>
                        <p className="text-sm text-gray-500">
                            {t('selectStudent.subtitle')}
                        </p>
                    </div>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => setShowBulkImport(true)}
                    >
                        <FileZip className="size-4" /> {t('selectStudent.bulkImport')}
                    </MyButton>
                </div>
                <Separator />

                <OfflineBulkImportDialog
                    open={showBulkImport}
                    onOpenChange={setShowBulkImport}
                    assessmentId={assessmentId}
                    instituteId={instituteDetails?.id ?? ''}
                    packageSessionIds={packageSessionIds}
                />

                <Suspense fallback={<DashboardLoader />}>
                    <StudentSelector
                        assessmentId={assessmentId}
                        assessmentType={assessmentVisibility}
                        instituteId={instituteDetails?.id ?? ''}
                        packageSessionIds={packageSessionIds}
                        onSelect={handleStudentSelect}
                    />
                </Suspense>
            </div>
        );
    }

    // Step: COMPLETED
    if (step === 'COMPLETED') {
        return (
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-12 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-2xl text-green-600">
                    &#10003;
                </div>
                <h2 className="text-xl font-bold">{t('completed.title')}</h2>
                <p className="text-sm text-gray-500">
                    {t('completed.summaryPrefix')}
                    {selectedStudent?.name}
                    {t('completed.summarySuffix')}
                </p>
                <div className="flex gap-3">
                    <button
                        onClick={() => {
                            setStep('SELECT_STUDENT');
                            setResponses({});
                            setAttachments({});
                            setSelectedStudent(null);
                            setCurrentQuestionIndex(0);
                        }}
                        className="rounded-md border px-4 py-2 text-sm"
                    >
                        {t('completed.enterAnotherStudent')}
                    </button>
                    <button
                        onClick={() => navigate({ to: '/assessment/assessment-list' })}
                        className="rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white"
                    >
                        {t('completed.backToAssessments')}
                    </button>
                </div>
            </div>
        );
    }

    // Step: ENTER_RESPONSES
    return (
        <div className="flex flex-col gap-4 p-4">
            {/* Top bar: back, student name, view toggle */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleBackToSelection}
                        className="flex items-center gap-1 text-sm text-primary-500 hover:underline"
                    >
                        &larr; {t('responses.back')}
                    </button>
                    <Separator orientation="vertical" className="h-5" />
                    <span className="text-sm font-semibold">{selectedStudent?.name}</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex rounded-md border">
                        <button
                            onClick={() => setViewMode('table')}
                            className={`px-3 py-1 text-xs font-medium ${
                                viewMode === 'table'
                                    ? 'bg-primary-500 text-white'
                                    : 'text-gray-500 hover:bg-gray-50'
                            }`}
                        >
                            {t('responses.viewMode.table')}
                        </button>
                        <button
                            onClick={() => setViewMode('preview')}
                            className={`px-3 py-1 text-xs font-medium ${
                                viewMode === 'preview'
                                    ? 'bg-primary-500 text-white'
                                    : 'text-gray-500 hover:bg-gray-50'
                            }`}
                        >
                            {t('responses.viewMode.preview')}
                        </button>
                    </div>
                </div>
            </div>

            {viewMode === 'table' ? (
                /* Table View */
                <TableViewResponseForm
                    sections={sections}
                    questionsMap={questionsMap}
                    responses={responses}
                    onResponseChange={handleResponseChange}
                    onSubmit={() => setShowSubmitDialog(true)}
                />
            ) : (
                /* Preview View (original) */
                <div className="flex h-full gap-6">
                    <div className="w-64 shrink-0 rounded-lg border bg-white p-4">
                        {/* Scoring Mode Toggle */}
                        <div className="mb-4 flex gap-1">
                            <button
                                onClick={() => setScoringMode('AUTO_CALCULATE')}
                                className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${
                                    scoringMode === 'AUTO_CALCULATE'
                                        ? 'bg-primary-500 text-white'
                                        : 'border text-gray-500 hover:bg-gray-50'
                                }`}
                            >
                                {t('responses.scoringMode.auto')}
                            </button>
                            <button
                                onClick={() => setScoringMode('DIRECT_MARKS')}
                                className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${
                                    scoringMode === 'DIRECT_MARKS'
                                        ? 'bg-primary-500 text-white'
                                        : 'border text-gray-500 hover:bg-gray-50'
                                }`}
                            >
                                {t('responses.scoringMode.directMarks')}
                            </button>
                        </div>

                        <QuestionNavigator
                            sections={sections}
                            questionsMap={questionsMap}
                            currentSectionId={currentSectionId}
                            currentQuestionIndex={currentQuestionIndex}
                            responses={responses}
                            onSelectSection={handleSelectSection}
                            onSelectQuestion={handleSelectQuestion}
                        />
                        <button
                            onClick={() => setShowSubmitDialog(true)}
                            className="mt-6 w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                        >
                            {t('responses.submitAll')}
                        </button>
                    </div>

                    <div className="flex-1 rounded-lg border bg-white p-6">
                        {currentQuestion ? (
                            <QuestionResponseForm
                                question={currentQuestion}
                                questionIndex={currentQuestionIndex}
                                totalQuestions={currentQuestions.length}
                                response={
                                    responses[currentQuestion.question_id] ?? {
                                        selectedOptionIds: [],
                                    }
                                }
                                scoringMode={scoringMode}
                                onResponseChange={handleResponseChange}
                                onPrevious={handlePrevious}
                                onNext={handleNext}
                                onSubmit={() => setShowSubmitDialog(true)}
                            />
                        ) : (
                            <p className="text-sm text-gray-500">
                                {t('responses.noQuestionsInSection')}
                            </p>
                        )}
                    </div>
                </div>
            )}

            <OfflineAttachmentsPanel
                files={attachments}
                onChange={setAttachments}
                disabled={isSubmitting}
                error={submitError}
            />

            <OfflineEntrySubmitDialog
                open={showSubmitDialog}
                onOpenChange={setShowSubmitDialog}
                answeredCount={answeredCount}
                unansweredCount={unansweredCount}
                scoringMode={scoringMode}
                studentName={selectedStudent?.name ?? ''}
                isSubmitting={isSubmitting}
                attachmentNames={Object.values(attachments)
                    .filter((file): file is File => Boolean(file))
                    .map((file) => file.name)}
                onConfirm={handleSubmit}
            />
        </div>
    );
};
