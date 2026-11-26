import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { DotsThree, WarningCircle } from '@phosphor-icons/react';
import { AssessmentRevaluateStudentInterface } from '@/types/assessments/assessment-overview';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { SelectedFilterRevaluateInterface } from '@/types/assessments/assessment-revaluate-question-wise';
import {
    getAttemptData,
    getRevaluateStudentResult,
    handleGetStudentReportExportPDF,
    provideReattemptToParticipants,
    viewStudentReport,
} from '../../-services/assessment-details-services';
import { getPublicUrl } from '@/services/upload_file';
import { downloadFileFromUrl } from '@/lib/file-download';
import { Route } from '../..';
import { getInstituteId } from '@/constants/helper';
import { toast } from 'sonner';
import {
    getAssessmentDetails,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import {
    storeEvaluationDataInStorage,
    triggerAIEvaluation,
} from '../../-services/ai-evaluation-services';
import { stashEvalReturnUrl } from '@/routes/evaluation/evaluation-tool/-utils/eval-return';
import { UploadAnswerSheetDialog } from '@/routes/evaluation/evaluate/$assessmentId/$attemptId/$examType/-components/UploadAnswerSheetDialog';
import { ProctoringReviewDialog } from './ProctoringReviewDialog';
import { StudentAiReportDialog } from './StudentAiReportDialog';
import { useAiGradableQuestionCount } from '../../-utils/ai-gradable-questions';
import { ReCheckWithAIConfirm, useAiCheckCost } from '../submission-review/ai-check-confirm';
import { ReleaseSubmissionDialog } from '../submission-review/ReleaseSubmissionDialog';
import { HideResultDialog, SendUpdateDialog } from '../submission-review/ResultActionDialogs';
import { useAttemptMarking, useOpenSubmission } from '../submission-review/use-attempt-marking';

const isEvaluatedStatus = (status?: string | null) => {
    const s = (status || '').toUpperCase();
    return s === 'COMPLETED' || s === 'AI_EVALUATION_COMPLETED';
};

const ProvideReattemptComponent = ({
    student,
    onClose,
}: {
    student: AssessmentRevaluateStudentInterface;
    onClose: () => void;
}) => {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');
    // The count field shares its copy with the bulk Provide Reattempt dialog.
    const { t: tCount } = useTranslation('assessmentProvideReattemptDialog');
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId();

    // How many extra attempts to grant, as in the bulk dialog (the endpoint takes a count;
    // this row dialog used to send its default of 1).
    const [reattemptCount, setReattemptCount] = useState('1');
    const parsedCount = Number.parseInt(reattemptCount, 10);
    const isCountValid = Number.isFinite(parsedCount) && parsedCount >= 1 && parsedCount <= 20;

    const provideReattemptMutation = useMutation({
        mutationFn: (registrationId: string) =>
            provideReattemptToParticipants(
                assessmentId,
                instituteId,
                [registrationId],
                parsedCount
            ),
        onSuccess: () => {
            toast.success(
                t('toasts.reattemptProvided', { name: student.full_name }),
                {
                    className: 'success-toast',
                    duration: 4000,
                }
            );
            onClose();
        },
        onError: () => {
            toast.error(t('toasts.reattemptError'));
        },
    });

    const handleProvideReattempt = () => {
        if (!isCountValid) return;
        if (!student.registration_id) {
            toast.error(t('toasts.reattemptRegistrationError'));
            return;
        }
        provideReattemptMutation.mutate(student.registration_id);
    };

    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('dialogs.provideReattempt.title')}
            </h1>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center text-danger-600">
                    <p>{t('dialogs.attentionLabel')}</p>
                    <WarningCircle size={18} />
                </div>
                <h1>
                    {t('dialogs.provideReattempt.confirmMessagePrefix')}{' '}
                    <span className="text-primary-500">{student.full_name}</span>?
                </h1>
                <MyInput
                    inputType="number"
                    inputPlaceholder={tCount('inputPlaceholder')}
                    input={reattemptCount}
                    onChangeFunction={(e) => setReattemptCount(e.target.value)}
                    label={tCount('inputLabel')}
                    required={true}
                    error={isCountValid ? undefined : tCount('inputError')}
                    size="large"
                    className="w-full"
                />
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="mt-4 font-medium"
                        onClick={handleProvideReattempt}
                        disabled={provideReattemptMutation.isPending || !isCountValid}
                    >
                        {provideReattemptMutation.isPending
                            ? t('dialogs.provideReattempt.providing')
                            : t('dialogs.yes')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};

/**
 * Starts the AI check on one attempt and opens its progress page. No model is
 * sent, so the platform's "evaluation" default decides; teachers do not pick one.
 * Works for an uploaded copy and for typed online answers alike. A refusal (a
 * released result is a 409, a paper with no questions) toasts the server's reason.
 */
const useStartAiCheck = (student: AssessmentRevaluateStudentInterface, assessmentData: any) => {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');
    const { assessmentId } = Route.useParams();
    const navigate = useNavigate();
    const toastId = `ai-check-${student.attempt_id}`;

    return useMutation({
        mutationFn: () => triggerAIEvaluation([student.attempt_id]),
        onMutate: () => {
            toast.loading(t('dialogs.evaluateWithAI.starting'), { id: toastId });
        },
        onSuccess: (processIds) => {
            // The server skips an attempt it cannot queue and returns no process for it.
            const processId = processIds[0];
            if (!processId) {
                toast.error(t('toasts.evaluationError'), { id: toastId });
                return;
            }
            toast.success(t('toasts.evaluationStarted'), {
                id: toastId,
                className: 'success-toast',
                duration: 4000,
            });
            storeEvaluationDataInStorage({
                processId,
                attemptId: student.attempt_id,
                assessmentId,
                sectionIds:
                    assessmentData?.[1]?.saved_data?.sections?.map((section: any) => section.id) ||
                    [],
            });
            navigate({
                to: '/assessment/evaluation-ai/$attemptId/$processId',
                params: { attemptId: student.attempt_id, processId },
            });
        },
        onError: (error: unknown) => {
            console.error('Failed to trigger AI evaluation:', error);
            const response = (
                error as {
                    response?: { status?: number; data?: { ex?: string; message?: string } };
                }
            )?.response;
            const serverReason = response?.data?.ex || response?.data?.message;
            // 409: the result is already released; the server says to edit marks by hand.
            const fallback =
                response?.status === 409
                    ? t('toasts.alreadyReleased')
                    : t('toasts.evaluationError');
            toast.error(serverReason || fallback, { id: toastId });
        },
    });
};

const StudentRevaluateForEntireAssessmentComponent = ({
    student,
    onClose,
}: {
    student: AssessmentRevaluateStudentInterface;
    onClose: () => void;
}) => {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId();
    const [selectedFilter] = useState<SelectedFilterRevaluateInterface>({
        questions: [
            {
                section_id: '',
                question_ids: [],
            },
        ],
        attempt_ids: [],
    });
    const getRevaluateResultMutation = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            methodType,
            selectedFilter,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
            methodType: string;
            selectedFilter: SelectedFilterRevaluateInterface;
        }) => getRevaluateStudentResult(assessmentId, instituteId, methodType, selectedFilter),
        onSuccess: () => {
            toast.success(t('toasts.revaluateSuccess'), {
                className: 'success-toast',
                duration: 4000,
            });
            onClose();
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleRevaluateStudent = () => {
        getRevaluateResultMutation.mutate({
            assessmentId,
            instituteId,
            methodType: 'ENTIRE_ASSESSMENT_PARTICIPANTS',
            selectedFilter: {
                ...selectedFilter,
                questions: [
                    {
                        section_id: '',
                        question_ids: [],
                    },
                ],
                attempt_ids: [student.attempt_id],
            },
        });
    };
    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('dialogs.revaluateEntireAssessment.title')}
            </h1>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center text-danger-600">
                    <p>{t('dialogs.attentionLabel')}</p>
                    <WarningCircle size={18} />
                </div>
                <h1>
                    {t('dialogs.revaluateEntireAssessment.confirmMessagePrefix')}{' '}
                    <span className="text-primary-500">{student.full_name}</span>{' '}
                    {t('dialogs.revaluateEntireAssessment.confirmMessageSuffix')}
                </h1>
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="mt-4 font-medium"
                        onClick={handleRevaluateStudent}
                    >
                        {t('dialogs.yes')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};

