import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    CheckCircle,
    FileText,
    Clock,
    Gauge,
    TrendDown,
    Sigma,
    Target,
    Shuffle,
    Medal,
    ListChecks,
} from '@phosphor-icons/react';
import { Section } from '@/types/assessments/assessment-data-type';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Route } from '..';
import {
    getAssessmentDetails,
    getQuestionDataForSection,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import {
    calculateTotalMarks,
    getQuestionTypeCounts,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/helper';
import { calculateAverageMarks, calculateAveragePenalty } from '../-utils/helper';
import { QuestionData } from '@/types/assessments/assessment-steps';
import {
    QuestionOptionsList,
    optionsFromQuestionData,
    type QuestionOptionView,
} from '@/components/common/assessment/question-options-list';
import { useMemo, useState, useEffect } from 'react';
import TipTapEditor from '@/components/tiptap/TipTapEditor';
import { CriteriaPreviewDialog } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-components/StepComponents/-components/CriteriaPreviewDialog';
import {
    CriteriaJson,
    parseCriteria,
    CriteriaSource,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/criteria-services';
import { CriteriaStatusBadge } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-components/StepComponents/-components/CriteriaStatusBadge';
import { AddEditCriteriaDialog } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-components/StepComponents/-components/AddEditCriteriaDialog';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { sanitizeRichHtml } from '@/lib/sanitize-html';

interface QuestionDuration {
    hrs: string;
    min: string;
}

interface Question {
    questionId: string;
    questionName: string;
    questionType: string;
    questionMark: string;
    questionPenalty: string;
    questionDuration: QuestionDuration;
    evaluation_criteria_json?: string | null;
    criteria_template_id?: string | null; // From API, indicates if from template
    options?: QuestionOptionView[];
}

// Custom hook for data transformation
const useAdaptiveMarking = (questionsForSection: QuestionData[]) => {
    return useMemo(() => {
        return questionsForSection.map((questionData: QuestionData) => {
            const markingJson = questionData.marking_json
                ? JSON.parse(questionData.marking_json)
                : {};
            return {
                questionId: questionData.question_id || '',
                questionName: questionData.question?.content || '',
                questionType: questionData.question_type || '',
                questionMark: markingJson.data?.totalMark || '0',
                questionPenalty: markingJson.data?.negativeMark || '0',
                questionDuration: {
                    hrs:
                        typeof questionData.question_duration === 'number'
                            ? String(Math.floor(questionData.question_duration / 60))
                            : '0',
                    min:
                        typeof questionData.question_duration === 'number'
                            ? String(questionData.question_duration % 60)
                            : '0',
                },
                evaluation_criteria_json: questionData.evaluation_criteria_json || null,
                criteria_template_id: questionData.criteria_template_id || null,
                options: optionsFromQuestionData(questionData),
            };
        });
    }, [questionsForSection]);
};

const StatTile = ({
    icon: Icon,
    label,
    value,
    accent = 'primary',
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string | number;
    accent?: 'primary' | 'rose' | 'amber' | 'emerald';
}) => {
    const accentMap = {
        primary: 'bg-primary-50 text-primary-500',
        rose: 'bg-rose-50 text-rose-500',
        amber: 'bg-amber-50 text-amber-600',
        emerald: 'bg-emerald-50 text-emerald-600',
    } as const;
    return (
        <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex items-start gap-3 p-4">
                <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accentMap[accent]}`}
                >
                    <Icon className="h-4 w-4" />
                </div>
                <div className="flex min-w-0 flex-col">
                    <p className="text-caption font-medium uppercase tracking-wider text-slate-500">
                        {label}
                    </p>
                    <p className="truncate text-lg font-bold tabular-nums text-slate-900">
                        {value}
                    </p>
                </div>
            </CardContent>
        </Card>
    );
};

const FeatureBadge = ({
    icon: Icon,
    label,
    value,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value?: string | number;
}) => (
    <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
        {value !== undefined && (
            <span className="rounded-full bg-white/70 px-1.5 py-0.5 font-semibold tabular-nums">
                {value}
            </span>
        )}
        <CheckCircle className="h-3.5 w-3.5" />
    </div>
);

// Component for section info display
const SectionInfo = ({
    section,
    adaptiveMarking,
    examType,
    assessmentDetails,
}: {
    section: Section;
    adaptiveMarking: Question[];
    examType: string;
    assessmentDetails: any;
}) => {
    const { t } = useTranslation('assessmentQuestionsSection');
    const avgMarks = calculateAverageMarks(adaptiveMarking);
    const totalMarks = calculateTotalMarks(adaptiveMarking);
    const avgPenalty = calculateAveragePenalty(adaptiveMarking);
    const showSectionDuration =
        assessmentDetails[1]?.saved_data?.duration_distribution === 'SECTION' && section.duration;

    return (
        <div className="flex flex-col gap-4">
            {section?.description?.content && (
                <Card className="border-slate-200 shadow-sm">
                    <CardContent className="p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 text-slate-500" />
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                {t('sectionInfo.descriptionTitle')}
                            </h4>
                        </div>
                        <div
                            className="custom-html-content prose prose-sm max-w-none text-sm text-slate-700"
                            dangerouslySetInnerHTML={{
                                __html: sanitizeRichHtml(section.description.content),
                            }}
                        />
                    </CardContent>
                </Card>
            )}

            {(showSectionDuration || examType !== 'SURVEY') && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {showSectionDuration && (
                        <StatTile
                            icon={Clock}
                            label={t('stats.sectionDuration.label')}
                            value={t('stats.sectionDuration.value', { duration: section.duration })}
                            accent="primary"
                        />
                    )}
                    {examType !== 'SURVEY' && (
                        <StatTile
                            icon={Gauge}
                            label={t('stats.avgMarksPerQuestion')}
                            value={avgMarks}
                            accent="primary"
                        />
                    )}
                    {examType !== 'SURVEY' && (
                        <StatTile
                            icon={Sigma}
                            label={t('stats.totalMarks')}
                            value={totalMarks}
                            accent="amber"
                        />
                    )}
                    {avgPenalty > 0 && (
                        <StatTile
                            icon={TrendDown}
                            label={t('stats.negativeMarking')}
                            value={avgPenalty}
                            accent="rose"
                        />
                    )}
                </div>
            )}

            {(section.partial_marking ||
                section.cutoff_marks > 0 ||
                section.problem_randomization) && (
                <div className="flex flex-wrap gap-2">
                    {section.partial_marking && (
                        <FeatureBadge icon={Medal} label={t('badges.partialMarking')} />
                    )}
                    {section.cutoff_marks > 0 && (
                        <FeatureBadge
                            icon={Target}
                            label={t('badges.cutoffMarks')}
                            value={section.cutoff_marks}
                        />
                    )}
                    {section.problem_randomization && (
                        <FeatureBadge icon={Shuffle} label={t('badges.problemRandomization')} />
                    )}
                </div>
            )}
        </div>
    );
};

// Component for questions table
const QuestionsTable = ({
    adaptiveMarking,
    examType,
    assessmentDetails,
}: {
    adaptiveMarking: Question[];
    examType: string;
    assessmentDetails: any;
}) => {
    const { t } = useTranslation('assessmentQuestionsSection');
    const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
    const [criteriaPreview, setCriteriaPreview] = useState<CriteriaJson | null>(null);
    const [criteriaDialogOpen, setCriteriaDialogOpen] = useState(false);
    const [selectedQuestionIndex, setSelectedQuestionIndex] = useState<number | null>(null);
    const [localAdaptiveMarking, setLocalAdaptiveMarking] = useState(adaptiveMarking);

    // Update local state when prop changes
    useEffect(() => {
        setLocalAdaptiveMarking(adaptiveMarking);
    }, [adaptiveMarking]);

    if (localAdaptiveMarking.length === 0) return null;

    const handlePreviewCriteria = (evaluation_criteria_json: string | null | undefined) => {
        if (!evaluation_criteria_json) return;

        const parsed = parseCriteria(evaluation_criteria_json);

        // Validate parsed criteria structure
        if (!parsed || !parsed.criteria || !Array.isArray(parsed.criteria)) {
            console.error('Invalid criteria structure:', parsed);
            toast.error(t('toasts.invalidCriteriaFormat'));
            return;
        }

        setCriteriaPreview(parsed);
        setPreviewDialogOpen(true);
    };

    const handleEditCriteria = (questionIndex: number) => {
        setSelectedQuestionIndex(questionIndex);
        setCriteriaDialogOpen(true);
    };

    const handleSaveCriteria = (criteria: CriteriaJson | null, source: CriteriaSource) => {
        if (selectedQuestionIndex === null) return;

        const updated = [...localAdaptiveMarking];
        updated[selectedQuestionIndex] = {
            ...updated[selectedQuestionIndex]!,
            evaluation_criteria_json: criteria ? JSON.stringify(criteria) : null,
        } as Question;
        setLocalAdaptiveMarking(updated);
        setCriteriaDialogOpen(false);
    };

    const selectedQuestion =
        selectedQuestionIndex !== null ? localAdaptiveMarking[selectedQuestionIndex] : null;

    return (
        <div>
            <div className="mb-3 flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-900">
                    {examType === 'SURVEY'
                        ? t('table.heading.survey')
                        : t('table.heading.adaptiveMarking')}
                </h3>
                <Badge
                    variant="secondary"
                    className="bg-slate-100 font-semibold tabular-nums text-slate-600 hover:bg-slate-100"
                >
                    {localAdaptiveMarking.length}
                </Badge>
            </div>
            <Card className="overflow-hidden border-slate-200 shadow-sm">
                <div className="scrollbar-hide overflow-x-auto">
                    <Table>
                        <TableHeader className="bg-slate-50">
                            <TableRow className="border-b border-slate-200 hover:bg-slate-50">
                                <TableHead className="w-16 text-xs font-semibold uppercase tracking-wider text-slate-600">
                                    {t('table.columns.index')}
                                </TableHead>
                                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                    {t('table.columns.question')}
                                </TableHead>
                                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                    {t('table.columns.type')}
                                </TableHead>
                                {examType !== 'SURVEY' && (
                                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                        {t('table.columns.marks')}
                                    </TableHead>
                                )}
                                {examType !== 'SURVEY' && (
                                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                        {t('table.columns.penalty')}
                                    </TableHead>
                                )}
                                {examType !== 'SURVEY' && (
                                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                        {t('table.columns.criteria')}
                                    </TableHead>
                                )}
                                {assessmentDetails[1]?.saved_data?.duration_distribution ===
                                    'QUESTION' && (
                                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                        {t('table.columns.time')}
                                    </TableHead>
                                )}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {localAdaptiveMarking.map((question: Question, index: number) => {
                                return (
                                    <TableRow
                                        key={index}
                                        className="border-b border-slate-100 transition-colors hover:bg-primary-50/30"
                                    >
                                        <TableCell className="align-top">
                                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-50 text-xs font-semibold text-primary-600">
                                                {index + 1}
                                            </div>
                                        </TableCell>
                                        <TableCell className="max-w-md align-top text-sm text-slate-900">
                                            <TipTapEditor
                                                value={question.questionName || ''}
                                                onChange={() => {}}
                                                editable={false}
                                            />
                                            <QuestionOptionsList options={question.options} />
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <Badge
                                                variant="secondary"
                                                className="bg-slate-100 font-medium text-slate-700 hover:bg-slate-100"
                                            >
                                                {question.questionType}
                                            </Badge>
                                        </TableCell>
                                        {examType !== 'SURVEY' && (
                                            <TableCell className="align-top text-sm font-semibold tabular-nums text-slate-900">
                                                {question.questionMark}
                                            </TableCell>
                                        )}
                                        {examType !== 'SURVEY' && (
                                            <TableCell className="align-top text-sm tabular-nums text-rose-600">
                                                {Number(question.questionPenalty) > 0
                                                    ? `-${question.questionPenalty}`
                                                    : question.questionPenalty}
                                            </TableCell>
                                        )}
                                        {examType !== 'SURVEY' && (
                                            <TableCell className="align-top">
                                                {question.evaluation_criteria_json ? (
                                                    <CriteriaStatusBadge
                                                        status={
                                                            question.criteria_template_id
                                                                ? 'template'
                                                                : 'manual'
                                                        }
                                                        onClick={() => handleEditCriteria(index)}
                                                        onPreview={() =>
                                                            handlePreviewCriteria(
                                                                question.evaluation_criteria_json
                                                            )
                                                        }
                                                    />
                                                ) : (
                                                    <span className="text-xs italic text-slate-400">
                                                        {t('table.criteriaNotSet')}
                                                    </span>
                                                )}
                                            </TableCell>
                                        )}
                                        {assessmentDetails[1]?.saved_data?.duration_distribution ===
                                            'QUESTION' && (
                                            <TableCell className="align-top">
                                                <div className="flex items-center gap-1 text-sm tabular-nums text-slate-700">
                                                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                                                    {question.questionDuration.hrs}:
                                                    {question.questionDuration.min}
                                                </div>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </Card>

            {/* Criteria Preview Dialog */}
            <CriteriaPreviewDialog
                criteria={criteriaPreview}
                open={previewDialogOpen}
                onClose={() => setPreviewDialogOpen(false)}
            />

            {/* Add/Edit Criteria Dialog */}
            {selectedQuestion && (
                <AddEditCriteriaDialog
                    question={{
                        id: selectedQuestion.questionId,
                        text: selectedQuestion.questionName,
                        question_type: selectedQuestion.questionType,
                        max_marks: parseFloat(selectedQuestion.questionMark) || 0,
                        subject: '', // Can be enhanced if subject data is available
                    }}
                    existingCriteria={
                        selectedQuestion.evaluation_criteria_json
                            ? (parseCriteria(selectedQuestion.evaluation_criteria_json) ?? undefined)
                            : undefined
                    }
                    open={criteriaDialogOpen}
                    onSave={handleSaveCriteria}
                    onClose={() => setCriteriaDialogOpen(false)}
                />
            )}
        </div>
    );
};

const AssessmentQuestionsSection = ({ section, index }: { section: Section; index: number }) => {
    const { t } = useTranslation('assessmentQuestionsSection');
    const { assessmentId, examType } = Route.useParams();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { data: assessmentDetails, isLoading: isAssessmentDetailsLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        })
    );
    const { data: questionsData, isLoading } = useSuspenseQuery(
        getQuestionDataForSection({ assessmentId, sectionIds: section.id })
    );

    const questionsForSection = questionsData[section.id] || [];
    const adaptiveMarking = useAdaptiveMarking(questionsForSection);

    if (isLoading || isAssessmentDetailsLoading) return <DashboardLoader />;

    const counts = getQuestionTypeCounts(adaptiveMarking);

    return (
        <AccordionItem
            value={`section-${index}`}
            key={index}
            className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm last:mb-0"
        >
            <AccordionTrigger className="px-5 py-4 hover:no-underline [&[data-state=open]]:border-b [&[data-state=open]]:border-slate-100">
                <div className="flex w-full items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-sm font-bold text-primary-600">
                            {index + 1}
                        </div>
                        <div className="flex min-w-0 flex-col items-start">
                            <h3 className="truncate text-base font-semibold text-slate-900">
                                {section.name}
                            </h3>
                            <p className="text-xs text-slate-500">
                                {t('accordion.questionCount', { count: counts.totalQuestions })}
                            </p>
                        </div>
                    </div>
                    <div className="hidden flex-wrap items-center gap-2 pr-2 sm:flex">
                        {counts.MCQS > 0 && (
                            <Badge
                                variant="secondary"
                                className="bg-sky-50 font-medium text-sky-700 hover:bg-sky-50"
                            >
                                {t('accordion.mcqSingle', { count: counts.MCQS })}
                            </Badge>
                        )}
                        {counts.MCQM > 0 && (
                            <Badge
                                variant="secondary"
                                className="bg-violet-50 font-medium text-violet-700 hover:bg-violet-50"
                            >
                                {t('accordion.mcqMultiple', { count: counts.MCQM })}
                            </Badge>
                        )}
                        <Badge className="bg-primary-500 font-semibold tabular-nums text-white hover:bg-primary-500">
                            {t('accordion.total', { count: counts.totalQuestions })}
                        </Badge>
                    </div>
                </div>
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-6 bg-slate-50/40 px-5 py-5">
                <SectionInfo
                    section={section}
                    adaptiveMarking={adaptiveMarking}
                    examType={examType}
                    assessmentDetails={assessmentDetails}
                />
                <QuestionsTable
                    adaptiveMarking={adaptiveMarking}
                    examType={examType}
                    assessmentDetails={assessmentDetails}
                />
                {adaptiveMarking.length > 0 && examType !== 'SURVEY' && (
                    <div className="flex items-center justify-end">
                        <div className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2">
                            <Sigma className="h-4 w-4 text-primary-600" />
                            <span className="text-xs font-medium uppercase tracking-wider text-primary-700">
                                {t('sectionTotal')}
                            </span>
                            <span className="text-lg font-bold tabular-nums text-primary-700">
                                {calculateTotalMarks(adaptiveMarking)}
                            </span>
                        </div>
                    </div>
                )}
            </AccordionContent>
        </AccordionItem>
    );
};

export default AssessmentQuestionsSection;
