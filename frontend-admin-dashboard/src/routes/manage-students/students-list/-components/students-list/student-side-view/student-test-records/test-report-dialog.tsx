import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowSquareOut, BookOpen, CalendarBlank, Clock } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MyButton } from '@/components/design-system/button';
import { ChipToggleGroup } from '@/components/design-system/chips';
import ExportDialogPDFCSV from '@/components/common/export-dialog-pdf-csv';
import { Crown } from '@/svgs';
import { cn } from '@/lib/utils';
import {
    resolveSubjectName,
    unresolvedSubjectIds,
    useSubjectNamesByIds,
} from '@/services/subject-names';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { formatMark } from '@/services/submission-review/marks';
import { submissionKeys } from '@/services/submission-review/query-keys';
import { handleGetStudentReportExportPDF } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import { getQuestionsDataForStep2 } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { paperQuestion, type Paper } from '@/routes/assessment/submission/$attemptId/-utils/paper';
import { AssessmentReportStudentInterface } from '@/types/assessments/assessment-overview';
import { AssessmentTestReport, ReportQuestion } from '@/types/assessments/assessment-data-report';
import { Steps } from '@/types/assessments/assessment-data-type';
import { ProfileStat } from '../profile-ui';
import { BreakdownDonut } from './breakdown-donut';
import { parseServerDate, type ReviewStatus } from './report-answer';
import {
    formatDuration,
    ReportQuestionCard,
    reviewStatusOfQuestion,
    signedMark,
} from './report-question-card';

interface TestReportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    testReport: AssessmentTestReport;
    studentReport: AssessmentReportStudentInterface;
    /** Null while loading, or when the details request failed. */
    assessmentDetails: Steps | null;
}

type ReviewFilter = 'ALL' | ReviewStatus;

const FILTER_ORDER: ReviewStatus[] = ['CORRECT', 'PARTIAL', 'WRONG', 'PENDING', 'SKIPPED'];
const FILTER_LABEL_KEY: Record<ReviewStatus, string> = {
    CORRECT: 'filter.correct',
    PARTIAL: 'filter.partial',
    WRONG: 'filter.wrong',
    PENDING: 'filter.pending',
    SKIPPED: 'filter.skipped',
};

const scoreTone = (pct: number) =>
    pct >= 80 ? 'success' : pct >= 50 ? 'primary' : pct >= 30 ? 'warning' : 'danger';

const formatDate = (date: Date | null) =>
    date
        ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : '';
const formatClock = (date: Date | null) =>
    date ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

