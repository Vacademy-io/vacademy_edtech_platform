import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEffect, useState } from 'react';
import { DotOutline } from '@phosphor-icons/react';
import { Separator } from '@/components/ui/separator';
import { MyButton } from '@/components/design-system/button';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { QuestionInsightsAnalysisChartComponent } from './QuestionInsightsAnalysisChartComponent';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { getInstituteId } from '@/constants/helper';
import { Route } from '..';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { getAssessmentDetails } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import {
    getQuestionsInsightsData,
    handleGetQuestionInsightsData,
    handleGetStudentQuestionInsightsExportPDF,
} from '../-services/assessment-details-services';
import {
    getCorrectOptionsForQuestion,
    transformQuestionInsightsQuestionsData,
} from '../-utils/helper';
import QuestionAssessmentStatus from './QuestionAssessmentStatus';
import { toast } from 'sonner';
import ExportDialogPDFCSV from '@/components/common/export-dialog-pdf-csv';
import { useTranslation } from 'react-i18next';

export function QuestionInsightsComponent() {
    const { t } = useTranslation('homeworkCreationQuestionInsights');
    const instituteId = getInstituteId();
    const { assessmentId, examType, assesssmentType } = Route.useParams();
    const { data: assessmentDetails } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteId,
            type: examType,
        })
    );
    const sectionsInfo = assessmentDetails[1]?.saved_data.sections?.map((section) => ({
        name: section.name,
        id: section.id,
    }));

    const [selectedSection, setSelectedSection] = useState(sectionsInfo ? sectionsInfo[0]?.id : '');

    const { data } = useSuspenseQuery(
        handleGetQuestionInsightsData({ instituteId, assessmentId, sectionId: selectedSection })
    );

    const [selectedSectionData, setSelectedSectionData] = useState(
        transformQuestionInsightsQuestionsData(data?.question_insight_dto)
    );

    const getQuestionInsightsData = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            sectionId,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
            sectionId: string | undefined;
        }) => getQuestionsInsightsData(assessmentId, instituteId, sectionId),
        onSuccess: (data) => {
            setSelectedSectionData(
                transformQuestionInsightsQuestionsData(data?.question_insight_dto)
            );
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleRefreshLeaderboard = () => {
        getQuestionInsightsData.mutate({
            assessmentId: assessmentId ? assessmentId : '',
            instituteId,
            sectionId: selectedSection,
        });
    };

    const getExportQuestionInsightsDataPDF = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            sectionIds,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
            sectionIds: string;
        }) => handleGetStudentQuestionInsightsExportPDF(assessmentId, instituteId, sectionIds),
        onSuccess: async (response) => {
            const date = new Date();
            const url = window.URL.createObjectURL(new Blob([response]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute(
                'download',
                `pdf_student_question_insights_report_${date.toLocaleString()}.pdf`
            );
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.success(t('toasts.exportPdfSuccess'));
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleExportPDF = () => {
        getExportQuestionInsightsDataPDF.mutate({
            assessmentId,
            instituteId,
            sectionIds:
                assessmentDetails[1]?.saved_data.sections?.map((section) => section.id).join(',') ||
                '',
        });
    };

    useEffect(() => {
        setSelectedSectionData(transformQuestionInsightsQuestionsData(data?.question_insight_dto));
    }, [selectedSection]);

    return (
        <Tabs value={selectedSection} onValueChange={setSelectedSection} className="px-8">
            <div className="sticky top-0 flex items-center justify-between">
                <TabsList className="mb-2 mt-6 inline-flex h-auto justify-start gap-4 rounded-none border-b !bg-transparent p-0">
                    {sectionsInfo?.map((section) => (
                        <TabsTrigger
                            key={section.id}
                            value={section.id}
                            className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                selectedSection === section.id
                                    ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                    : 'border-none bg-transparent'
                            }`}
                        >
                            <span
                                className={`${
                                    selectedSection === section.id ? 'text-primary-500' : ''
                                }`}
                            >
                                {section.name}
                            </span>
                        </TabsTrigger>
                    ))}
                </TabsList>
                <div className="mt-3 flex items-center gap-6">
                    <ExportDialogPDFCSV
                        handleExportPDF={handleExportPDF}
                        isPDFLoading={
                            getExportQuestionInsightsDataPDF.status === 'pending' ? true : false
                        }
                        isEnablePDF={true}
                        isEnableCSV={false}
                    />
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="secondary"
                        className="min-w-8 font-medium"
                        onClick={handleRefreshLeaderboard}
                    >
                        <ArrowCounterClockwise size={32} />
                    </MyButton>
                </div>
            </div>
            <TabsContent
                value={selectedSection || ''}
                className="max-h-dialog-tall overflow-y-auto"
            >
                {selectedSectionData.map((question, index) => (
                    <div key={index}>
                        <div className="flex w-full items-start justify-between gap-8">
                            <div className="my-4 flex w-1/2 flex-col gap-8 p-2">
                                <h3>
                                    {t('question.label', { number: index + 1 })}
                                    <span
                                        dangerouslySetInnerHTML={{
                                            __html:
                                                question.assessment_question_preview_dto
                                                    .questionName || '',
                                        }}
                                    />
                                </h3>
                                <div className="flex flex-nowrap items-center gap-8 text-sm font-semibold">
                                    <p className="whitespace-nowrap font-normal">
                                        {t('question.correctAnswer')}
                                    </p>
                                    <p className="flex w-full flex-col items-center gap-4 rounded-md bg-primary-50 p-4">
                                        {getCorrectOptionsForQuestion(
                                            question.assessment_question_preview_dto
                                                .questionType === 'MCQM'
                                                ? question.assessment_question_preview_dto
                                                      .multipleChoiceOptions
                                                : question.assessment_question_preview_dto
                                                      .singleChoiceOptions
                                        )?.map(
                                            (
                                                option: {
                                                    optionType: string;
                                                    optionName: string | undefined;
                                                } | null,
                                                idx: number
                                            ) => {
                                                return (
                                                    <div
                                                        className="flex w-full items-center justify-start"
                                                        key={idx}
                                                    >
                                                        <span>({option?.optionType}.)&nbsp;</span>
                                                        <span
                                                            dangerouslySetInnerHTML={{
                                                                __html: option?.optionName || '',
                                                            }}
                                                        />
                                                    </div>
                                                );
                                            }
                                        )}
                                    </p>
                                </div>
                                {question.assessment_question_preview_dto.explanation && (
                                    <p className="flex items-start gap-14 text-sm text-gray-600">
                                        <span>{t('question.explanation')}</span>
                                        <span>
                                            {question.assessment_question_preview_dto.explanation}
                                        </span>
                                    </p>
                                )}
                                {question.top3_correct_response_dto &&
                                    question.top3_correct_response_dto.length > 0 && (
                                        <div className="flex flex-col gap-2">
                                            <h3 className="text-primary-500">
                                                {t('question.topCorrectResponses')}
                                            </h3>
                                            <div className="flex flex-wrap items-center gap-4">
                                                {question.top3_correct_response_dto?.map(
                                                    (response, responseIdx) => {
                                                        return (
                                                            <div
                                                                key={responseIdx}
                                                                className="flex items-center whitespace-nowrap rounded-md border p-2 text-sm"
                                                            >
                                                                <h1>{response.name}</h1>
                                                                &nbsp;:&nbsp;
                                                                <h1>
                                                                    {t('question.responseTime', {
                                                                        count: response.timeTakenInSeconds,
                                                                    })}
                                                                </h1>
                                                            </div>
                                                        );
                                                    }
                                                )}
                                            </div>
                                        </div>
                                    )}
                            </div>
                            <div className="-mt-2 flex w-1/2 flex-col">
                                <QuestionInsightsAnalysisChartComponent
                                    questionStatus={question.question_status}
                                    skipped={question.skipped}
                                />
                                <div className="flex flex-col justify-center">
                                    <h1 className="text-center font-semibold text-neutral-500">
                                        {t('stats.totalAttempts', {
                                            count: question.total_attempts,
                                        })}
                                    </h1>
                                    <div className="flex flex-col">
                                        <div className="-mb-8 flex items-center justify-between">
                                            <div className="flex items-center">
                                                <DotOutline
                                                    size={70}
                                                    weight="fill"
                                                    className="text-success-400"
                                                />
                                                <p>{t('stats.correctRespondents')}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <p>{question.question_status?.correctAttempt}</p>
                                                <p>
                                                    (
                                                    {question?.total_attempts
                                                        ? (
                                                              (question.question_status
                                                                  ?.correctAttempt /
                                                                  (question.question_status
                                                                      ?.correctAttempt +
                                                                      question.question_status
                                                                          ?.partialCorrectAttempt +
                                                                      question.question_status
                                                                          ?.incorrectAttempt +
                                                                      question?.skipped)) *
                                                              100
                                                          ).toFixed(2) + '%'
                                                        : t('stats.notAvailable')}
                                                    )
                                                </p>
                                                <Dialog>
                                                    <DialogTrigger>
                                                        <p className="text-sm text-primary-500">
                                                            {t('stats.viewList')}
                                                        </p>
                                                    </DialogTrigger>
                                                    <DialogContent className="no-scrollbar !m-0 flex max-h-dialog-tall !w-dialog-xl flex-col items-start !gap-0 overflow-y-auto !p-0">
                                                        <h1 className="h-14 w-full bg-primary-50 p-4 font-semibold text-primary-500">
                                                            {t('dialog.correctRespondents')}
                                                        </h1>
                                                        <QuestionAssessmentStatus
                                                            assessmentId={assessmentId}
                                                            sectionId={selectedSection}
                                                            questionId={
                                                                question
                                                                    .assessment_question_preview_dto
                                                                    .questionId
                                                            }
                                                            assesssmentType={assesssmentType}
                                                            questionStatus="CORRECT"
                                                        />
                                                    </DialogContent>
                                                </Dialog>
                                            </div>
                                        </div>
                                        <div className="-mb-8 flex items-center justify-between gap-4">
                                            <div className="flex items-center">
                                                <DotOutline
                                                    size={70}
                                                    weight="fill"
                                                    className="text-warning-400"
                                                />
                                                <p>{t('stats.partiallyCorrectRespondents')}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <p>
                                                    {
                                                        question.question_status
                                                            ?.partialCorrectAttempt
                                                    }
                                                </p>
                                                <p>
                                                    (
                                                    {question?.total_attempts
                                                        ? (
                                                              (question.question_status
                                                                  ?.partialCorrectAttempt /
                                                                  (question.question_status
                                                                      ?.correctAttempt +
                                                                      question.question_status
                                                                          ?.partialCorrectAttempt +
                                                                      question.question_status
                                                                          ?.incorrectAttempt +
                                                                      question?.skipped)) *
                                                              100
                                                          ).toFixed(2) + '%'
                                                        : t('stats.notAvailable')}
                                                    )
                                                </p>
                                                <Dialog>
                                                    <DialogTrigger>
                                                        <p className="text-sm text-primary-500">
                                                            {t('stats.viewList')}
                                                        </p>
                                                    </DialogTrigger>
                                                    <DialogContent className="no-scrollbar !m-0 flex max-h-dialog-tall !w-dialog-xl flex-col items-start !gap-0 overflow-y-auto !p-0">
                                                        <h1 className="h-14 w-full bg-primary-50 p-4 font-semibold text-primary-500">
                                                            {t('dialog.partiallyCorrectRespondents')}
                                                        </h1>
                                                        <QuestionAssessmentStatus
                                                            assessmentId={assessmentId}
                                                            sectionId={selectedSection}
                                                            questionId={
                                                                question
                                                                    .assessment_question_preview_dto
                                                                    .questionId
                                                            }
                                                            assesssmentType={assesssmentType}
                                                            questionStatus="PARTIAL_CORRECT"
                                                        />
                                                    </DialogContent>
                                                </Dialog>
                                            </div>
                                        </div>
                                        <div className="-mb-8 flex items-center justify-between">
                                            <div className="flex items-center">
                                                <DotOutline
                                                    size={70}
                                                    weight="fill"
                                                    className="text-danger-400"
                                                />
                                                <p>{t('stats.wrongRespondents')}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <p>{question.question_status?.incorrectAttempt}</p>
                                                <p>
                                                    (
                                                    {question?.total_attempts
                                                        ? (
                                                              (question.question_status
                                                                  ?.incorrectAttempt /
                                                                  (question.question_status
                                                                      ?.correctAttempt +
                                                                      question.question_status
                                                                          ?.partialCorrectAttempt +
                                                                      question.question_status
                                                                          ?.incorrectAttempt +
                                                                      question?.skipped)) *
                                                              100
                                                          ).toFixed(2) + '%'
                                                        : t('stats.notAvailable')}
                                                    )
                                                </p>
                                                <Dialog>
                                                    <DialogTrigger>
                                                        <p className="text-sm text-primary-500">
                                                            {t('stats.viewList')}
                                                        </p>
                                                    </DialogTrigger>
                                                    <DialogContent className="no-scrollbar !m-0 flex max-h-dialog-tall !w-dialog-xl flex-col items-start !gap-0 overflow-y-auto !p-0">
                                                        <h1 className="h-14 w-full bg-primary-50 p-4 font-semibold text-primary-500">
                                                            {t('dialog.wrongRespondents')}
                                                        </h1>
                                                        <QuestionAssessmentStatus
                                                            assessmentId={assessmentId}
                                                            sectionId={selectedSection}
                                                            questionId={
                                                                question
                                                                    .assessment_question_preview_dto
                                                                    .questionId
                                                            }
                                                            assesssmentType={assesssmentType}
                                                            questionStatus="INCORRECT"
                                                        />
                                                    </DialogContent>
                                                </Dialog>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center">
                                                <DotOutline
                                                    size={70}
                                                    weight="fill"
                                                    className="text-neutral-200"
                                                />
                                                <p>{t('stats.skipped')}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <p>{question.skipped}</p>
                                                <p>
                                                    (
                                                    {question?.total_attempts
                                                        ? (
                                                              (question?.skipped /
                                                                  (question.question_status
                                                                      ?.correctAttempt +
                                                                      question.question_status
                                                                          ?.partialCorrectAttempt +
                                                                      question.question_status
                                                                          ?.incorrectAttempt +
                                                                      question?.skipped)) *
                                                              100
                                                          ).toFixed(2) + '%'
                                                        : t('stats.notAvailable')}
                                                    )
                                                </p>
                                                <Dialog>
                                                    <DialogTrigger>
                                                        <p className="text-sm text-primary-500">
                                                            {t('stats.viewList')}
                                                        </p>
                                                    </DialogTrigger>
                                                    <DialogContent className="no-scrollbar !m-0 flex max-h-dialog-tall !w-dialog-xl flex-col items-start !gap-0 overflow-y-auto !p-0">
                                                        <h1 className="h-14 w-full bg-primary-50 p-4 font-semibold text-primary-500">
                                                            {t('dialog.skippedRespondents')}
                                                        </h1>
                                                        <QuestionAssessmentStatus
                                                            assessmentId={assessmentId}
                                                            sectionId={selectedSection}
                                                            questionId={
                                                                question
                                                                    .assessment_question_preview_dto
                                                                    .questionId
                                                            }
                                                            assesssmentType={assesssmentType}
                                                            questionStatus="PENDING"
                                                        />
                                                    </DialogContent>
                                                </Dialog>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <Separator className="my-8" />
                    </div>
                ))}
            </TabsContent>
        </Tabs>
    );
}
