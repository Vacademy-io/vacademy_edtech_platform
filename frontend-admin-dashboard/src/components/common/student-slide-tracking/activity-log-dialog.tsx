// activity-log-dialog.tsx
import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import {
    ACTIVITY_LOG_COLUMN_WIDTHS,
    ACTIVITY_RESPONSE_COLUMN_WIDTHS,
} from '@/components/design-system/utils/constants/table-layout';
import { usePaginationState } from '@/hooks/pagination';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    activityLogColumns,
    activityResponseTypeColumns,
} from '@/components/design-system/utils/constants/table-column-data';
import { useActivityStatsStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/activity-stats-store';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    getUserVideoSlideActivityLogs,
    getUserDocActivityLogs,
    getQuestionSlideActivityLogs,
    getAssignmentSlideActivityLogs,
    getQuizSlideActivityLogs,
    getSlideByIdQuery,
    saveQuizQuestionFeedback,
    getUserVideoResponseSlideActivityLogs,
    gradeAssignmentSubmission,
} from '@/services/study-library/slide-operations/user-slide-activity-logs';
import { ActivityContent } from '@/types/study-library/user-slide-activity-response-type';
import { StudentTable } from '@/types/student-table-types';
import { SlideWithStatusType } from '@/routes/manage-students/students-list/-types/student-slides-progress-type';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { convertToLocalDateTime, extractDateTime } from '@/constants/helper';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getPublicUrl, UploadFileInS3 } from '@/services/upload_file';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { DownloadSimple, Eye, File, FilePdf, Spinner, UploadSimple, X as XIcon, ClipboardText, CheckCircle, Clock as ClockIcon } from '@phosphor-icons/react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import SimplePDFViewer from '@/components/common/simple-pdf-viewer';
import { downloadAllAssignmentSubmissions } from '@/services/study-library/slide-operations/download-assignment-submissions';
import { useRouter } from '@tanstack/react-router';
import AssessmentAttemptActivity from './assessment-attempt-activity';
import DocumentInteractionsPanel from './document-interactions-panel';
import AiInsightsPanel from './ai-insights-panel';
import { AssignmentAiEvaluator } from './assignment-ai-evaluator';
import type { AssignmentAiEvaluation } from '@/services/study-library/slide-operations/assignment-ai-evaluation';
import { getInstituteId } from '@/constants/helper';

interface AssignmentFileInfo {
    fileId: string;
    url: string;
    isPdf: boolean;
}

interface AssignmentRowData {
    uploadDate: string;
    uploadTime: string;
    files: AssignmentFileInfo[];
    rawFileIds: string;
    trackedId: string;
    marks: number | null;
    feedback: string | null;
    checkedFileId: string | null;
    lateSubmission: boolean;
}