const StudentAttemptDropdown = ({
    student,
    getPageAttemptIds,
}: {
    student: AssessmentRevaluateStudentInterface;
    /** The table page's attempt ids (as OpenCell passes), for Prev / Next on the Submission page. */
    getPageAttemptIds?: () => string[];
}) => {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');
    const [openDialog, setOpenDialog] = useState(false);
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [proctoringOpen, setProctoringOpen] = useState(false);
    const [aiReportOpen, setAiReportOpen] = useState(false);
    const [releaseOpen, setReleaseOpen] = useState(false);
    const [sendUpdateOpen, setSendUpdateOpen] = useState(false);
    const [hideOpen, setHideOpen] = useState(false);
    const { assessmentId, examType } = Route.useParams();
    const instituteId = getInstituteId();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Open the manual PDF evaluation tool for this attempt (same flow as the
    // assessment-slide "Evaluate" deep-link); return here after submitting.
    const handleManualEvaluate = () => {
        stashEvalReturnUrl(window.location.href);
        navigate({
            to: '/evaluation/evaluate/$assessmentId/$attemptId/$examType',
            params: {
                assessmentId,
                attemptId: student.attempt_id,
                examType: examType || 'EXAM',
            },
        });
    };

    // Fetch assessment details to get evaluation_type
    const { data: assessmentData } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteId,
            type: 'EXAM', // You may need to get this from route params if needed
        })
    );

    const handleProvideReattempt = (value: string) => {
        setOpenDialog(true);
        setSelectedOption(value);
    };

    const startAiCheck = useStartAiCheck(student, assessmentData);

    // Fetch the report detail for this attempt, resolve the evaluated copy's
    // public URL and open it. The evaluated_file_id lives on the report detail,
    // not on the table row, so it is fetched on demand.
    const viewEvaluatedMutation = useMutation({
        mutationFn: async () => {
            const report = await viewStudentReport(assessmentId, student.attempt_id, instituteId);
            const fileId = (report as { evaluated_file_id?: string | null } | undefined)
                ?.evaluated_file_id;
            if (!fileId) return null;
            return getPublicUrl(fileId);
        },
        onSuccess: (url) => {
            if (url) {
                // Download with a correct, `.pdf`-carrying name. The public URL's
                // basename is derived from the original upload name, which for
                // quick-evaluated copies can lack an extension — so we resolve
                // the real extension from the file itself before saving.
                void downloadFileFromUrl(url, `Evaluated-Copy-${student.full_name}`);
            } else {
                toast.error(t('toasts.noEvaluatedCopy'));
            }
        },
        onError: (error: unknown) => {
            console.error('Failed to load evaluated copy:', error);
            toast.error(t('toasts.evaluatedCopyLoadError'));
        },
    });

    const handleViewEvaluated = () => {
        if (viewEvaluatedMutation.isPending) return;
        viewEvaluatedMutation.mutate();
    };

    // Open the learner's actual submitted answer file. The attempt's uploaded
    // file id comes from getAttemptData; if there is no uploaded file (e.g. an
    // objective attempt) fall back to the generated submission report PDF.
    const viewSubmissionMutation = useMutation({
        mutationFn: async () => {
            const fileId = await getAttemptData(student.attempt_id);
            if (fileId) {
                const url = await getPublicUrl(fileId as string);
                return { type: 'url' as const, value: url };
            }
            const pdfBlob = await handleGetStudentReportExportPDF(
                assessmentId,
                instituteId,
                student.attempt_id
            );
            return { type: 'blob' as const, value: pdfBlob };
        },
        onSuccess: (result) => {
            const fileUrl =
                result.type === 'blob' ? window.URL.createObjectURL(result.value) : result.value;
            if (!fileUrl) {
                toast.error(t('toasts.noSubmissionFile'));
                return;
            }
            const submissionTab = window.open(fileUrl, '_blank');
            if (!submissionTab) {
                toast.error(t('toasts.popupBlocked'));
            }
            // Revoke object URLs after a delay so the new tab can load the blob.
            if (result.type === 'blob') {
                setTimeout(() => window.URL.revokeObjectURL(fileUrl), 60000);
            }
        },
        onError: (error: unknown) => {
            console.error('Failed to load submission:', error);
            toast.error(t('toasts.submissionLoadError'));
        },
    });

    const handleViewSubmission = () => {
        if (viewSubmissionMutation.isPending) return;
        viewSubmissionMutation.mutate();
    };
    const downloadReportMutation = useMutation({
        mutationFn: async () => {
            // A report uploaded by an admin (offline data entry) is the
            // authoritative one for that attempt — a generated report can't
            // reflect how the paper was actually marked on hand-checked exams.
            // A lookup failure is non-fatal: fall through to generation.
            try {
                // Goes through the query cache under the same key the menu
                // already uses, so this costs no extra request when the report
                // detail has been fetched — "Download Report" stays as fast as
                // it was for every attempt that has no uploaded report.
                const report = await queryClient.fetchQuery({
                    queryKey: ['GET_STUDENT_REPORT_DETAIL', assessmentId, student.attempt_id],
                    queryFn: () => viewStudentReport(assessmentId, student.attempt_id, instituteId),
                    staleTime: 5 * 60 * 1000,
                });
                const uploadedReportId = (
                    report as { report_file_id?: string | null } | undefined
                )?.report_file_id;
                if (uploadedReportId) {
                    const url = await getPublicUrl(uploadedReportId);
                    if (url) return { type: 'url' as const, value: url };
                }
            } catch (error) {
                console.error('Could not check for an uploaded report:', error);
            }

            const blob = await handleGetStudentReportExportPDF(
                assessmentId,
                instituteId,
                student.attempt_id
            );
            if (!blob) throw new Error('Empty report response');
            return { type: 'blob' as const, value: blob as Blob };
        },
        onSuccess: async (result) => {
            const safeName = (student.full_name || 'student').replace(/[^\w.-]+/g, '_');
            if (result.type === 'url') {
                await downloadFileFromUrl(result.value, `Report_${safeName}`);
                setMenuOpen(false);
                return;
            }
            const objectUrl = window.URL.createObjectURL(result.value);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.setAttribute('download', `Report_${safeName}.pdf`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(objectUrl);
            setMenuOpen(false);
        },
        onError: (error: unknown) => {
            console.error('Failed to generate student report:', error);
            toast.error(t('toasts.reportGenerateError'));
        },
    });

    const handleDownloadReport = () => {
        if (downloadReportMutation.isPending) return;
        downloadReportMutation.mutate();
    };

    // Get evaluation_type from saved_data
    const evaluationType = assessmentData?.[0]?.saved_data?.evaluation_type;
    const isManualEvaluation = evaluationType === 'MANUAL';

    // Get evaluation_status from student data
    const evaluationStatus = student?.evaluation_status;
    const isEvaluationPending = evaluationStatus === 'PENDING';
    const isEvaluated = isEvaluatedStatus(evaluationStatus);

    // An online (non-MANUAL) test whose paper has questions the AI marks (CBE, long
    // answer): its typed answers can be sent to the AI from this row. Owner decision
    // 2026-11-18: an attempt held for marking must always have a way to be marked.
    // One shared request for the whole table; MCQ-only tests never show the item.
    const aiGradableQuestionCount = useAiGradableQuestionCount({
        assessmentId,
        instituteId,
        enabled: !isManualEvaluation,
    });
    // A released result is frozen against AI writes (the server answers 409), so the
    // item is not offered there. result_status is the row's report release status.
    // Marking/Result for this row (seeded for the whole page by the tab): the release token
    // and whether the result is out. Falls back to the row's own release status.
    const { data: marking } = useAttemptMarking(assessmentId, student.attempt_id);
    const openSubmission = useOpenSubmission();
    const isResultReleased = marking
        ? marking.result !== 'NOT_RELEASED'
        : (student as { result_status?: string | null }).result_status === 'RELEASED';
    const canAiCheckTypedAnswers =
        !isManualEvaluation && !isResultReleased && (aiGradableQuestionCount ?? 0) > 0;

    const aiCheckCost = useAiCheckCost(
        (isManualEvaluation || canAiCheckTypedAnswers) && (menuOpen || openDialog),
        canAiCheckTypedAnswers ? aiGradableQuestionCount : undefined
    );

    // A pending copy starts in one click. Anything else asks first, whichever menu label it
    // sits under ("Revaluate"): a teacher's half-marked copy is EVALUATING, not COMPLETED.
    // Typed answers always ask first, with the price: the run marks every written answer
    // and may be on a test whose institute never turned AI evaluation on.
    const handleCheckWithAi = () => {
        if (!isEvaluationPending || !isManualEvaluation) {
            handleProvideReattempt('Evaluate with AI');
            return;
        }
        if (aiCheckCost.sufficient === false) {
            toast.error(t('dialogs.evaluateWithAI.insufficientCredits'));
            return;
        }
        startAiCheck.mutate();
    };

    // For manual assessments the menu depends on whether the attempt has a
    // submitted answer sheet and an evaluated copy. Both live behind detail
    // endpoints (not on the table row), so fetch them lazily on menu open.
    const submissionFileQuery = useQuery({
        queryKey: ['GET_ATTEMPT_SUBMISSION_FILE', student.attempt_id],
        queryFn: async () => ((await getAttemptData(student.attempt_id)) as string | null) ?? null,
        // Online tests too: offline entry / an admin upload can attach a sheet there,
        // and "View Answer Sheet" below must keep opening it.
        enabled: menuOpen,
        staleTime: 5 * 60 * 1000,
    });
    const reportDetailQuery = useQuery({
        queryKey: ['GET_STUDENT_REPORT_DETAIL', assessmentId, student.attempt_id],
        queryFn: () => viewStudentReport(assessmentId, student.attempt_id, instituteId),
        enabled: isManualEvaluation && menuOpen && !isEvaluationPending,
        staleTime: 5 * 60 * 1000,
    });
    const hasSubmissionFile = !!submissionFileQuery.data;
    const hasEvaluatedCopy = !!(
        reportDetailQuery.data as { evaluated_file_id?: string | null } | undefined
    )?.evaluated_file_id;

    // After an admin uploads the answer sheet on the student's behalf, flip the
    // cached file id (so the menu now shows "View Submission") and open the file.
    const handleAnswerSheetUploaded = async (fileId: string) => {
        queryClient.setQueryData(['GET_ATTEMPT_SUBMISSION_FILE', student.attempt_id], fileId);
        const url = await getPublicUrl(fileId);
        if (url) window.open(url, '_blank');
    };

    return (
        <>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="w-6 !min-w-6"
                    >
                        <DotsThree />
                    </MyButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    {/* The Submission page. On an online test this is "View Submission" (the
                        answers on screen, marks to edit); on a manual test "View Submission"
                        below opens the learner's uploaded sheet, so the page is "Open submission". */}
                    <DropdownMenuItem
                        className="cursor-pointer font-semibold"
                        onClick={() =>
                            // Same list as the row's Open button: Prev / Next walk this page.
                            // Without a page list, only this attempt, so an older list is not walked.
                            openSubmission(student.attempt_id, {
                                assessmentId,
                                attemptIds: getPageAttemptIds?.() ?? [student.attempt_id],
                                source: 'list',
                            })
                        }
                    >
                        {isManualEvaluation ? t('dropdown.openSubmission') : t('dropdown.viewSubmission')}
                    </DropdownMenuItem>
                    {/* Manual attempts may have no uploaded answer sheet — offer
                        the admin an upload instead of a dead "View Submission". */}
                    {isManualEvaluation ? (
                        submissionFileQuery.isLoading ? (
                            <DropdownMenuItem disabled>
                                {t('dropdown.checkingSubmission')}
                            </DropdownMenuItem>
                        ) : hasSubmissionFile ? (
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onSelect={(e) => {
                                    e.preventDefault();
                                    handleViewSubmission();
                                }}
                            >
                                {viewSubmissionMutation.isPending
                                    ? t('dropdown.loadingSubmission')
                                    : t('dropdown.viewSubmission')}
                            </DropdownMenuItem>
                        ) : (
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() => setUploadDialogOpen(true)}
                            >
                                {t('dropdown.uploadSubmission')}
                            </DropdownMenuItem>
                        )
                    ) : (
                        /* A sheet attached to an online attempt (offline entry, admin
                           upload) opens exactly as "View Submission" used to open it. */
                        hasSubmissionFile && (
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onSelect={(e) => {
                                    e.preventDefault();
                                    handleViewSubmission();
                                }}
                            >
                                {viewSubmissionMutation.isPending
                                    ? t('dropdown.loadingSubmission')
                                    : t('dropdown.viewAnswerSheet')}
                            </DropdownMenuItem>
                        )
                    )}
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleProvideReattempt('Provide Reattempt')}
                    >
                        {t('dropdown.provideReattempt')}
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="cursor-pointer">
                            {isEvaluationPending ? t('dropdown.evaluate') : t('dropdown.revaluate')}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            {!isManualEvaluation ? (
                                <>
                                    {/* "Question Wise" is retired (spec §14): it re-scored a
                                        question over AI and teacher marks. Per-question
                                        re-marks live on the Submission page now. */}
                                    <DropdownMenuItem
                                        className="cursor-pointer"
                                        onClick={() => handleProvideReattempt('Entire Assessment')}
                                    >
                                        {t('dropdown.remarkWithKey')}
                                    </DropdownMenuItem>
                                    {canAiCheckTypedAnswers && (
                                        <DropdownMenuItem
                                            className="cursor-pointer"
                                            disabled={
                                                startAiCheck.isPending || aiCheckCost.isLoading
                                            }
                                            onClick={handleCheckWithAi}
                                        >
                                            {t('dropdown.evaluateWithAI')}
                                        </DropdownMenuItem>
                                    )}
                                </>
                            ) : (
                                /* For MANUAL evaluation: grade by hand in the tool, or with AI */
                                <>
                                    <DropdownMenuItem
                                        className="cursor-pointer"
                                        // Opens the tool directly, evaluated or not: the
                                        // backend never moves an evaluated attempt back
                                        // to Evaluating just for opening it.
                                        onClick={handleManualEvaluate}
                                    >
                                        {t('dropdown.markOnSheet')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="cursor-pointer"
                                        disabled={startAiCheck.isPending || aiCheckCost.isLoading}
                                        onClick={handleCheckWithAi}
                                    >
                                        {t('dropdown.evaluateWithAI')}
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {isManualEvaluation &&
                        !isEvaluationPending &&
                        (reportDetailQuery.isLoading ? (
                            <DropdownMenuItem disabled>
                                {t('dropdown.checkingEvaluatedCopy')}
                            </DropdownMenuItem>
                        ) : (
                            hasEvaluatedCopy && (
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    onSelect={(e) => {
                                        e.preventDefault();
                                        handleViewEvaluated();
                                    }}
                                >
                                    {viewEvaluatedMutation.isPending
                                        ? t('dropdown.loadingEvaluatedCopy')
                                        : t('dropdown.viewEvaluatedCopy')}
                                </DropdownMenuItem>
                            )
                        ))}
                    {/* Only evaluated attempts have marks, so only they have a
                        report worth rendering. */}
                    {isEvaluated && (
                        <DropdownMenuItem
                            className="cursor-pointer"
                            disabled={downloadReportMutation.isPending}
                            onSelect={(e) => {
                                // Keep the menu open while the PDF is generated so
                                // the pending label stays visible.
                                e.preventDefault();
                                handleDownloadReport();
                            }}
                        >
                            {downloadReportMutation.isPending
                                ? t('dropdown.generatingReport')
                                : t('dropdown.downloadReport')}
                        </DropdownMenuItem>
                    )}
                    {/* The student's AI report (what the learner sees). Download Report
                        above already returns it once it exists; this also lets the
                        admin generate it, with a credit warning first. */}
                    {isEvaluated && !isManualEvaluation && (
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={() => setAiReportOpen(true)}
                        >
                            {t('dropdown.downloadAiReport')}
                        </DropdownMenuItem>
                    )}
                    {isResultReleased ? (
                        <>
                            {/* Only when marks changed since the learner was last told. */}
                            {marking?.result === 'RELEASED_CHANGED' && (
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    onClick={() => setSendUpdateOpen(true)}
                                >
                                    {t('dropdown.sendUpdatedResult')}
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() => setHideOpen(true)}
                            >
                                {t('dropdown.hideResultAgain')}
                            </DropdownMenuItem>
                        </>
                    ) : (
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={() => setReleaseOpen(true)}
                        >
                            {t('dropdown.releaseResult')}
                        </DropdownMenuItem>
                    )}
                    {/* Always offered: an unproctored attempt simply shows an
                        empty log, and the reviewer learns that at a glance. */}
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => setProctoringOpen(true)}
                    >
                        {t('dropdown.proctoring')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Admin-side answer sheet upload for manual attempts that have no
                submission file. Lives outside the dropdown so it survives the
                menu closing. */}
            <UploadAnswerSheetDialog
                attemptId={student.attempt_id}
                instituteId={instituteId}
                open={uploadDialogOpen}
                onOpenChange={setUploadDialogOpen}
                onUploaded={handleAnswerSheetUploaded}
            />

            <StudentAiReportDialog
                open={aiReportOpen}
                onOpenChange={setAiReportOpen}
                assessmentId={assessmentId}
                attemptId={student.attempt_id}
                instituteId={instituteId}
                studentName={student.full_name}
            />
            <ProctoringReviewDialog
                attemptId={student.attempt_id}
                studentName={student.full_name}
                open={proctoringOpen}
                onOpenChange={setProctoringOpen}
            />

            {/* Release / Send updated result / Hide result again (W1 row menu, W9 rules). */}
            <ReleaseSubmissionDialog
                attemptId={student.attempt_id}
                assessmentId={assessmentId}
                learnerName={student.full_name}
                releaseToken={marking?.release_token}
                aiDrafts={marking?.counts.ai_draft ?? 0}
                open={releaseOpen}
                onOpenChange={setReleaseOpen}
            />
            <SendUpdateDialog
                attemptId={student.attempt_id}
                assessmentId={assessmentId}
                learnerName={student.full_name}
                open={sendUpdateOpen}
                onOpenChange={setSendUpdateOpen}
            />
            <HideResultDialog
                attemptId={student.attempt_id}
                assessmentId={assessmentId}
                learnerName={student.full_name}
                open={hideOpen}
                onOpenChange={setHideOpen}
            />

            {/* Dialog should be controlled by openDialog state */}
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                {selectedOption === 'Provide Reattempt' && (
                    <ProvideReattemptComponent
                        student={student}
                        onClose={() => setOpenDialog(false)}
                    />
                )}
                {selectedOption === 'Entire Assessment' && (
                    <StudentRevaluateForEntireAssessmentComponent
                        student={student}
                        onClose={() => setOpenDialog(false)}
                    />
                )}
                {selectedOption === 'Evaluate with AI' && (
                    <ReCheckWithAIConfirm
                        student={student}
                        cost={aiCheckCost}
                        isStarting={startAiCheck.isPending}
                        typedAnswers={!isManualEvaluation}
                        firstCheck={isEvaluationPending}
                        onConfirm={() =>
                            startAiCheck.mutate(undefined, {
                                onSettled: () => setOpenDialog(false),
                            })
                        }
                        onClose={() => setOpenDialog(false)}
                    />
                )}
            </Dialog>
        </>
    );
};

export default StudentAttemptDropdown;
