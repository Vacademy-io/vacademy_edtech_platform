import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import {
    getAssessmentDetails,
    getQuestionDataForSection,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { useAssessmentActionVisibility } from '@/lib/display-settings/assessment-actions';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { DotIcon, DotIconOffline } from '@/svgs';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import {
    CaretLeft,
    CheckCircle,
    Export,
    Eye,
    LockSimple,
    PauseCircle,
    PencilSimpleLine,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import AssessmentPreview from './-components/AssessmentPreview';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReattemptRequestsTab } from './-components/ReattemptRequestsTab';
import { getPendingReattemptRequestCount } from '@/services/reattempt-requests';
import AssessmentOverviewTab from './-components/AssessmentOverviewTab';
import { AssessmentBasicInfoTab } from './-components/AssessmentBasicInfoTab';
import { AssessmentQuestionsTab } from './-components/AssessmentQuestionsTab';
import AssessmentSubmissionsTab from './-components/AssessmentSubmissionsTab';
import AssessmentParticipantsTab from './-components/AssessmentParticipantsTab';
import AssessmentAccessControlTab from './-components/AssessmentAccessControlTab';
import { SurveyMainOverviewTab } from './-components/survey/SurveyMainOverviewTab';
import { SurveyIndividualRespondentsTab } from './-components/survey/SurveyIndividualRespondentsTab';
import { OmrTab } from './-components/omr/OmrTab';

export const Route = createLazyFileRoute(
    '/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/'
)({
    component: () => (
        <LayoutContainer>
            <AssessmentDetailsComponent />
        </LayoutContainer>
    ),
});

const buildHeading = (t: TFunction) => (
    <div className="flex items-center gap-4">
        <CaretLeft onClick={() => window.history.back()} className="cursor-pointer" />
        <h1 className="text-lg">{t('heading.title')}</h1>
    </div>
);

// Helper components for better organization
const AssessmentHeader = ({ assessmentDetails }: { assessmentDetails: any }) => {
    const getVisibilityBadgeClass = (visibility: string) => {
        return visibility === 'PRIVATE' ? 'bg-primary-50' : 'bg-info-50';
    };

    const getModeBadgeClass = (mode: string) => {
        return mode !== 'EXAM' ? 'bg-neutral-50' : 'bg-success-50';
    };

    const getStatusBadgeClass = (status: string) => {
        return status === 'COMPLETED' ? 'bg-success-50' : 'bg-neutral-100';
    };

    const getStatusIcon = (status: string) => {
        return status === 'COMPLETED' ? (
            <CheckCircle size={14} weight="fill" className="text-success-600" />
        ) : (
            <PauseCircle size={14} weight="fill" className="text-neutral-400" />
        );
    };

    const getModeIcon = (mode: string) => {
        return mode === 'EXAM' ? <DotIcon /> : <DotIconOffline />;
    };

    // One shared chip style, so the three facts read as a single meta line rather than
    // three unrelated badges.
    const chipClass =
        'gap-1.5 rounded-md border border-neutral-200 px-2 py-1 text-caption font-medium capitalize text-neutral-600 shadow-none';

    return (
        <div className="flex min-w-0 flex-col gap-2.5">
            <h1 className="line-clamp-2 text-h3 font-semibold leading-tight text-neutral-700 sm:text-h2">
                {assessmentDetails[0]?.saved_data.name}
            </h1>
            {/* Meta sits under the title rather than beside it. Full-size badges on the
                same line as the name had three secondary facts competing with the one
                thing that actually identifies the page. */}
            <div className="flex flex-wrap items-center gap-2">
                <Badge
                    className={`${chipClass} ${getModeBadgeClass(
                        assessmentDetails[0]?.saved_data.assessment_mode
                    )}`}
                >
                    {getModeIcon(assessmentDetails[0]?.saved_data.assessment_mode)}
                    {assessmentDetails[0]?.saved_data.assessment_mode?.toLowerCase()}
                </Badge>
                <Badge
                    className={`${chipClass} ${getVisibilityBadgeClass(
                        assessmentDetails[0]?.saved_data.assessment_visibility
                    )}`}
                >
                    <LockSimple size={14} />
                    {assessmentDetails[0]?.saved_data.assessment_visibility?.toLowerCase()}
                </Badge>
                <Badge
                    className={`${chipClass} ${getStatusBadgeClass(assessmentDetails?.[0]?.status)}`}
                >
                    {getStatusIcon(assessmentDetails?.[0]?.status)}
                    {assessmentDetails?.[0]?.status?.toLowerCase()}
                </Badge>
            </div>
        </div>
    );
};

const AssessmentActions = ({
    isPreviewAssessmentDialogOpen,
    setIsPreviewAssessmentDialogOpen,
    questionsDataSectionWise,
    assessmentId,
}: {
    isPreviewAssessmentDialogOpen: boolean;
    setIsPreviewAssessmentDialogOpen: (open: boolean) => void;
    questionsDataSectionWise: any;
    assessmentId: string;
}) => {
    const { t } = useTranslation('assessmentTabIndex');
    const navigate = useNavigate();

    const handleOpenDialog = () => {
        if (Object.keys(questionsDataSectionWise).length === 0) {
            toast.error(t('actions.noSectionsError'));
        } else {
            setIsPreviewAssessmentDialogOpen(true);
        }
    };

    const handleExportAssessment = () => {
        if (Object.keys(questionsDataSectionWise).length === 0) {
            toast.error(t('actions.noSectionsError'));
        } else {
            navigate({
                to: '/assessment/export/$assessmentId',
                params: {
                    assessmentId: assessmentId,
                },
            });
        }
    };

    return (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
            <Dialog
                open={isPreviewAssessmentDialogOpen}
                onOpenChange={setIsPreviewAssessmentDialogOpen}
            >
                {/* asChild: DialogTrigger renders its own <button>, so wrapping MyButton
                    without it nested a button inside a button — invalid DOM, and React
                    warns about exactly this elsewhere on the dashboard. */}
                <DialogTrigger asChild>
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={handleOpenDialog}
                        className="gap-2 sm:min-w-fit"
                    >
                        <Eye size={18} />
                        {t('actions.preview')}
                    </MyButton>
                </DialogTrigger>
                {Object.keys(questionsDataSectionWise).length > 0 && (
                    <DialogContent className="no-scrollbar !m-0 flex max-h-dialog-tall !w-dialog-xl !max-w-full flex-col !gap-0 overflow-hidden !p-0 [&>button]:hidden">
                        <AssessmentPreview
                            handleCloseDialog={() => setIsPreviewAssessmentDialogOpen(false)}
                        />
                    </DialogContent>
                )}
            </Dialog>
            <MyButton
                scale="medium"
                onClick={handleExportAssessment}
                className="gap-2 sm:min-w-fit"
            >
                <Export size={18} />
                {t('actions.exportOffline')}
            </MyButton>
        </div>
    );
};

const AssessmentDetailsComponent = () => {
    const { t } = useTranslation('assessmentTabIndex');
    const { assessmentId, examType, assesssmentType, assessmentTab } = Route.useParams();
    const { canEdit } = useAssessmentActionVisibility();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    // Pending learner reattempt requests for THIS assessment, shown as a badge on the tab.
    // Scoped by assessmentId to match the list the tab renders — the institute-wide count is the
    // same number on every assessment's page, which badged exams that had no request of their own.
    // Polled rather than fetched once: an admin sitting on this page during a live exam is
    // exactly who needs to see a request arrive, and that is when they come in.
    const { data: pendingReattemptCount = 0 } = useQuery({
        queryKey: ['reattempt-requests-pending-count', instituteDetails?.id, assessmentId],
        queryFn: () => getPendingReattemptRequestCount(instituteDetails?.id ?? '', assessmentId),
        enabled: Boolean(instituteDetails?.id),
        refetchInterval: 60_000,
    });
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        })
    );

    const { data: questionsDataSectionWise, isLoading: isQuestionsLoading } = useSuspenseQuery(
        getQuestionDataForSection({
            assessmentId,
            sectionIds: assessmentDetails[1]?.saved_data.sections
                ?.map((section) => section.id)
                .join(','),
        })
    );

    const navigate = useNavigate();
    // Pen-and-paper MCQ exams get an extra tab for their sets, sheets and scans.
    const isOmrMode = assessmentDetails[0]?.saved_data?.omr_mode === true;
    // Honor the details tab requested in the route (e.g. the slide's "View
    // Submissions" deep-links with assessmentTab='submissions'). List-page entry
    // points pass a list-tab name (liveTests/upcomingTests/…) which isn't a
    // details tab, so those fall through to 'overview' — the prior default.
    const detailsTabs = [
        'overview',
        'submissions',
        'basicInfo',
        'questions',
        'participants',
        'accessControl',
        ...(isOmrMode ? ['omr'] : []),
    ];
    const [selectedTab, setSelectedTab] = useState(
        detailsTabs.includes(assessmentTab) ? assessmentTab : 'overview'
    );
    const { setNavHeading } = useNavHeadingStore();

    const handleNavigateToSteps = () => {
        const tabMapping: Record<string, number> = {
            basicInfo: 0,
            questions: 1,
            participants: 2,
            accessControl: 3,
        };

        navigate({
            to: '/assessment/create-assessment/$assessmentId/$examtype',
            params: {
                assessmentId: assessmentId,
                examtype: examType,
            },
            search: {
                currentStep: tabMapping[selectedTab] ?? 0, // Default to 0 if tab is not found
            },
        });
    };

    const [isPreviewAssessmentDialogOpen, setIsPreviewAssessmentDialogOpen] = useState(false);

    useEffect(() => {
        setNavHeading(buildHeading(t));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Underline tabs. The previous folder-tab treatment (rounded top, tinted fill, border
    // on three sides) fought with the card the whole page sits in.
    const mainTabClass = (value: string) =>
        `relative flex items-center rounded-none border-b-2 px-4 py-2.5 text-body !shadow-none transition-colors ${
            selectedTab === value
                ? 'border-primary-500 !bg-transparent font-medium text-primary-500'
                : 'border-transparent !bg-transparent text-neutral-600 hover:text-neutral-700'
        }`;

    if (isLoading || isQuestionsLoading) return <DashboardLoader />;

    return (
        <>
            <Helmet>
                <title>{t('helmet.title')}</title>
                <meta name="description" content={t('helmet.description')} />
            </Helmet>
            <div>
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                    <AssessmentHeader assessmentDetails={assessmentDetails} />
                    <AssessmentActions
                        isPreviewAssessmentDialogOpen={isPreviewAssessmentDialogOpen}
                        setIsPreviewAssessmentDialogOpen={setIsPreviewAssessmentDialogOpen}
                        questionsDataSectionWise={questionsDataSectionWise}
                        assessmentId={assessmentId}
                    />
                </div>
                <Tabs value={selectedTab} onValueChange={setSelectedTab}>
                    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                        {/* The five primary tabs stay on the bar; the three configuration
                            tabs move into a Settings menu. With all seven inline the bar
                            scrolled sideways and clipped "Access Control" off the edge. The
                            pending-reattempt badge rides the Settings trigger, so a learner
                            waiting on a request is still visible while the tab is collapsed. */}
                        <TabsList className="mt-6 flex h-auto w-full flex-wrap justify-start gap-0 rounded-none border-b border-neutral-200 !bg-transparent p-0">
                            <TabsTrigger value="overview" className={mainTabClass('overview')}>
                                {t('tabs.overview')}
                            </TabsTrigger>
                            {assessmentTab !== 'upcomingTests' && (
                                <TabsTrigger
                                    value="submissions"
                                    className={mainTabClass('submissions')}
                                >
                                    {examType === 'SURVEY'
                                        ? t('tabs.individualRespondents')
                                        : t('tabs.submissions')}
                                </TabsTrigger>
                            )}
                            <TabsTrigger value="questions" className={mainTabClass('questions')}>
                                {t('tabs.questions')}
                            </TabsTrigger>
                            <TabsTrigger
                                value="participants"
                                className={mainTabClass('participants')}
                            >
                                {t('tabs.participants')}
                            </TabsTrigger>
                            <TabsTrigger value="basicInfo" className={mainTabClass('basicInfo')}>
                                {t('tabs.basicInfo')}
                            </TabsTrigger>
                            <TabsTrigger
                                value="accessControl"
                                className={mainTabClass('accessControl')}
                            >
                                {t('tabs.accessControl')}
                            </TabsTrigger>
                            {isOmrMode && (
                                <TabsTrigger value="omr" className={mainTabClass('omr')}>
                                    {t('tabs.omr')}
                                </TabsTrigger>
                            )}
                            <TabsTrigger
                                value="reattemptRequests"
                                className={`${mainTabClass('reattemptRequests')} gap-1.5`}
                            >
                                {t('tabs.reattemptRequests')}
                                {/* The in-app alert that learners are waiting. Without it an
                                    admin only finds out via whatever the workflow emails them. */}
                                {pendingReattemptCount > 0 && (
                                    <span className="rounded-full bg-danger-500 px-1.5 py-0.5 text-2xs font-semibold text-white">
                                        {pendingReattemptCount}
                                    </span>
                                )}
                            </TabsTrigger>
                        </TabsList>
                        {canEdit &&
                            selectedTab !== 'overview' &&
                            selectedTab !== 'submissions' &&
                            selectedTab !== 'omr' && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <MyButton
                                        type="button"
                                        scale="medium"
                                        layoutVariant="icon"
                                        buttonType="secondary"
                                        className="shrink-0 self-start sm:self-center"
                                        aria-label={t('actions.editAssessment')}
                                        onClick={handleNavigateToSteps}
                                    >
                                        <PencilSimpleLine size={18} />
                                    </MyButton>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                    {t('actions.editAssessment')}
                                </TooltipContent>
                            </Tooltip>
                        )}
                    </div>
                    {/* No height cap and no scroller of its own: capping tab content at
                        72vh and hiding its scrollbar left a dead white band between the
                        end of the content and the bottom of the page, and chained the
                        wheel across two nested scrollers. The page scrolls normally. */}
                    <div className="pe-8">
                        <TabsContent value="overview">
                            {examType === 'SURVEY' ? (
                                <SurveyMainOverviewTab
                                    assessmentId={assessmentId}
                                    sectionIds={assessmentDetails[1]?.saved_data.sections
                                        ?.map((section) => section.id)
                                        .join(',')}
                                    assessmentName={assessmentDetails[0]?.saved_data?.name || ''}
                                    assessmentDetails={{
                                        assessment_visibility:
                                            assessmentDetails[1]?.saved_data?.assessment_visibility,
                                        live_assessment_access: {
                                            batch_ids:
                                                assessmentDetails[1]?.saved_data
                                                    ?.live_assessment_access?.batch_ids ?? [],
                                        },
                                    }}
                                />
                            ) : (
                                <AssessmentOverviewTab />
                            )}
                        </TabsContent>
                        <TabsContent value="submissions">
                            {examType === 'SURVEY' ? (
                                <SurveyIndividualRespondentsTab
                                    assessmentId={assessmentId}
                                    sectionIds={assessmentDetails[1]?.saved_data.sections
                                        ?.map((section) => section.id)
                                        .join(',')}
                                    assessmentName={assessmentDetails[0]?.saved_data?.name || ''}
                                    assessmentDetails={{
                                        assessment_visibility:
                                            assessmentDetails[1]?.saved_data?.assessment_visibility,
                                        live_assessment_access: {
                                            batch_ids:
                                                assessmentDetails[1]?.saved_data
                                                    ?.live_assessment_access?.batch_ids ?? [],
                                        },
                                    }}
                                />
                            ) : (
                                <AssessmentSubmissionsTab type={assesssmentType} />
                            )}
                        </TabsContent>
                        <TabsContent value="basicInfo">
                            <AssessmentBasicInfoTab />
                        </TabsContent>
                        <TabsContent value="questions">
                            <AssessmentQuestionsTab />
                        </TabsContent>
                        <TabsContent value="participants">
                            <AssessmentParticipantsTab />
                        </TabsContent>
                        <TabsContent value="accessControl">
                            <AssessmentAccessControlTab />
                        </TabsContent>
                        {isOmrMode && (
                            <TabsContent value="omr">
                                <OmrTab
                                    assessmentId={assessmentId}
                                    instituteId={instituteDetails?.id ?? ''}
                                />
                            </TabsContent>
                        )}
                        <TabsContent value="reattemptRequests">
                            <ReattemptRequestsTab />
                        </TabsContent>
                    </div>
                </Tabs>
            </div>
        </>
    );
};
