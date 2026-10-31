import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getAttemptDetails } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import {
    getAssessmentDetails,
    getQuestionDataForSection,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import PDFEvaluator from '@/routes/evaluation/evaluation-tool/-components/pdf-editor';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { getPublicUrl } from '@/services/upload_file';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { CaretLeft } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    readEvalReturnUrl,
    clearEvalReturnUrl,
} from '@/routes/evaluation/evaluation-tool/-utils/eval-return';
import { UploadAnswerSheetDialog } from './-components/UploadAnswerSheetDialog';
import { useTranslation } from 'react-i18next';

export const Route = createLazyFileRoute('/evaluation/evaluate/$assessmentId/$attemptId/$examType/')({
    component: () => (
        // Full-bleed workspace: the evaluator manages its own viewport-bounded
        // height + internal scrolling, so we drop the standard page margins.
        <LayoutContainer intrnalMargin={false}>
            <EvaluateAttemptComponent />
        </LayoutContainer>
    ),
});

// Return to wherever the admin launched the evaluator from (e.g. the assessment
// slide); otherwise just go back in history.
const goBack = () => {
    const returnUrl = readEvalReturnUrl();
    if (returnUrl) {
        clearEvalReturnUrl();
        window.location.assign(returnUrl);
    } else {
        window.history.back();
    }
};

const EvaluateAttemptComponent = () => {
    const { t } = useTranslation('evaluationAttemptIndex');
    const { attemptId, assessmentId, examType } = Route.useParams();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const [file, setFile] = useState<File | null>(null);
    const [fetchError, setFetchError] = useState(false);
    // markEvaluating=true: opening this evaluator workspace is what moves the
    // attempt's result status to EVALUATING (view-only screens fetch the same
    // endpoint without the flag and leave the status untouched).
    const { data: attemptDetails, isLoading: isAttemptLoading } = useSuspenseQuery(
        getAttemptDetails(attemptId, true)
    );
    // The student's answer file id. Initialised from the attempt, but can be set
    // by an admin uploading the answer sheet on the student's behalf.
    const [fileId, setFileId] = useState<string | undefined>(attemptDetails);
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        })
    );
    const { data: questionData, isLoading: isQuestionsLoading } = useSuspenseQuery(
        getQuestionDataForSection({
            assessmentId,
            sectionIds: assessmentDetails[1]?.saved_data.sections
                ?.map((section) => section.id)
                .join(','),
        })
    );

    const assessmentVisibility =
        assessmentDetails?.[1]?.saved_data?.assessment_visibility ??
        assessmentDetails?.[0]?.saved_data?.assessment_visibility;

    const { setNavHeading } = useNavHeadingStore();

    // Resolve the student's answer file id → public URL → File. Extracted so the
    // error state can offer a retry instead of an indefinite spinner. Accepts an
    // explicit id so a freshly admin-uploaded sheet loads without waiting on state.
    const loadFile = (id: string | undefined = fileId) => {
        setFetchError(false);
        getPublicUrl(id ?? '')
            .then((url) => {
                if (!url) throw new Error('No answer file available for this attempt');
                return fetch(url);
            })
            .then((response) => response.blob())
            .then((blob) => {
                setFile(
                    new File([blob], 'attempt_file', {
                        type: blob.type || 'application/octet-stream',
                    })
                );
            })
            .catch((error) => {
                console.error('Error fetching answer file:', error);
                setFetchError(true);
            });
    };

    useEffect(() => {
        setNavHeading(
            <div className="flex items-center gap-2">
                <CaretLeft onClick={goBack} className="cursor-pointer" />
                <h1 className="text-lg">{t('evaluateResponse')}</h1>
            </div>
        );
        if (!isAttemptLoading) {
            const timer = setTimeout(() => loadFile(), 100);
            return () => clearTimeout(timer);
        }
        return undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAttemptLoading]);

    // Load a sheet the admin just uploaded on the student's behalf, using the new
    // id directly so we don't have to wait on the cached attempt query.
    const handleAnswerSheetUploaded = (newFileId: string) => {
        setFileId(newFileId);
        loadFile(newFileId);
    };

    if (fetchError && !file) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-y-3 p-6 text-center">
                <h1 className="text-base font-semibold text-neutral-800">
                    {t('couldNotLoadAnswerSheet')}
                </h1>
                <p className="max-w-md text-sm text-neutral-500">{t('couldNotLoadAnswerSheetBody')}</p>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={goBack}>
                        {t('back')}
                    </MyButton>
                    <MyButton buttonType="secondary" scale="medium" onClick={() => loadFile()}>
                        {t('retry')}
                    </MyButton>
                    <UploadAnswerSheetDialog
                        attemptId={attemptId}
                        instituteId={instituteDetails?.id}
                        onUploaded={handleAnswerSheetUploaded}
                        trigger={
                            <MyButton buttonType="primary" scale="medium">
                                {t('uploadAnswerSheet')}
                            </MyButton>
                        }
                    />
                </div>
            </div>
        );
    }

    if (isLoading || isQuestionsLoading || isAttemptLoading || !file)
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-y-2">
                <h1>{t('gettingResponseFile')}</h1>
                <DashboardLoader />
            </div>
        );

    return (
        <>
            <Helmet>
                <title>{t('evaluateResponse')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            {file && (
                <PDFEvaluator
                    isFreeTool={false}
                    file={file}
                    fileId={fileId}
                    questionData={questionData}
                    assessmentId={assessmentId}
                    attemptId={attemptId}
                    instituteId={instituteDetails?.id}
                    examType={examType}
                    assessmentVisibility={assessmentVisibility}
                />
            )}
        </>
    );
};
