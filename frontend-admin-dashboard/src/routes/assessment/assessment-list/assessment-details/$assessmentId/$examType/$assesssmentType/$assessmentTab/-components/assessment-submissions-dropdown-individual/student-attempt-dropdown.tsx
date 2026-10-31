import { useMemo, useState } from 'react';
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
import { DotsThree, WarningCircle, Info, Coins } from '@phosphor-icons/react';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import { AssessmentRevaluateStudentInterface } from '@/types/assessments/assessment-overview';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { StudentRevaluateQuestionWiseComponent } from './student-revaluate-question-wise-component';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { SelectedFilterRevaluateInterface } from '@/types/assessments/assessment-revaluate-question-wise';
import {
    getAttemptData,
    getReleaseStudentResult,
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
import { SelectedReleaseResultFilterInterface } from '../AssessmentSubmissionsTab';
import { getAssessmentDetails } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import {
    storeEvaluationDataInStorage,
    triggerAIEvaluation,
} from '../../-services/ai-evaluation-services';
import {
    PLATFORM_DEFAULT_MODEL,
    buildModelDisplayNames,
    pickableEvaluationModels,
    toPreferredModel,
} from '@/routes/ai-center/-types/ai-models';
import { useAIModelsList } from '@/hooks/useAiModels';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { stashEvalReturnUrl } from '@/routes/evaluation/evaluation-tool/-utils/eval-return';
import { UploadAnswerSheetDialog } from '@/routes/evaluation/evaluate/$assessmentId/$attemptId/$examType/-components/UploadAnswerSheetDialog';
import { ProctoringReviewDialog } from './ProctoringReviewDialog';
import { StudentAiReportDialog } from './StudentAiReportDialog';

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
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId();

    const provideReattemptMutation = useMutation({
        mutationFn: (registrationId: string) =>
            provideReattemptToParticipants(assessmentId, instituteId, [registrationId]),
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
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="mt-4 font-medium"
                        onClick={handleProvideReattempt}
                        disabled={provideReattemptMutation.isPending}
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

const ReleaseResultComponent = ({
    student,
    onClose,
}: {
    student: AssessmentRevaluateStudentInterface;
    onClose: () => void;
}) => {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId();
    const getReleaseResultMutation = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            methodType,
            selectedFilter,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
            methodType: string;
            selectedFilter: SelectedReleaseResultFilterInterface;
        }) => getReleaseStudentResult(assessmentId, instituteId, methodType, selectedFilter),
        onSuccess: () => {
            toast.success(t('toasts.resultReleased'), {
                className: 'success-toast',
                duration: 4000,
            });
            onClose();
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleReleaseResultStudent = () => {
        getReleaseResultMutation.mutate({
            assessmentId,
            instituteId,
            methodType: 'ENTIRE_ASSESSMENT_PARTICIPANTS',
            selectedFilter: {
                attempt_ids: [student.attempt_id],
            },
        });
    };
    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('dialogs.releaseResult.title')}
            </h1>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center text-danger-600">
                    <p>{t('dialogs.attentionLabel')}</p>
                    <WarningCircle size={18} />
                </div>
                <h1>
                    {t('dialogs.releaseResult.confirmMessagePrefix')}{' '}
                    <span className="text-primary-500">{student.full_name}</span>?
                </h1>
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="mt-4 font-medium"
                        onClick={handleReleaseResultStudent} // Close the dialog when clicked
                    >
                        {t('dialogs.yes')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};

// Confirmation shown before opening the manual evaluation tool for an attempt
// that has already been evaluated. Re-grading resets its status to "Evaluating"
// until new marks are submitted, so warn the teacher first.
const ManualReEvaluateConfirmComponent = ({
    student,
    onConfirm,
    onClose,
}: {
    student: AssessmentRevaluateStudentInterface;
    onConfirm: () => void;
    onClose: () => void;
}) => {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');
    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('dialogs.manualReEvaluate.title')}
            </h1>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center gap-1 text-danger-600">
                    <p>{t('dialogs.attentionLabel')}</p>
                    <WarningCircle size={18} />
                </div>
                <h1>
                    <span className="text-primary-500">{student.full_name}</span>
                    {t('dialogs.manualReEvaluate.messagePart1')}{' '}
                    <span className="font-semibold">
                        {t('dialogs.manualReEvaluate.evaluatingLabel')}
                    </span>{' '}
                    {t('dialogs.manualReEvaluate.messagePart2')}
                </h1>
                <div className="mt-4 flex justify-end gap-2">
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        className="font-medium"
                        onClick={onClose}
                    >
                        {t('dialogs.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="primary"
                        className="font-medium"
                        onClick={onConfirm}
                    >
                        {t('dialogs.continue')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};

const StudentEvaluateWithAIComponent = ({
    student,
    onClose,
    assessmentData,
    isReEvaluation,
}: {
    student: AssessmentRevaluateStudentInterface;
    onClose: () => void;
    assessmentData: any;
    isReEvaluation?: boolean;
}) => {
    const { t } = useTranslation(['assessmentStudentAttemptDropdown', 'aiCenterAiModels']);
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId();
    const navigate = useNavigate();
    // Starts on "Platform default", which sends NO preferred_model, so the
    // super-admin's evaluation use-case default decides. A model is sent only
    // when the teacher picks one: whatever this picker sends overrides the
    // pipeline's own default (an ultra-tier default here once billed one copy
    // 133.62 credits against a 10-credit estimate).
    const [selectedModel, setSelectedModel] = useState<string>(PLATFORM_DEFAULT_MODEL);
    const modelDisplayNames = buildModelDisplayNames(t);
    // Active registry models only; until (or unless) that list loads the
    // static picker list stands, so the choices never disappear.
    const { data: registryModels } = useAIModelsList();
    const pickerModelIds = useMemo(
        () =>
            pickableEvaluationModels(
                registryModels?.models
                    ? new Set(registryModels.models.map((m) => m.model_id))
                    : undefined
            ),
        [registryModels]
    );

    // Credit cost preview for this evaluation (per graded question).
    const numQuestions: number = (assessmentData?.[1]?.saved_data?.sections ?? []).reduce(
        (sum: number, section: any) => sum + (section?.questions?.length || 0),
        0
    );
    const cost = useToolCostPreview('copy_check_evaluation', { num_questions: numQuestions });

    // Trigger AI evaluation mutation
    const triggerEvaluationMutation = useMutation({
        mutationFn: ({
            attempt_ids,
            preferred_model,
        }: {
            attempt_ids: string[];
            preferred_model?: string;
        }) => triggerAIEvaluation(attempt_ids, preferred_model),
        onSuccess: (processIds) => {
            toast.success(t('toasts.evaluationStarted'), {
                className: 'success-toast',
                duration: 4000,
            });

            console.log('sections', assessmentData?.[1]?.saved_data?.sections);
            storeEvaluationDataInStorage({
                processId: processIds[0] ?? '',
                attemptId: student.attempt_id,
                assessmentId: assessmentId,
                sectionIds:
                    assessmentData?.[1]?.saved_data?.sections?.map((section: any) => section.id) ||
                    [],
            });
            onClose();

            // Navigate to the evaluation progress page
            navigate({
                to: '/assessment/evaluation-ai/$attemptId/$processId',
                params: {
                    attemptId: student.attempt_id,
                    processId: processIds[0] ?? '',
                },
            });
        },
        onError: (error: unknown) => {
            console.error('Failed to trigger AI evaluation:', error);
            toast.error(t('toasts.evaluationError'));
        },
    });

    const handleEvaluateWithAIStudent = () => {
        triggerEvaluationMutation.mutate({
            attempt_ids: [student.attempt_id],
            preferred_model: toPreferredModel(selectedModel),
        });
    };

    return (
        <DialogContent className="flex flex-col gap-4 p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('dialogs.evaluateWithAI.title')}
            </h1>
            <div className="flex flex-col gap-4 p-4">
                {isReEvaluation && (
                    <div className="flex items-start gap-2 rounded-md bg-danger-50 p-3 text-danger-600">
                        <WarningCircle size={18} className="mt-0.5 shrink-0" />
                        <p className="text-sm">
                            {t('dialogs.evaluateWithAI.reEvaluationWarningPart1')}{' '}
                            <span className="font-semibold">
                                {t('dialogs.evaluateWithAI.evaluatingLabel')}
                            </span>{' '}
                            {t('dialogs.evaluateWithAI.reEvaluationWarningPart2')}
                        </p>
                    </div>
                )}
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-neutral-700">
                        {t('dialogs.evaluateWithAI.selectModelLabel')}
                    </label>
                    <Select value={selectedModel} onValueChange={setSelectedModel}>
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder={t('dialogs.evaluateWithAI.selectModelPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={PLATFORM_DEFAULT_MODEL}>
                                {t('platformDefault.name', { ns: 'aiCenterAiModels' })} -{' '}
                                {t('platformDefault.description', { ns: 'aiCenterAiModels' })}
                            </SelectItem>
                            {pickerModelIds.map((modelId) => {
                                const info = modelDisplayNames[modelId];
                                return (
                                    <SelectItem key={modelId} value={modelId}>
                                        {info ? `${info.name} - ${info.description}` : modelId}
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-neutral-500">
                        {t('dialogs.evaluateWithAI.chooseModelPrefix')}{' '}
                        <span className="font-semibold text-primary-600">
                            {student.full_name}
                        </span>
                        {t('dialogs.evaluateWithAI.chooseModelSuffix')}
                    </p>
                </div>

                <div className="flex items-start gap-2 rounded-md bg-primary-50 p-3 text-xs text-primary-700">
                    <Info size={16} className="mt-0.5 shrink-0" />
                    <p>{t('dialogs.evaluateWithAI.rubricInfo')}</p>
                </div>

                {numQuestions > 0 && cost.credits != null && (
                    <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 p-3">
                        <div className="flex items-center gap-2 text-sm text-neutral-700">
                            <Coins size={16} className="text-primary-500" />
                            <span>
                                {t('dialogs.evaluateWithAI.estimatedCostLabel')}{' '}
                                <span className="font-semibold text-neutral-900">
                                    {t('dialogs.evaluateWithAI.creditsCount', {
                                        count: cost.credits,
                                    })}
                                </span>
                            </span>
                        </div>
                        {cost.currentBalance != null && (
                            <span className="text-xs text-neutral-500">
                                {t('dialogs.evaluateWithAI.balance', {
                                    count: cost.currentBalance,
                                })}
                            </span>
                        )}
                    </div>
                )}

                {cost.sufficient === false && (
                    <div className="flex items-start gap-2 rounded-md bg-danger-50 p-3 text-xs text-danger-600">
                        <WarningCircle size={16} className="mt-0.5 shrink-0" />
                        <p>{t('dialogs.evaluateWithAI.insufficientCredits')}</p>
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={onClose}
                        disabled={triggerEvaluationMutation.isPending}
                    >
                        {t('dialogs.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        onClick={handleEvaluateWithAIStudent}
                        disabled={triggerEvaluationMutation.isPending || cost.sufficient === false}
                    >
                        {triggerEvaluationMutation.isPending
                            ? t('dialogs.evaluateWithAI.starting')
                            : t('dialogs.evaluateWithAI.start')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
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

const StudentAttemptDropdown = ({ student }: { student: AssessmentRevaluateStudentInterface }) => {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');
    const [openDialog, setOpenDialog] = useState(false);
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [proctoringOpen, setProctoringOpen] = useState(false);
    const [aiReportOpen, setAiReportOpen] = useState(false);
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

    // For manual assessments the menu depends on whether the attempt has a
    // submitted answer sheet and an evaluated copy. Both live behind detail
    // endpoints (not on the table row), so fetch them lazily on menu open.
    const submissionFileQuery = useQuery({
        queryKey: ['GET_ATTEMPT_SUBMISSION_FILE', student.attempt_id],
        queryFn: async () => ((await getAttemptData(student.attempt_id)) as string | null) ?? null,
        enabled: isManualEvaluation && menuOpen,
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
                                    <DropdownMenuItem
                                        className="cursor-pointer"
                                        onClick={() => handleProvideReattempt('Question Wise')}
                                    >
                                        {t('dropdown.questionWise')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="cursor-pointer"
                                        onClick={() => handleProvideReattempt('Entire Assessment')}
                                    >
                                        {t('dropdown.entireAssessment')}
                                    </DropdownMenuItem>
                                </>
                            ) : (
                                /* For MANUAL evaluation: grade by hand in the tool, or with AI */
                                <>
                                    <DropdownMenuItem
                                        className="cursor-pointer"
                                        onClick={() => {
                                            // Already-evaluated attempts get a confirmation
                                            // (re-grading resets status to "Evaluating"); a
                                            // first-time evaluation opens the tool directly.
                                            if (isEvaluationPending) {
                                                handleManualEvaluate();
                                            } else {
                                                handleProvideReattempt('Manual Re-evaluate');
                                            }
                                        }}
                                    >
                                        {t('dropdown.manual')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="cursor-pointer"
                                        onClick={() => handleProvideReattempt('Evaluate with AI')}
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
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleProvideReattempt('Release Result')}
                    >
                        {t('dropdown.releaseResult')}
                    </DropdownMenuItem>
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

            {/* Dialog should be controlled by openDialog state */}
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                {selectedOption === 'Provide Reattempt' && (
                    <ProvideReattemptComponent
                        student={student}
                        onClose={() => setOpenDialog(false)}
                    />
                )}
                {selectedOption === 'Question Wise' && (
                    <StudentRevaluateQuestionWiseComponent
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
                {selectedOption === 'Release Result' && (
                    <ReleaseResultComponent
                        student={student}
                        onClose={() => setOpenDialog(false)}
                    />
                )}
                {selectedOption === 'Evaluate with AI' && (
                    <StudentEvaluateWithAIComponent
                        student={student}
                        onClose={() => setOpenDialog(false)}
                        assessmentData={assessmentData}
                        isReEvaluation={!isEvaluationPending}
                    />
                )}
                {selectedOption === 'Manual Re-evaluate' && (
                    <ManualReEvaluateConfirmComponent
                        student={student}
                        onConfirm={() => {
                            setOpenDialog(false);
                            handleManualEvaluate();
                        }}
                        onClose={() => setOpenDialog(false)}
                    />
                )}
            </Dialog>
        </>
    );
};

export default StudentAttemptDropdown;