export const TestReportDialog = ({
    isOpen,
    onClose,
    testReport,
    studentReport,
    assessmentDetails,
}: TestReportDialogProps) => {
    const { t } = useTranslation('manageStudentsTestReportDialog');
    const navigate = useNavigate();
    const { data: instituteDetails } = useQuery(useInstituteQuery());
    const overall = testReport.question_overall_detail_dto;
    const allSections = useMemo(() => testReport.all_sections ?? {}, [testReport.all_sections]);

    // Tabs follow the paper's sections; without the paper, the sections the report has.
    const sections = useMemo(() => {
        const saved = assessmentDetails?.[1]?.saved_data.sections ?? [];
        if (saved.length > 0) return saved.map((s) => ({ id: s.id, name: s.name }));
        return Object.keys(allSections).map((id, index) => ({
            id,
            name: t('answer.sectionFallback', { number: index + 1 }),
        }));
    }, [assessmentDetails, allSections, t]);

    // Derived, not stored once at mount: the dialog can open before the sections load.
    const [pickedSection, setPickedSection] = useState<string | null>(null);
    const activeSection =
        pickedSection && sections.some((s) => s.id === pickedSection)
            ? pickedSection
            : sections[0]?.id ?? '';
    const [filter, setFilter] = useState<ReviewFilter>('ALL');

    // The report sends option ids only; the option texts come from the paper.
    const sectionIdsCsv = sections.map((s) => s.id).join(',');
    const paperQuery = useQuery({
        queryKey: submissionKeys.paper(studentReport.assessment_id, sectionIdsCsv),
        queryFn: () =>
            getQuestionsDataForStep2({
                assessmentId: studentReport.assessment_id,
                sectionIds: sectionIdsCsv,
            }),
        enabled: isOpen && !!studentReport.assessment_id && sectionIdsCsv.length > 0,
        staleTime: 10 * 60_000,
    });
    const paper = paperQuery.data as Paper | undefined;

    // Numbered in paper order; the number stays with the question when a filter hides others.
    const questions = useMemo(() => {
        const list: ReportQuestion[] = [...(allSections[activeSection] ?? [])];
        list.sort((a, b) => (a.question_order ?? 0) - (b.question_order ?? 0));
        return list.map((question, index) => ({
            question,
            number: index + 1,
            status: reviewStatusOfQuestion(question),
        }));
    }, [allSections, activeSection]);

    const statusCounts = useMemo(() => {
        const counts: Record<ReviewStatus, number> = {
            CORRECT: 0,
            PARTIAL: 0,
            WRONG: 0,
            PENDING: 0,
            SKIPPED: 0,
        };
        questions.forEach((q) => {
            counts[q.status] += 1;
        });
        return counts;
    }, [questions]);
    const visibleQuestions =
        filter === 'ALL' ? questions : questions.filter((q) => q.status === filter);

    const filterOptions = [
        { value: 'ALL' as ReviewFilter, label: t('filter.all', { n: questions.length }) },
        ...FILTER_ORDER.filter((status) => statusCounts[status] > 0).map((status) => ({
            value: status as ReviewFilter,
            label: t(FILTER_LABEL_KEY[status], { n: statusCounts[status] }),
        })),
    ];

    const openSubmission = () => {
        if (!studentReport.attempt_id) return;
        onClose();
        navigate({
            to: '/assessment/submission/$attemptId',
            params: { attemptId: studentReport.attempt_id },
            search: {},
        });
    };

    const exportPdf = useMutation({
        mutationFn: () =>
            handleGetStudentReportExportPDF(
                studentReport.assessment_id,
                instituteDetails?.id,
                // The attempt, not the test: this used to send the assessment id here.
                studentReport.attempt_id
            ),
        onSuccess: (response) => {
            const url = window.URL.createObjectURL(new Blob([response]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `pdf_student_report_${new Date().toLocaleString()}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.success(t('toast.exportPdfSuccess'));
        },
        onError: () => {
            toast.error(t('toast.exportPdfFailed'));
        },
    });

    // The institute list keeps one subject per distinct name and drops subjects whose
    // course was deleted, so most stored ids need the direct lookup.
    const subjectNamesById = useSubjectNamesByIds(
        unresolvedSubjectIds(instituteDetails?.subjects, [overall.subjectId])
    );
    const subjectName = resolveSubjectName(
        instituteDetails?.subjects,
        subjectNamesById,
        overall.subjectId
    );

    // Out of = the paper's section totals; hidden when unknown.
    const paperTotalMarks = (assessmentDetails?.[1]?.saved_data.sections ?? []).reduce(
        (sum, section) => sum + (Number(section.total_marks) || 0),
        0
    );
    const score = studentReport.total_marks;
    const scorePct = paperTotalMarks > 0 ? (score / paperTotalMarks) * 100 : null;

    const startedAt = parseServerDate(overall.startTime);
    const submittedAt = parseServerDate(overall.submitTime);

    const attempted = overall.correctAttempt + overall.partialCorrectAttempt + overall.wrongAttempt;
    const totalQuestions = attempted + overall.skippedCount;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="no-scrollbar !m-0 flex max-h-dialog-tall w-dialog-xl flex-col !gap-0 overflow-y-auto !p-0">
                <DialogHeader>
                    <DialogTitle className="w-full bg-primary-50 px-6 py-4 text-h3 font-semibold text-primary-500">
                        {t('title')}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-6 p-6">
                    {/* Test, when, actions */}
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 flex-col gap-2">
                            <h2 className="text-h2 font-semibold text-neutral-800">
                                {studentReport.assessment_name}
                            </h2>
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-body text-neutral-500">
                                {subjectName && (
                                    <span className="flex items-center gap-1.5">
                                        <BookOpen size={16} />
                                        {subjectName}
                                    </span>
                                )}
                                {startedAt && (
                                    <span className="flex items-center gap-1.5">
                                        <CalendarBlank size={16} />
                                        {formatDate(startedAt)}
                                    </span>
                                )}
                                {startedAt && (
                                    <span className="flex items-center gap-1.5">
                                        <Clock size={16} />
                                        {submittedAt
                                            ? t('meta.timeRange', {
                                                  start: formatClock(startedAt),
                                                  end: formatClock(submittedAt),
                                              })
                                            : formatClock(startedAt)}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap items-start gap-2">
                            {studentReport.attempt_id && (
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    className="gap-1.5"
                                    onClick={openSubmission}
                                >
                                    <ArrowSquareOut size={16} />
                                    {t('openSubmission')}
                                </MyButton>
                            )}
                            <ExportDialogPDFCSV
                                handleExportPDF={() => exportPdf.mutate()}
                                isPDFLoading={exportPdf.status === 'pending'}
                                isEnablePDF={true}
                                isEnableCSV={false}
                            />
                        </div>
                    </div>

                    {/* Headline numbers */}
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <ProfileStat
                            label={t('stats.score')}
                            tone={scorePct == null ? 'neutral' : scoreTone(scorePct)}
                            value={
                                <span>
                                    {formatMark(score)}
                                    {paperTotalMarks > 0 && (
                                        <span className="text-body font-medium text-neutral-400">
                                            {` / ${formatMark(paperTotalMarks)}`}
                                        </span>
                                    )}
                                </span>
                            }
                        />
                        <ProfileStat
                            label={t('stats.rank')}
                            value={
                                <span className="flex items-center gap-1.5">
                                    {overall.rank === 1 && <Crown className="size-5" />}
                                    {overall.rank || '—'}
                                </span>
                            }
                        />
                        <ProfileStat
                            label={t('stats.percentile')}
                            value={`${formatMark(overall.percentile)}%`}
                        />
                        <ProfileStat
                            label={t('stats.timeTaken')}
                            value={formatDuration(t, overall.completionTimeInSeconds)}
                        />
                    </div>

                    {/* Breakdowns */}
                    <div className="grid gap-4 lg:grid-cols-2">
                        <BreakdownDonut
                            title={t('response.heading')}
                            centerValue={`${attempted}/${totalQuestions}`}
                            centerLabel={t('charts.attemptedCenter')}
                            slices={[
                                {
                                    key: 'attempted',
                                    label: t('charts.attempted'),
                                    value: attempted,
                                    tone: 'success',
                                },
                                {
                                    key: 'skipped',
                                    label: t('charts.skipped'),
                                    value: overall.skippedCount,
                                    tone: 'neutral',
                                },
                            ]}
                        />
                        <BreakdownDonut
                            title={t('marksBreakdown.heading')}
                            centerValue={formatMark(score)}
                            centerLabel={t('charts.marksCenter')}
                            slices={[
                                {
                                    key: 'correct',
                                    label: t('charts.correct'),
                                    value: overall.correctAttempt,
                                    tone: 'success',
                                    detail: `(${signedMark(overall.totalCorrectMarks)})`,
                                },
                                {
                                    key: 'partial',
                                    label: t('charts.partial'),
                                    value: overall.partialCorrectAttempt,
                                    tone: 'warning',
                                    detail: `(${signedMark(overall.totalPartialMarks)})`,
                                },
                                {
                                    key: 'wrong',
                                    label: t('charts.wrong'),
                                    value: overall.wrongAttempt,
                                    tone: 'danger',
                                    detail: `(${signedMark(overall.totalIncorrectMarks)})`,
                                },
                                {
                                    key: 'skipped',
                                    label: t('charts.skipped'),
                                    value: overall.skippedCount,
                                    tone: 'neutral',
                                },
                            ]}
                        />
                    </div>
                </div>

                {/* Answer review */}
                <div className="flex flex-col gap-4 border-t border-neutral-200 p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-h3 font-semibold text-primary-500">
                            {t('review.heading')}
                        </h3>
                        {questions.length > 0 && (
                            <ChipToggleGroup<ReviewFilter>
                                value={filter}
                                onChange={setFilter}
                                options={filterOptions}
                                ariaLabel={t('filter.ariaLabel')}
                            />
                        )}
                    </div>

                    {sections.length > 1 && (
                        <Tabs
                            value={activeSection}
                            onValueChange={(id) => {
                                setPickedSection(id);
                                setFilter('ALL');
                            }}
                        >
                            <TabsList className="inline-flex h-auto flex-wrap justify-start gap-2 rounded-none border-b !bg-transparent p-0">
                                {sections.map((section) => (
                                    <TabsTrigger
                                        key={section.id}
                                        value={section.id}
                                        className={cn(
                                            'rounded-none px-6 py-2 !shadow-none',
                                            activeSection === section.id
                                                ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50 text-primary-500'
                                                : 'border-none bg-transparent'
                                        )}
                                    >
                                        {section.name}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    )}

                    {questions.length === 0 ? (
                        <p className="py-6 text-center text-subtitle text-neutral-500">
                            {t('review.empty')}
                        </p>
                    ) : visibleQuestions.length === 0 ? (
                        <p className="py-6 text-center text-subtitle text-neutral-500">
                            {t('answer.noMatch')}
                        </p>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {visibleQuestions.map(({ question, number }) => (
                                <ReportQuestionCard
                                    key={`${question.question_id}-${number}`}
                                    question={question}
                                    number={number}
                                    paper={paperQuestion(
                                        paper,
                                        activeSection,
                                        question.question_id
                                    )}
                                    paperLoading={paperQuery.isLoading}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
