import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { getAssessmentDetails } from '../../create-assessment/$assessmentId/$examtype/-services/assessment-services';
import PreviewAndExport from '@/components/common/export-offline';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect } from 'react';
import { CaretLeft } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
    getOmrSetPaper,
    omrErrorMessage,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/omr-services';

export const exportAssessmentSearchSchema = z.object({
    /** A saved OMR paper set: print that set in its saved question / option order. */
    omrSetId: z.string().optional(),
    /** With omrSetId: open on the answer key of that set. */
    answerKey: z.coerce.boolean().optional(),
});

export const Route = createFileRoute('/assessment/export/$assessmentId/')({
    validateSearch: exportAssessmentSearchSchema,
    component: () => (
        <LayoutContainer>
            <RouteComponent />
        </LayoutContainer>
    ),
});

function RouteComponent() {
    const { t } = useTranslation('assessmentExportIndex');
    const { assessmentId } = Route.useParams();
    const { omrSetId, answerKey } = Route.useSearch();
    const { setNavHeading } = useNavHeadingStore();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { data: assessmentDetails, isLoading: isAssessmentDetailsLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteDetails?.id,
            type: 'EXAM',
        })
    );
    // The saved order of one OMR set (questions numbered as on its bubble sheet).
    const {
        data: omrPaper,
        isLoading: isOmrPaperLoading,
        error: omrPaperError,
    } = useQuery({
        queryKey: ['OMR_SET_PAPER', assessmentId, omrSetId, instituteDetails?.id],
        queryFn: () => getOmrSetPaper(assessmentId, instituteDetails?.id ?? '', omrSetId ?? ''),
        enabled: !!omrSetId && !!instituteDetails?.id,
    });

    useEffect(() => {
        setNavHeading(
            <div className="flex items-center gap-4">
                <CaretLeft onClick={() => window.history.back()} className="cursor-pointer" />
                <h1 className="text-lg">{t('pageHeading')}</h1>
            </div>
        );
    }, []);

    if (isAssessmentDetailsLoading || (omrSetId && isOmrPaperLoading)) return <DashboardLoader />;
    if (omrSetId && (omrPaperError || !omrPaper)) {
        return (
            <p className="p-6 text-sm text-danger-600">
                {omrErrorMessage(omrPaperError, 'Could not load this OMR set.')}
            </p>
        );
    }
    return (
        <PreviewAndExport
            // A different set (or key vs paper) starts from fresh export settings.
            key={omrSetId ? `${omrSetId}:${answerKey ? 'key' : 'paper'}` : 'default'}
            assessmentId={assessmentId}
            sectionIds={
                assessmentDetails[1]?.saved_data?.sections?.map((section) => section.id) || []
            }
            assessmentDetails={assessmentDetails}
            // instructions={assessmentDetails[1]?.saved_data?.instructions ?? {}}
            sections={assessmentDetails[1]?.saved_data?.sections ?? []}
            omrPaper={omrSetId ? omrPaper : undefined}
            omrAnswerKey={answerKey === true}
        />
    );
}