const FileCell = ({ files }: { files: AssignmentFileInfo[] }) => {
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

    if (!files || files.length === 0) {
        return <span className="text-neutral-400">No files</span>;
    }

    return (
        <>
            <div className="flex flex-wrap gap-2">
                {files.map((file, idx) => (
                    <div
                        key={file.fileId}
                        className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1"
                    >
                        {file.isPdf ? (
                            <FilePdf size={16} className="shrink-0 text-red-500" />
                        ) : (
                            <File size={16} className="shrink-0 text-primary-500" />
                        )}
                        <span className="max-w-[120px] truncate text-xs text-neutral-700">
                            File {idx + 1}
                        </span>
                        {file.isPdf && file.url && (
                            <button
                                onClick={() => setPdfPreviewUrl(file.url)}
                                className="rounded p-0.5 hover:bg-primary-100"
                                title="Preview PDF"
                            >
                                <Eye size={14} className="text-primary-500" />
                            </button>
                        )}
                        {file.url && (
                            <a
                                href={file.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded p-0.5 hover:bg-primary-100"
                                title="Download file"
                            >
                                <DownloadSimple size={14} className="text-primary-500" />
                            </a>
                        )}
                    </div>
                ))}
            </div>

            {/* PDF Preview Dialog */}
            <Dialog open={!!pdfPreviewUrl} onOpenChange={() => setPdfPreviewUrl(null)}>
                <DialogContent className="flex h-[85vh] w-[80vw] max-w-[80vw] flex-col gap-0 p-0">
                    <div className="flex items-center justify-between rounded-t-lg bg-primary-50 px-4 py-3">
                        <h2 className="font-semibold text-primary-500">PDF Preview</h2>
                    </div>
                    <div className="flex-1 overflow-hidden">
                        {pdfPreviewUrl && <SimplePDFViewer pdfUrl={pdfPreviewUrl} />}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};

const SubmissionCard = ({
    row,
    onGradeSaved,
}: {
    row: AssignmentRowData;
    onGradeSaved: () => void;
}) => {
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
    const [marks, setMarks] = useState<string>(row.marks != null ? String(row.marks) : '');
    const [feedback, setFeedback] = useState<string>(row.feedback || '');
    const [checkedFileId, setCheckedFileId] = useState<string | null>(row.checkedFileId);
    const [isUploading, setIsUploading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [savedFlash, setSavedFlash] = useState(false);
    // The form holds an AI suggestion the teacher has not saved yet.
    const [aiFilled, setAiFilled] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // marks=0 is set by default at student submission time, so the teacher has
    // only actually graded if any of: positive marks, feedback, or checked copy.
    const isGraded =
        (row.marks != null && row.marks > 0) || !!row.feedback || !!row.checkedFileId;

    const handleUploadCheckedFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        try {
            const token = getTokenFromCookie(TokenKey.accessToken);
            const userId = getTokenDecodedData(token)?.sub || '';
            const fileId = await UploadFileInS3(
                file,
                () => {},
                userId,
                'CHECKED_ASSIGNMENT',
                'TEACHER',
                true
            );
            if (fileId) setCheckedFileId(fileId);
        } catch (err) {
            console.error('Failed to upload checked file:', err);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // AI Evaluator result -> grade form. A suggestion only: nothing is saved until Save Grade.
    const handleApplyAiEvaluation = useCallback((evaluation: AssignmentAiEvaluation) => {
        if (evaluation.marks_awarded != null) setMarks(String(evaluation.marks_awarded));
        if (evaluation.feedback) setFeedback(evaluation.feedback);
        if (evaluation.evaluated_file_id) setCheckedFileId(evaluation.evaluated_file_id);
        setAiFilled(true);
    }, []);

    const handleViewCheckedFile = async () => {
        if (!checkedFileId) return;
        const url = await getPublicUrl(checkedFileId);
        if (url) window.open(url, '_blank');
    };

    const handleSave = async () => {
        if (!row.trackedId || marks === '') return;
        setIsSaving(true);
        try {
            await gradeAssignmentSubmission({
                tracked_id: row.trackedId,
                marks: Number(marks),
                feedback: feedback || undefined,
                checked_file_id: checkedFileId || undefined,
            });
            setSavedFlash(true);
            setAiFilled(false);
            onGradeSaved();
            setTimeout(() => setSavedFlash(false), 2000);
        } catch (err) {
            console.error('Failed to grade:', err);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <>
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                <div className="grid grid-cols-1 lg:grid-cols-2">
                    {/* Left — Submission Info */}
                    <div className="flex flex-col gap-3 border-b border-neutral-200 p-5 lg:border-b-0 lg:border-r">
                        {/* Date + status */}
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-col">
                                <span className="text-sm font-semibold text-neutral-800">
                                    {row.uploadDate}
                                </span>
                                <span className="text-xs text-neutral-500">{row.uploadTime}</span>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                                {row.lateSubmission && (
                                    <span
                                        className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700"
                                        title="Submitted after the assignment's end date"
                                    >
                                        Late
                                    </span>
                                )}
                                {isGraded ? (
                                    <>
                                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                                            {row.marks} marks
                                        </span>
                                        {row.checkedFileId && (
                                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                                                ✓ Checked
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                                        Pending Review
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Submitted Files */}
                        <div className="flex flex-col gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                                Submitted Files ({row.files.length})
                            </span>
                            {row.files.length === 0 ? (
                                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-200 bg-neutral-50 py-6 text-neutral-400">
                                    <File size={28} />
                                    <span className="text-xs">No files submitted</span>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {row.files.map((file, idx) => (
                                        <div
                                            key={file.fileId}
                                            className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2.5 transition-colors hover:border-neutral-300"
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div
                                                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                                                        file.isPdf ? 'bg-red-50' : 'bg-neutral-100'
                                                    }`}
                                                >
                                                    {file.isPdf ? (
                                                        <FilePdf size={18} className="text-red-500" />
                                                    ) : (
                                                        <File
                                                            size={18}
                                                            className="text-neutral-500"
                                                        />
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium text-neutral-800">
                                                        File {idx + 1}
                                                    </p>
                                                    <p className="text-[11px] text-neutral-500">
                                                        {file.isPdf ? 'PDF Document' : 'Document'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1">
                                                {file.isPdf && file.url && (
                                                    <button
                                                        onClick={() => setPdfPreviewUrl(file.url)}
                                                        className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
                                                        title="Preview"
                                                    >
                                                        <Eye size={13} className="inline" /> View
                                                    </button>
                                                )}
                                                {file.url && (
                                                    <a
                                                        href={file.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
                                                        title="Download"
                                                    >
                                                        <DownloadSimple
                                                            size={13}
                                                            className="inline"
                                                        />{' '}
                                                        Download
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Saved feedback preview */}
                        {isGraded && row.feedback && (
                            <div className="rounded-md bg-neutral-50 px-3 py-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                                    Saved Feedback
                                </p>
                                <p className="mt-0.5 text-xs text-neutral-700 line-clamp-3">
                                    {row.feedback}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Right — Inline Grade Form */}
                    <div className="flex flex-col gap-3 bg-neutral-50/50 p-5">
                        <div className="flex items-center gap-2">
                            <ClipboardText size={14} className="text-emerald-600" weight="bold" />
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-700">
                                {isGraded ? 'Edit Grade' : 'Grade Submission'}
                            </span>
                        </div>

                        {/* AI Evaluator */}
                        {row.trackedId && (
                            <AssignmentAiEvaluator
                                trackedId={row.trackedId}
                                hasFiles={row.files.length > 0}
                                onApply={handleApplyAiEvaluation}
                            />
                        )}

                        {/* Marks */}
                        <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-medium text-neutral-600">
                                Marks <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="number"
                                value={marks}
                                onChange={(e) => setMarks(e.target.value)}
                                placeholder="Enter marks"
                                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                                min={0}
                            />
                        </div>

                        {/* Feedback */}
                        <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-medium text-neutral-600">
                                Feedback{' '}
                                <span className="font-normal text-neutral-400">(optional)</span>
                            </label>
                            <textarea
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                                placeholder="Write feedback for the student..."
                                rows={2}
                                className="w-full resize-none rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            />
                        </div>

                        {/* Checked Copy */}
                        <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-medium text-neutral-600">
                                Checked Answer Copy{' '}
                                <span className="font-normal text-neutral-400">(optional)</span>
                            </label>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                                onChange={handleUploadCheckedFile}
                                className="hidden"
                            />
                            {checkedFileId ? (
                                <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <FilePdf size={14} className="shrink-0 text-emerald-600" />
                                        <span className="truncate text-xs font-medium text-emerald-700">
                                            Checked copy uploaded
                                        </span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-0.5">
                                        <button
                                            onClick={handleViewCheckedFile}
                                            className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
                                            title="View"
                                        >
                                            <Eye size={12} />
                                        </button>
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={isUploading}
                                            className="rounded p-1 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                            title="Replace"
                                        >
                                            {isUploading ? (
                                                <Spinner size={12} className="animate-spin" />
                                            ) : (
                                                <UploadSimple size={12} />
                                            )}
                                        </button>
                                        <button
                                            onClick={() => setCheckedFileId(null)}
                                            className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
                                            title="Remove"
                                        >
                                            <XIcon size={12} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading}
                                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-neutral-300 bg-white px-2 py-2 text-xs font-medium text-neutral-600 transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
                                >
                                    {isUploading ? (
                                        <>
                                            <Spinner size={12} className="animate-spin" />
                                            Uploading...
                                        </>
                                    ) : (
                                        <>
                                            <UploadSimple size={12} />
                                            Upload Checked Copy
                                        </>
                                    )}
                                </button>
                            )}
                        </div>

                        {aiFilled && (
                            <p className="rounded-md bg-warning-50 px-2.5 py-1.5 text-caption text-warning-700">
                                Filled in by the AI Evaluator. Review and edit, then save - the
                                learner sees nothing until you do.
                            </p>
                        )}

                        {/* Save */}
                        <button
                            onClick={handleSave}
                            disabled={isSaving || marks === ''}
                            className={`mt-1 w-full rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                savedFlash
                                    ? 'bg-emerald-600 hover:bg-emerald-700'
                                    : 'bg-emerald-600 hover:bg-emerald-700'
                            }`}
                        >
                            {isSaving
                                ? 'Saving...'
                                : savedFlash
                                  ? '✓ Saved'
                                  : isGraded
                                    ? 'Update Grade'
                                    : 'Save Grade'}
                        </button>
                    </div>
                </div>
            </div>

            {/* PDF Preview */}
            <Dialog open={!!pdfPreviewUrl} onOpenChange={() => setPdfPreviewUrl(null)}>
                <DialogContent className="flex h-[85vh] w-[80vw] max-w-[80vw] flex-col gap-0 p-0">
                    <div className="flex items-center justify-between rounded-t-lg bg-primary-50 px-4 py-3">
                        <h2 className="font-semibold text-primary-500">PDF Preview</h2>
                    </div>
                    <div className="flex-1 overflow-hidden">
                        {pdfPreviewUrl && <SimplePDFViewer pdfUrl={pdfPreviewUrl} />}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};

interface QuizSlideOption {
    id?: string;
    text?: { content?: string };
    text_data?: { content?: string };
    content?: string;
    name?: string;
    option_text?: string;
}

interface QuizSlideQuestion {
    id: string;
    text?: { content?: string };
    text_data?: { content?: string };
    questionName?: string;
    question_type?: string;
    auto_evaluation_json?: string;
    autoEvaluationJson?: string;
    marks?: number | null;
    negative_marking?: number | null;
    options?: QuizSlideOption[];
}

const getQuizQuestionName = (q?: QuizSlideQuestion): string =>
    q?.text_data?.content ?? q?.text?.content ?? q?.questionName ?? '';

const getOptionText = (opt?: QuizSlideOption): string =>
    opt?.text?.content ??
    opt?.text_data?.content ??
    opt?.content ??
    opt?.option_text ??
    opt?.name ??
    '';

const getQuizCorrectOptionIds = (q?: QuizSlideQuestion): string[] => {
    const raw = q?.auto_evaluation_json ?? q?.autoEvaluationJson;
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        const list: unknown[] | undefined =
            (Array.isArray(parsed?.correctAnswers) && parsed.correctAnswers) ||
            (Array.isArray(parsed?.data?.correctAnswers) && parsed.data.correctAnswers) ||
            (Array.isArray(parsed?.correctOptionIds) && parsed.correctOptionIds) ||
            (Array.isArray(parsed?.data?.correctOptionIds) && parsed.data.correctOptionIds) ||
            undefined;
        if (!list || list.length === 0) return [];
        const first = list[0];
        if (typeof first === 'number' && q?.options?.length) {
            return list.map((idx) => String(q.options?.[idx as number]?.id ?? idx));
        }
        return list.map(String);
    } catch {
        return [];
    }
};

const UUID_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const lookupOptionName = (q: QuizSlideQuestion | undefined, id: string): string => {
    const match = q?.options?.find((o) => String(o.id ?? '') === String(id));
    if (match) {
        const text = getOptionText(match);
        if (text) return text;
    }
    // If the raw value is a UUID we couldn't resolve, blank it out so the cell
    // doesn't show a meaningless identifier. The dash placeholder is rendered
    // by the JSX when the value is empty. Non-UUID values (numeric / typed
    // answers) flow through unchanged.
    if (UUID_RE.test(id)) return '';
    return id;
};

interface QuizQuestionRow {
    trackedId: string;
    questionId: string;
    questionName: string;
    selectedAnswer: string;
    selectedAnswerIds: string[];
    correctAnswer: string;
    correctAnswerIds: string[];
    isCorrect: boolean;
    marks: number;
    maxMarks: number;
    responseStatus: string;
    instructorFeedback: string;
    instructorFeedbackFileId: string;
    slideQuestionOptionsCount: number;
}

interface QuizAttemptRow {
    activityId: string;
    attemptNumber: number;
    activityDate: string;
    startTime: string;
    endTime: string;
    duration: string;
    earnedMarks: number;
    totalMarks: number;
    percentage: number;
    passed: boolean | null;
    questions: QuizQuestionRow[];
}

const QuestionFeedbackEditor = ({
    trackedId,
    initialFeedback,
    initialFileId,
    uploaderUserId,
    onSaved,
}: {
    trackedId: string;
    initialFeedback: string;
    initialFileId: string;
    uploaderUserId: string;
    onSaved: () => void;
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [feedback, setFeedback] = useState(initialFeedback);
    const [fileId, setFileId] = useState(initialFileId);
    const [fileUrl, setFileUrl] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setFeedback(initialFeedback);
        setFileId(initialFileId);
    }, [initialFeedback, initialFileId]);

    useEffect(() => {
        let cancelled = false;
        if (fileId) {
            getPublicUrl(fileId)
                .then((url) => {
                    if (!cancelled) setFileUrl(url);
                })
                .catch(() => {
                    if (!cancelled) setFileUrl('');
                });
        } else {
            setFileUrl('');
        }
        return () => {
            cancelled = true;
        };
    }, [fileId]);

    const handleUpload = async (file: File) => {
        if (!uploaderUserId) return;
        setIsUploading(true);
        try {
            const id = await UploadFileInS3(
                file,
                () => {},
                uploaderUserId,
                'QUIZ_FEEDBACK',
                'TEACHER',
                true
            );
            if (id) setFileId(id);
        } finally {
            setIsUploading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await saveQuizQuestionFeedback({
                tracked_id: trackedId,
                instructor_feedback: feedback.trim() || null,
                instructor_feedback_file_id: fileId || null,
            });
            setIsEditing(false);
            onSaved();
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setFeedback(initialFeedback);
        setFileId(initialFileId);
        setIsEditing(false);
    };

    const hasFeedback = Boolean(feedback) || Boolean(fileId);

    if (!isEditing) {
        if (!hasFeedback) {
            return (
                <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="text-caption font-medium text-primary-500 hover:underline"
                >
                    + Add instructor feedback
                </button>
            );
        }
        return (
            <div className="flex flex-col gap-1 rounded-md border border-primary-100 bg-primary-50 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                    <p className="text-caption font-semibold uppercase tracking-wide text-primary-600">
                        Instructor feedback
                    </p>
                    <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="text-caption text-primary-500 hover:underline"
                    >
                        Edit
                    </button>
                </div>
                {feedback && (
                    <p className="whitespace-pre-wrap text-body text-neutral-800">{feedback}</p>
                )}
                {fileId && fileUrl && (
                    <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-caption text-primary-500 hover:underline"
                    >
                        <DownloadSimple size={12} weight="bold" /> View attachment
                    </a>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 rounded-md border border-primary-200 bg-primary-50 p-3">
            <p className="text-caption font-semibold uppercase tracking-wide text-primary-600">
                Instructor feedback
            </p>
            <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Write feedback for this question..."
                rows={3}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-800 focus:border-primary-400 focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-1 text-caption font-medium text-primary-500 hover:underline">
                    <UploadSimple size={14} weight="bold" />
                    {fileId ? 'Replace file' : 'Attach file'}
                    <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleUpload(file);
                            e.target.value = '';
                        }}
                    />
                </label>
                {isUploading && <Spinner size={14} className="animate-spin text-primary-500" />}
                {fileId && fileUrl && !isUploading && (
                    <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-caption text-neutral-600 hover:underline"
                    >
                        <DownloadSimple size={12} weight="bold" /> View
                    </a>
                )}
                {fileId && (
                    <button
                        type="button"
                        onClick={() => setFileId('')}
                        className="text-caption text-danger-600 hover:underline"
                        disabled={isUploading}
                    >
                        Remove
                    </button>
                )}
                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleCancel}
                        disabled={isSaving}
                        className="rounded-md px-3 py-1 text-caption font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={isSaving || isUploading}
                        className="inline-flex items-center gap-1 rounded-md bg-primary-500 px-3 py-1 text-caption font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                    >
                        {isSaving && <Spinner size={12} className="animate-spin" />}
                        {isSaving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const QuizAttemptCard = ({
    attempt,
    uploaderUserId,
    onFeedbackSaved,
}: {
    attempt: QuizAttemptRow;
    uploaderUserId: string;
    onFeedbackSaved: () => void;
}) => {
    const passBadge =
        attempt.passed == null ? null : attempt.passed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-caption font-semibold text-success-700">
                <CheckCircle size={12} weight="bold" /> Passed
            </span>
        ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2 py-0.5 text-caption font-semibold text-danger-600">
                <XIcon size={12} weight="bold" /> Failed
            </span>
        );

    return (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
                <div className="flex flex-col gap-0.5">
                    <p className="text-caption font-semibold uppercase tracking-wide text-primary-500">
                        Attempt {attempt.attemptNumber}
                    </p>
                    <p className="text-caption text-neutral-600">
                        {attempt.activityDate}
                        {attempt.startTime ? ` · ${attempt.startTime.trim()}` : ''} · {attempt.duration}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex flex-col items-end">
                        <p className="text-caption text-neutral-500">Score</p>
                        <p className="text-subtitle font-semibold text-neutral-900">
                            {attempt.earnedMarks}/{attempt.totalMarks}
                            {attempt.totalMarks > 0 && (
                                <span className="ml-1 text-body font-regular text-neutral-500">
                                    ({attempt.percentage}%)
                                </span>
                            )}
                        </p>
                    </div>
                    {passBadge}
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-body">
                    <thead className="bg-neutral-50">
                        <tr className="border-b border-neutral-200 text-left text-caption text-neutral-600">
                            <th className="px-4 py-2 font-semibold">#</th>
                            <th className="px-4 py-2 font-semibold">Question</th>
                            <th className="px-4 py-2 font-semibold">Learner Answer</th>
                            <th className="px-4 py-2 font-semibold">Correct Answer</th>
                            <th className="px-4 py-2 font-semibold">Result</th>
                            <th className="px-4 py-2 font-semibold">Marks</th>
                        </tr>
                    </thead>
                    <tbody>
                        {attempt.questions.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={6}
                                    className="px-4 py-6 text-center text-caption text-neutral-500"
                                >
                                    No question responses recorded
                                </td>
                            </tr>
                        ) : (
                            attempt.questions.map((q, idx) => (
                                <React.Fragment key={q.trackedId || idx}>
                                    <tr className="border-b border-neutral-100 align-top">
                                        <td className="px-4 py-3 text-caption text-neutral-500">
                                            {idx + 1}
                                        </td>
                                        <td
                                            className="px-4 py-3 text-body text-neutral-800"
                                            dangerouslySetInnerHTML={{
                                                __html: q.questionName || '—',
                                            }}
                                        />
                                        <td className="px-4 py-3 text-body text-neutral-700">
                                            {q.selectedAnswer ? (
                                                q.selectedAnswer
                                            ) : q.responseStatus === 'SKIPPED' ? (
                                                <span className="text-neutral-400">
                                                    Skipped
                                                </span>
                                            ) : (
                                                <span
                                                    className="text-neutral-400"
                                                    title="Answer was recorded but the option text could not be looked up. This usually means the quiz was edited after this attempt."
                                                >
                                                    Answer recorded
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-body text-neutral-700">
                                            {q.correctAnswer || (
                                                <span className="text-neutral-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            {q.responseStatus === 'SKIPPED' ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-medium text-neutral-600">
                                                    Skipped
                                                </span>
                                            ) : q.isCorrect ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-caption font-medium text-success-700">
                                                    <CheckCircle size={12} weight="bold" />
                                                    Correct
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2 py-0.5 text-caption font-medium text-danger-600">
                                                    <XIcon size={12} weight="bold" />
                                                    Wrong
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-body font-medium text-neutral-800">
                                            {q.marks}/{q.maxMarks}
                                        </td>
                                    </tr>
                                    {q.trackedId && (
                                        <tr className="border-b border-neutral-100 last:border-b-0">
                                            <td className="px-4 pb-3 pt-0" />
                                            <td colSpan={5} className="px-4 pb-3 pt-0">
                                                <QuestionFeedbackEditor
                                                    trackedId={q.trackedId}
                                                    initialFeedback={q.instructorFeedback}
                                                    initialFileId={q.instructorFeedbackFileId}
                                                    uploaderUserId={uploaderUserId}
                                                    onSaved={onFeedbackSaved}
                                                />
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export const ActivityLogDialog = ({
    selectedUser,
    slideData,
}: {
    selectedUser?: StudentTable | null;
    slideData?: SlideWithStatusType;
}) => {
    const [selectedTab, setSelectedTab] = useState('insights');
    const { isOpen, closeDialog, selectedUserId, selectedUserName } = useActivityStatsStore();
    const { activeItem } = useContentStore();
    const router = useRouter();
    const { slideId: routeSlideId } = router.state.location.search as { slideId?: string };

    const queryClient = useQueryClient();
    const { page, pageSize, handlePageChange } = usePaginationState({
        initialPage: 0,
        initialPageSize: 5,
    });

    const queryConfig = useMemo(() => {
        const userId = selectedUser && slideData ? selectedUser.user_id : selectedUserId || '';
        const slideId = selectedUser && slideData ? slideData.slide_id : activeItem?.id || '';

        if (activeItem?.source_type === 'QUESTION') {
            return getQuestionSlideActivityLogs({
                userId,
                slideId,
                pageNo: page,
                pageSize: pageSize,
            });
        }
        if (activeItem?.source_type === 'ASSIGNMENT') {
            return getAssignmentSlideActivityLogs({
                userId,
                slideId,
                pageNo: page,
                pageSize: pageSize,
            });
        }
        if (activeItem?.source_type === 'VIDEO') {
            return getUserVideoSlideActivityLogs({
                userId,
                slideId,
                pageNo: page,
                pageSize: pageSize,
            });
        }
        if (activeItem?.source_type === 'QUIZ') {
            return getQuizSlideActivityLogs({
                userId,
                slideId,
                pageNo: page,
                pageSize: pageSize,
            });
        } else {
            return getUserDocActivityLogs({
                userId,
                slideId,
                pageNo: page,
                pageSize: pageSize,
            });
        }
    }, [selectedUser, slideData, selectedUserId, activeItem, page, pageSize]);

    const queryConfigVideoResponse = useMemo(() => {
        const userId = selectedUser && slideData ? selectedUser.user_id : selectedUserId || '';
        const slideId = selectedUser && slideData ? slideData.slide_id : activeItem?.id || '';

        return getUserVideoResponseSlideActivityLogs({
            userId,
            slideId,
            pageNo: page,
            pageSize: pageSize,
        });
    }, [selectedUser, slideData, selectedUserId, activeItem, page, pageSize]);

    // Assessment activity is served by its own component (assessment data lives in
    // the assessment-service, not learner-tracking), so skip the generic log fetch.
    const isAssessment = activeItem?.source_type?.toUpperCase() === 'ASSESSMENT';
    const { data: activityLogs, isLoading, error } = useQuery({
        ...queryConfig,
        enabled: !isAssessment,
    });
    const {
        data: activityLogsVideoResponse,
        isLoading: isVideoResponseLoading,
        error: isVideoResponseError,
    } = useQuery({ ...queryConfigVideoResponse, enabled: !isAssessment });

    const quizSlideIdForFetch =
        activeItem?.source_type === 'QUIZ'
            ? selectedUser && slideData
                ? slideData.slide_id
                : activeItem?.id || ''
            : '';
    const { data: fetchedQuizSlide } = useQuery(
        getSlideByIdQuery({
            slideId: quizSlideIdForFetch,
            enabled: Boolean(quizSlideIdForFetch),
        })
    );

    const formatDateTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleString();
    };

    const tableData = useMemo(() => {
        if (!activityLogs) {
            return {
                content: [],
                total_pages: 0,
                page_no: 0,
                page_size: pageSize,
                total_elements: 0,
                last: true,
            };
        }

        let transformedContent = activityLogs.content;

        if (activeItem?.source_type === 'VIDEO' || activeItem?.source_type === 'DOCUMENT') {
            transformedContent = activityLogs.content.map((item: ActivityContent) => ({
                activityDate: formatDateTime(item.start_time_in_millis).split(',')[0],
                startTime: formatDateTime(item.start_time_in_millis).split(',')[1],
                endTime: formatDateTime(item.end_time_in_millis).split(',')[1],
                duration: `${(
                    (item.end_time_in_millis - item.start_time_in_millis) /
                    1000 /
                    60
                ).toFixed(2)} mins`,
                lastPageRead: item.percentage_watched,
                videos: item.videos,
                documents: item.documents,
                concentrationScore: item.concentration_score?.concentration_score || 0,
            }));
        }
        if (activeItem?.source_type === 'QUESTION') {
            transformedContent = activityLogs.content.map((item: ActivityContent) => ({
                activityDate: formatDateTime(item.start_time_in_millis).split(',')[0],
                attemptNumber: item.question_slides[0]?.attempt_number,
                startTime: formatDateTime(item.start_time_in_millis).split(',')[1],
                endTime: formatDateTime(item.end_time_in_millis).split(',')[1],
                duration: `${(
                    (item.end_time_in_millis - item.start_time_in_millis) /
                    1000 /
                    60
                ).toFixed(2)} mins`,
                questionName: item.question_slides[0]?.response_json
                    ? JSON.parse(item.question_slides[0]?.response_json || '')?.questionName
                    : '',
                response: item.question_slides[0]?.response_json
                    ? JSON.parse(item.question_slides[0]?.response_json || '')
                          ?.selectedOptions?.map(
                              (option: { id: string; name: string }) => option.name
                          )
                          .join(',')
                    : '',
                responseStatus: item.question_slides[0]?.response_status,
            }));
        }

        if (activeItem?.source_type === 'QUIZ') {
            const safeParse = (s: string) => {
                try {
                    return JSON.parse(s);
                } catch {
                    return null;
                }
            };
            const quizSlide =
                (fetchedQuizSlide as { quiz_slide?: typeof activeItem.quiz_slide } | undefined)
                    ?.quiz_slide ?? activeItem?.quiz_slide;
            const slideQuestions: QuizSlideQuestion[] =
                (quizSlide?.questions as QuizSlideQuestion[] | undefined) ?? [];
            const qLookup = new Map<string, QuizSlideQuestion>(
                slideQuestions.filter((q) => q.id).map((q) => [q.id, q])
            );
            const defaultMaxMarks =
                (quizSlide?.marks_per_question as number | undefined) ?? 1;
            const defaultNegMarks =
                (quizSlide?.negative_marking as number | undefined) ?? 0;
            const passPercentage = quizSlide?.pass_percentage ?? null;
            const total = activityLogs.totalElements ?? activityLogs.content.length;

            transformedContent = activityLogs.content.map(
                (item: ActivityContent, idx: number) => {
                    const startStr = formatDateTime(item.start_time_in_millis);
                    const endStr = formatDateTime(item.end_time_in_millis);
                    const durationMinutes =
                        (item.end_time_in_millis - item.start_time_in_millis) /
                        1000 /
                        60;
                    // When the backend persisted no per-question rows for this attempt
                    // (e.g. submission errored before quiz_sides saved), synthesize a row
                    // per quiz-slide question marked as Skipped so the admin still sees
                    // the question list + the maximum possible score for that attempt.
                    const baseSides: typeof item.quiz_sides =
                        item.quiz_sides && item.quiz_sides.length > 0
                            ? item.quiz_sides
                            : slideQuestions.map((sq) => ({
                                  id: '',
                                  response_json: '',
                                  response_status: 'SKIPPED',
                                  question_id: sq.id,
                                  activity_id: item.id,
                              }));
                    const questions = baseSides.map((qs) => {
                        const parsed = qs.response_json
                            ? safeParse(qs.response_json)
                            : null;
                        const slideQ = qLookup.get(qs.question_id);
                        const questionName =
                            parsed?.questionName || getQuizQuestionName(slideQ);
                        const correctIds = getQuizCorrectOptionIds(slideQ);
                        // Selected answer: prefer the enriched payload; fall back to the
                        // pre-enrichment shape { answer: <id|ids> } and look option text up
                        // from the slide config.
                        let selectedAnswer = '';
                        let answerIds: string[] = [];
                        if (
                            Array.isArray(parsed?.selectedOptions) &&
                            parsed.selectedOptions.length > 0
                        ) {
                            answerIds = parsed.selectedOptions.map(
                                (o: { id: string }) => String(o.id)
                            );
                            selectedAnswer = parsed.selectedOptions
                                .map((o: { name: string }) => o.name)
                                .join(', ');
                        } else if (parsed?.answer != null) {
                            const raw = parsed.answer;
                            answerIds = Array.isArray(raw)
                                ? raw.map(String)
                                : [String(raw)];
                            selectedAnswer = answerIds
                                .map((id) => lookupOptionName(slideQ, id))
                                .join(', ');
                        }
                        const correctAnswer =
                            (Array.isArray(parsed?.correctOptions) &&
                            parsed.correctOptions.length > 0
                                ? parsed.correctOptions
                                      .map((o: { name: string }) => o.name)
                                      .join(', ')
                                : correctIds
                                      .map((id) => lookupOptionName(slideQ, id))
                                      .join(', ')) || '';
                        const isAnswered = answerIds.length > 0;
                        const computedCorrect =
                            isAnswered &&
                            correctIds.length > 0 &&
                            answerIds.length === correctIds.length &&
                            correctIds.every((c) => answerIds.includes(c));
                        const isCorrect =
                            typeof parsed?.isCorrect === 'boolean'
                                ? parsed.isCorrect
                                : computedCorrect;
                        const slideMaxMarks =
                            (slideQ?.marks as number | null | undefined) ??
                            defaultMaxMarks;
                        const slideNegMarks =
                            (slideQ?.negative_marking as number | null | undefined) ??
                            defaultNegMarks;
                        const maxMarks =
                            typeof parsed?.maxMarks === 'number'
                                ? parsed.maxMarks
                                : slideMaxMarks;
                        const fallbackEarned = !isAnswered
                            ? 0
                            : isCorrect
                              ? maxMarks
                              : -slideNegMarks;
                        const marks =
                            typeof parsed?.marks === 'number'
                                ? parsed.marks
                                : fallbackEarned;
                        const responseStatus =
                            qs.response_status === 'SKIPPED' ||
                            qs.response_status === 'CORRECT' ||
                            qs.response_status === 'WRONG'
                                ? qs.response_status
                                : !isAnswered
                                  ? 'SKIPPED'
                                  : isCorrect
                                    ? 'CORRECT'
                                    : 'WRONG';
                        return {
                            trackedId: qs.id,
                            questionId: qs.question_id,
                            questionName,
                            selectedAnswer,
                            selectedAnswerIds: answerIds,
                            correctAnswer,
                            correctAnswerIds: correctIds,
                            isCorrect,
                            marks,
                            maxMarks,
                            responseStatus,
                            instructorFeedback: qs.instructor_feedback ?? '',
                            instructorFeedbackFileId: qs.instructor_feedback_file_id ?? '',
                            slideQuestionOptionsCount: slideQ?.options?.length ?? 0,
                        };
                    });
                    const earnedMarks = Math.max(
                        0,
                        questions.reduce((sum, q) => sum + q.marks, 0)
                    );
                    const totalMarks = questions.reduce(
                        (sum, q) => sum + q.maxMarks,
                        0
                    );
                    const percentage =
                        totalMarks > 0
                            ? Math.round((earnedMarks / totalMarks) * 100)
                            : 0;
                    const passed =
                        passPercentage != null && totalMarks > 0
                            ? percentage >= passPercentage
                            : null;
                    return {
                        activityId: item.id,
                        attemptNumber: total - (page * pageSize + idx),
                        activityDate: startStr.split(',')[0],
                        startTime: startStr.split(',')[1],
                        endTime: endStr.split(',')[1],
                        duration: `${durationMinutes.toFixed(2)} mins`,
                        earnedMarks,
                        totalMarks,
                        percentage,
                        passed,
                        questions,
                    };
                }
            );
            transformedContent = (transformedContent as QuizAttemptRow[]).sort(
                (a, b) => a.attemptNumber - b.attemptNumber
            );
        }

        if (activeItem?.source_type === 'ASSIGNMENT') {
            transformedContent = activityLogs.content
                .filter((item: ActivityContent) => item.source_type === 'ASSIGNMENT')
                .map((item: ActivityContent) => {
                    const submission = item.assignment_slides?.[0];
                    const dateTime = submission?.date_submitted
                        ? extractDateTime(convertToLocalDateTime(submission.date_submitted))
                        : {
                              date: formatDateTime(item.start_time_in_millis).split(',')[0],
                              time: formatDateTime(item.start_time_in_millis).split(',')[1],
                          };
                    return {
                        uploadDate: dateTime.date,
                        uploadTime: dateTime.time,
                        files: [] as AssignmentFileInfo[],
                        rawFileIds: submission?.comma_separated_file_ids || '',
                        trackedId: submission?.id || '',
                        marks: submission?.marks ?? null,
                        feedback: submission?.feedback ?? null,
                        checkedFileId: submission?.checked_file_id ?? null,
                        lateSubmission: !!submission?.late_submission,
                    };
                });
        }

        return {
            content: transformedContent,
            total_pages: activityLogs.totalPages,
            page_no: page,
            page_size: pageSize,
            total_elements: activityLogs.totalElements,
            last: activityLogs.last,
        };
    }, [activityLogs, page, pageSize, selectedUser, slideData, activeItem, fetchedQuizSlide]);

    const tableDataVideoResponse = useMemo(() => {
        if (!activityLogsVideoResponse) {
            return {
                content: [],
                total_pages: 0,
                page_no: 0,
                page_size: pageSize,
                total_elements: 0,
                last: true,
            };
        }

        const transformedContent = activityLogsVideoResponse.content.map(
            (item: ActivityContent) => ({
                activityDate: formatDateTime(item.start_time_in_millis).split(',')[0],
                startTime: formatDateTime(item.start_time_in_millis).split(',')[1],
                endTime: formatDateTime(item.end_time_in_millis).split(',')[1],
                duration: `${(
                    (item.end_time_in_millis - item.start_time_in_millis) /
                    1000 /
                    60
                ).toFixed(2)} mins`,
                questionName: item.video_slides_questions[0]?.response_json
                    ? JSON.parse(item.video_slides_questions[0]?.response_json || '')?.questionName
                    : '',
                response: item.video_slides_questions[0]?.response_json
                    ? JSON.parse(item.video_slides_questions[0]?.response_json || '')
                          ?.selectedOptions?.map(
                              (option: { id: string; name: string }) => option.name
                          )
                          .join(',')
                    : '',
                responseStatus: item.video_slides_questions[0]?.response_status,
            })
        );

        return {
            content: transformedContent,
            total_pages: activityLogsVideoResponse.totalPages,
            page_no: page,
            page_size: pageSize,
            total_elements: activityLogsVideoResponse.totalElements,
            last: activityLogsVideoResponse.last,
        };
    }, [activityLogsVideoResponse, page, pageSize, selectedUser, slideData, activeItem]);

    // Resolve file IDs to public URLs for assignment submissions
    const [resolvedAssignmentData, setResolvedAssignmentData] = useState<AssignmentRowData[]>([]);
    const [isResolvingFiles, setIsResolvingFiles] = useState(false);

    useEffect(() => {
        if (activeItem?.source_type !== 'ASSIGNMENT' || tableData.content.length === 0) {
            setResolvedAssignmentData([]);
            return;
        }

        let cancelled = false;
        const resolveFiles = async () => {
            setIsResolvingFiles(true);
            const resolved = await Promise.all(
                (tableData.content as AssignmentRowData[]).map(async (row) => {
                    if (!row.rawFileIds) return { ...row, files: [] };
                    const fileIds = row.rawFileIds.split(',').filter(Boolean);
                    const files = await Promise.all(
                        fileIds.map(async (fid) => {
                            const url = await getPublicUrl(fid.trim());
                            const isPdf =
                                url.toLowerCase().includes('.pdf') ||
                                url.toLowerCase().includes('application/pdf');
                            return { fileId: fid.trim(), url, isPdf };
                        })
                    );
                    return { ...row, files };
                })
            );
            if (!cancelled) {
                setResolvedAssignmentData(resolved);
                setIsResolvingFiles(false);
            }
        };

        resolveFiles();
        return () => {
            cancelled = true;
        };
    }, [tableData.content, activeItem?.source_type]);

    const [isDownloadingAll, setIsDownloadingAll] = useState(false);

    const handleDownloadAllSubmissions = useCallback(async () => {
        const slideId = selectedUser && slideData ? slideData.slide_id : activeItem?.id || routeSlideId || '';
        if (!slideId) return;

        setIsDownloadingAll(true);
        try {
            await downloadAllAssignmentSubmissions(slideId);
        } catch (err) {
            console.error('Failed to download all submissions:', err);
        } finally {
            setIsDownloadingAll(false);
        }
    }, [selectedUser, slideData, activeItem, routeSlideId]);

    return (
        <>
            <Dialog open={isOpen} onOpenChange={closeDialog}>
                <DialogContent
                    className="flex max-h-[90vh] w-[920px] max-w-[95vw] flex-col gap-0 overflow-hidden p-0"
                >
                    {/* Hero header with student avatar */}
                    {(() => {
                        const studentName = selectedUserName || selectedUser?.full_name || '';
                        const initials = studentName
                            .split(' ')
                            .map((n) => n[0])
                            .filter(Boolean)
                            .slice(0, 2)
                            .join('')
                            .toUpperCase() || '?';
                        const isAssignment = activeItem?.source_type === 'ASSIGNMENT';
                        const total = resolvedAssignmentData.length;
                        const graded = resolvedAssignmentData.filter(
                            (r) =>
                                (r.marks != null && r.marks > 0) ||
                                !!r.feedback ||
                                !!r.checkedFileId
                        ).length;
                        const pending = total - graded;

                        return (
                            <div className="flex flex-col border-b border-neutral-200 bg-gradient-to-r from-primary-50 to-white">
                                <div className="flex items-center gap-3 px-6 py-5">
                                    <Avatar className="h-12 w-12 shadow-sm">
                                        <AvatarFallback className="bg-primary-500 text-base font-semibold text-white">
                                            {initials}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex min-w-0 flex-1 flex-col">
                                        <p className="text-[11px] font-medium uppercase tracking-wide text-primary-500">
                                            Activity Log
                                        </p>
                                        <h1 className="truncate text-lg font-semibold text-neutral-900">
                                            {studentName || 'Student'}
                                        </h1>
                                    </div>
                                </div>
                                {isAssignment && total > 0 && (
                                    <div className="grid grid-cols-3 gap-px border-t border-neutral-200 bg-neutral-100">
                                        <div className="flex items-center gap-2.5 bg-white px-6 py-2.5">
                                            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-50 text-primary-600">
                                                <ClipboardText size={14} weight="bold" />
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                                                    Submissions
                                                </p>
                                                <p className="text-sm font-semibold text-neutral-900">
                                                    {total}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2.5 bg-white px-6 py-2.5">
                                            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
                                                <CheckCircle size={14} weight="bold" />
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                                                    Marked
                                                </p>
                                                <p className="text-sm font-semibold text-neutral-900">
                                                    {graded}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2.5 bg-white px-6 py-2.5">
                                            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-50 text-amber-600">
                                                <ClockIcon size={14} weight="bold" />
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                                                    Unmarked
                                                </p>
                                                <p className="text-sm font-semibold text-neutral-900">
                                                    {pending}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                    <div className="flex-1 overflow-y-auto">
                    {isAssessment ? (
                        <AssessmentAttemptActivity
                            assessmentId={activeItem?.assessment_slide?.assessment_id || ''}
                            instituteId={getInstituteId()}
                            userId={
                                selectedUser && slideData
                                    ? selectedUser.user_id
                                    : selectedUserId || ''
                            }
                            userName={selectedUserName || selectedUser?.full_name || ''}
                            assessmentTitle={activeItem?.title}
                        />
                    ) : isLoading || isVideoResponseLoading ? (
                        <div className="flex items-center justify-center p-8">
                            <DashboardLoader />
                        </div>
                    ) : tableData.content.length == 0 ? (
                        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-neutral-500">
                            <ClipboardText size={36} className="text-neutral-300" weight="duotone" />
                            <p className="text-sm font-medium">No activity yet</p>
                            <p className="text-xs">This student hasn't engaged with the slide</p>
                        </div>
                    ) : (
                        <>
                            {activeItem?.source_type === 'VIDEO' && (
                                <Tabs
                                    className="p-4"
                                    value={selectedTab}
                                    onValueChange={setSelectedTab}
                                >
                                    <TabsList className="inline-flex h-auto justify-start gap-4 rounded-none border-b !bg-transparent p-0">
                                        <TabsTrigger
                                            value="insights"
                                            className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                                selectedTab === 'insights'
                                                    ? 'border-4px rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                                    : 'border-none bg-transparent'
                                            }`}
                                        >
                                            <span
                                                className={`${selectedTab === 'insights' ? 'text-primary-500' : ''}`}
                                            >
                                                View Insights
                                            </span>
                                        </TabsTrigger>
                                        <TabsTrigger
                                            value="responses"
                                            className={`inline-flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                                selectedTab === 'responses'
                                                    ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                                    : 'border-none bg-transparent'
                                            }`}
                                        >
                                            <span
                                                className={`${selectedTab === 'responses' ? 'text-primary-500' : ''}`}
                                            >
                                                Responses
                                            </span>
                                        </TabsTrigger>
                                    </TabsList>
                                    <TabsContent value="insights">
                                        <div className="no-scrollbar mt-6 overflow-x-scroll">
                                            <MyTable
                                                data={tableData}
                                                columns={activityLogColumns}
                                                isLoading={isLoading}
                                                error={error}
                                                columnWidths={ACTIVITY_LOG_COLUMN_WIDTHS}
                                                currentPage={page}
                                            />

                                            {tableData.total_pages > 1 && (
                                                <div className="mt-6">
                                                    <MyPagination
                                                        currentPage={page}
                                                        totalPages={tableData.total_pages}
                                                        onPageChange={handlePageChange}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </TabsContent>
                                    <TabsContent value="responses">
                                        <div className="no-scrollbar mt-6 overflow-x-scroll">
                                            <MyTable
                                                data={tableDataVideoResponse}
                                                columns={activityResponseTypeColumns}
                                                isLoading={isVideoResponseLoading}
                                                error={isVideoResponseError}
                                                columnWidths={ACTIVITY_RESPONSE_COLUMN_WIDTHS}
                                                currentPage={page}
                                            />
                                            {tableDataVideoResponse.total_pages > 1 && (
                                                <div className="mt-6">
                                                    <MyPagination
                                                        currentPage={page}
                                                        totalPages={tableDataVideoResponse.total_pages}
                                                        onPageChange={handlePageChange}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </TabsContent>
                                </Tabs>
                            )}

                            {activeItem?.source_type === 'QUESTION' && (
                                <div className="no-scrollbar mt-6 overflow-x-scroll px-4">
                                    <MyTable
                                        data={tableData}
                                        columns={activityResponseTypeColumns}
                                        isLoading={isLoading}
                                        error={error}
                                        columnWidths={ACTIVITY_RESPONSE_COLUMN_WIDTHS}
                                        currentPage={page}
                                    />
                                    {tableData.total_pages > 1 && (
                                        <div className="my-6">
                                            <MyPagination
                                                currentPage={page}
                                                totalPages={tableData.total_pages}
                                                onPageChange={handlePageChange}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeItem?.source_type === 'QUESTION' && (
                                <AiInsightsPanel
                                    slideId={
                                        selectedUser && slideData
                                            ? slideData.slide_id
                                            : activeItem?.id || ''
                                    }
                                    userId={
                                        selectedUser && slideData
                                            ? selectedUser.user_id
                                            : selectedUserId || ''
                                    }
                                />
                            )}

                            {activeItem?.source_type === 'QUIZ' && (() => {
                                const adminToken = getTokenFromCookie(TokenKey.accessToken);
                                const adminUserId =
                                    getTokenDecodedData(adminToken)?.sub || '';
                                const handleFeedbackSaved = () => {
                                    queryClient.invalidateQueries({
                                        queryKey: ['GET_QUIZ_SLIDE_ACTIVITY_LOGS'],
                                    });
                                };
                                return (
                                    <div className="mt-6 px-4">
                                        <div className="flex flex-col gap-4">
                                            {(tableData.content as QuizAttemptRow[]).map(
                                                (attempt) => (
                                                    <QuizAttemptCard
                                                        key={attempt.activityId}
                                                        attempt={attempt}
                                                        uploaderUserId={adminUserId}
                                                        onFeedbackSaved={handleFeedbackSaved}
                                                    />
                                                )
                                            )}
                                        </div>
                                        {tableData.total_pages > 1 && (
                                            <div className="my-6">
                                                <MyPagination
                                                    currentPage={page}
                                                    totalPages={tableData.total_pages}
                                                    onPageChange={handlePageChange}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {activeItem?.source_type === 'ASSIGNMENT' && (
                                <div className="mt-6 px-4">
                                    {isResolvingFiles ? (
                                        <div className="flex items-center justify-center p-4">
                                            <DashboardLoader />
                                        </div>
                                    ) : (
                                        <>
                                            <div className="mb-4 flex justify-end">
                                                <button
                                                    onClick={handleDownloadAllSubmissions}
                                                    disabled={isDownloadingAll}
                                                    className="flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {isDownloadingAll ? (
                                                        <Spinner size={14} className="animate-spin" />
                                                    ) : (
                                                        <DownloadSimple size={14} />
                                                    )}
                                                    {isDownloadingAll ? 'Downloading...' : 'Download All Users\' Submissions'}
                                                </button>
                                            </div>
                                            <div className="flex flex-col gap-3">
                                                {resolvedAssignmentData.map((row, idx) => (
                                                    <SubmissionCard
                                                        key={row.trackedId || idx}
                                                        row={row}
                                                        onGradeSaved={() => {
                                                            queryClient.invalidateQueries({
                                                                queryKey: ['GET_ASSIGNMENT_SLIDE_ACTIVITY_LOGS'],
                                                            });
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        </>
                                    )}
                                    {tableData.total_pages > 1 && (
                                        <div className="my-6">
                                            <MyPagination
                                                currentPage={page}
                                                totalPages={tableData.total_pages}
                                                onPageChange={handlePageChange}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            {(activeItem?.source_type === 'QUIZ' ||
                                activeItem?.source_type === 'ASSIGNMENT') && (
                                <AiInsightsPanel
                                    slideId={
                                        selectedUser && slideData
                                            ? slideData.slide_id
                                            : activeItem?.id || ''
                                    }
                                    userId={
                                        selectedUser && slideData
                                            ? selectedUser.user_id
                                            : selectedUserId || ''
                                    }
                                />
                            )}

                            {activeItem?.source_type === 'DOCUMENT' && (
                                <div className="no-scrollbar mt-6 overflow-x-scroll px-4">
                                    <MyTable
                                        data={tableData}
                                        columns={activityLogColumns}
                                        isLoading={isLoading}
                                        error={error}
                                        columnWidths={ACTIVITY_LOG_COLUMN_WIDTHS}
                                        currentPage={page}
                                    />
                                    {tableData.total_pages > 1 && (
                                        <div className="my-6">
                                            <MyPagination
                                                currentPage={page}
                                                totalPages={tableData.total_pages}
                                                onPageChange={handlePageChange}
                                            />
                                        </div>
                                    )}
                                    {/* Learner's responses to interactive blocks in the document
                                        (checklist / fill-in-the-blank / inline MCQ). */}
                                    <DocumentInteractionsPanel
                                        slideId={
                                            selectedUser && slideData
                                                ? slideData.slide_id
                                                : activeItem?.id || ''
                                        }
                                        userId={
                                            selectedUser && slideData
                                                ? selectedUser.user_id
                                                : selectedUserId || ''
                                        }
                                    />
                                </div>
                            )}
                        </>
                    )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};
