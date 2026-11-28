import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
    getAssessmentDetails,
    getQuestionDataForSection,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import {
    CaretLeft,
    CheckCircle,
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
import AssessmentOverviewTab from './-components/AssessmentOverviewTab';
import { AssessmentBasicInfoTab } from './-components/AssessmentBasicInfoTab';
import { AssessmentQuestionsTab } from './-components/AssessmentQuestionsTab';
import AssessmentSubmissionsTab from './-components/AssessmentSubmissionsTab';
import AssessmentParticipantsTab from './-components/AssessmentParticipantsTab';
import AssessmentAccessControlTab from './-components/AssessmentAccessControlTab';

export const Route = createLazyFileRoute(
    '/homework-creation/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/'
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

const AssessmentDetailsComponent = () => {
    const { t } = useTranslation('homeworkCreationAssessmentTabIndex');
    const { assessmentId, examType, assesssmentType, assessmentTab } = Route.useParams();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
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
    const [selectedTab, setSelectedTab] = useState('overview');
    const { setNavHeading } = useNavHeadingStore();

    const handleNavigateToSteps = () => {
        const tabMapping: Record<string, number> = {
            basicInfo: 0,
            questions: 1,
            participants: 2,
            accessControl: 3,
        };

        navigate({
            to: '/homework-creation/create-assessment/$assessmentId/$examtype',
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

    const handleOpenDialog = () => {
        if (Object.keys(questionsDataSectionWise).length === 0) {
            toast.error(t('actions.noSectionsError'));
        } else {
            setIsPreviewAssessmentDialogOpen(true);
        }
    };
    const handleCloseDialog = () => setIsPreviewAssessmentDialogOpen(false);
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
    useEffect(() => {
        setNavHeading(buildHeading(t));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (isLoading || isQuestionsLoading) return <DashboardLoader />;

    return (
        <>
            <Helmet>
                <title>{t('helmet.title')}</title>
                <meta name="description" content={t('helmet.description')} />
            </Helmet>
            <div>
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <h1 className="font-semibold">{assessmentDetails[0]?.saved_data.name}</h1>
                        <Badge
                            className={`rounded-md border border-neutral-300 ${
                                assessmentDetails[0]?.saved_data.assessment_visibility === 'PRIVATE'
                                    ? 'bg-primary-50'
                                    : 'bg-info-50'
                            } py-1.5 shadow-none`}
                        >
                            <LockSimple size={16} className="mr-2" />
                            {t(
                                `badge.visibility.${assessmentDetails[0]?.saved_data.assessment_visibility}`,
                                {
                                    defaultValue: assessmentDetails[0]?.saved_data
                                        .assessment_visibility,
                                }
                            )}
                        </Badge>
                        <Separator orientation="vertical" className="h-8 w-px bg-neutral-300" />
                        <Badge
                            className={`rounded-md border ${
                                assessmentDetails?.[0]?.status === 'COMPLETED'
                                    ? 'bg-success-50'
                                    : 'bg-neutral-100'
                            } border-neutral-300 py-1.5 shadow-none`}
                        >
                            {assessmentDetails?.[0]?.status === 'COMPLETED' ? (
                                <CheckCircle
                                    size={16}
                                    weight="fill"
                                    className="mr-2 text-success-600"
                                />
                            ) : (
                                <PauseCircle
                                    size={16}
                                    weight="fill"
                                    className="mr-2 text-neutral-400"
                                />
                            )}
                            {t(`badge.status.${assessmentDetails?.[0]?.status}`, {
                                defaultValue: assessmentDetails?.[0]?.status,
                            })}
                        </Badge>
                    </div>
                    <div className="flex flex-col items-center gap-y-2">
                        <Dialog
                            open={isPreviewAssessmentDialogOpen}
                            onOpenChange={setIsPreviewAssessmentDialogOpen}
                        >
                            <DialogTrigger>
                                <MyButton
                                    type="button"
                                    scale="large"
                                    buttonType="secondary"
                                    onClick={handleOpenDialog}
                                >
                                    {t('actions.previewHomework')}
                                </MyButton>
                            </DialogTrigger>
                            {Object.keys(questionsDataSectionWise).length > 0 && (
                                <DialogContent className="no-scrollbar !m-0 max-h-dialog-tall !w-dialog-xl !max-w-full !gap-0 overflow-y-auto !p-0 [&>button]:hidden">
                                    <AssessmentPreview handleCloseDialog={handleCloseDialog} />
                                </DialogContent>
                            )}
                        </Dialog>
                        <MyButton scale="large" onClick={handleExportAssessment} className="py-4">
                            {t('actions.exportOffline')}
                        </MyButton>
                    </div>
                </div>
                <Separator className="mt-4" />
                <Tabs value={selectedTab} onValueChange={setSelectedTab}>
                    <div className="flex items-center justify-between gap-2">
                        <TabsList className="mb-2 mt-6 inline-flex h-auto justify-start gap-0 rounded-none border-b !bg-transparent p-0">
                            <TabsTrigger
                                value="overview"
                                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                    selectedTab === 'overview'
                                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                        : 'border-none bg-transparent'
                                }`}
                            >
                                <span
                                    className={`${
                                        selectedTab === 'overview' ? 'text-primary-500' : ''
                                    }`}
                                >
                                    {t('tabs.overview')}
                                </span>
                            </TabsTrigger>
                            {assessmentTab !== 'upcomingTests' && (
                                <TabsTrigger
                                    value="submissions"
                                    className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                        selectedTab === 'submissions'
                                            ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                            : 'border-none bg-transparent'
                                    }`}
                                >
                                    <span
                                        className={`${
                                            selectedTab === 'submissions' ? 'text-primary-500' : ''
                                        }`}
                                    >
                                        {t('tabs.submissions')}
                                    </span>
                                </TabsTrigger>
                            )}
                            <TabsTrigger
                                value="basicInfo"
                                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                    selectedTab === 'basicInfo'
                                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                        : 'border-none bg-transparent'
                                }`}
                            >
                                <span
                                    className={`${
                                        selectedTab === 'basicInfo' ? 'text-primary-500' : ''
                                    }`}
                                >
                                    {t('tabs.basicInfo')}
                                </span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="questions"
                                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                    selectedTab === 'questions'
                                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                        : 'border-none bg-transparent'
                                }`}
                            >
                                <span
                                    className={`${
                                        selectedTab === 'questions' ? 'text-primary-500' : ''
                                    }`}
                                >
                                    {t('tabs.questions')}
                                </span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="participants"
                                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                    selectedTab === 'participants'
                                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                        : 'border-none bg-transparent'
                                }`}
                            >
                                <span
                                    className={`${
                                        selectedTab === 'participants' ? 'text-primary-500' : ''
                                    }`}
                                >
                                    {t('tabs.participants')}
                                </span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="accessControl"
                                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                    selectedTab === 'accessControl'
                                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                        : 'border-none bg-transparent'
                                }`}
                            >
                                <span
                                    className={`${
                                        selectedTab === 'accessControl' ? 'text-primary-500' : ''
                                    }`}
                                >
                                    {t('tabs.accessControl')}
                                </span>
                            </TabsTrigger>
                        </TabsList>
                        {selectedTab !== 'overview' && selectedTab !== 'submissions' && (
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="secondary"
                                className="mt-4 w-10 min-w-10 font-medium"
                                onClick={handleNavigateToSteps}
                            >
                                <PencilSimpleLine size={32} />
                            </MyButton>
                        )}
                    </div>
                    <div className="max-h-dialog-tall overflow-y-auto pe-8">
                        <TabsContent value="overview">
                            <AssessmentOverviewTab />
                        </TabsContent>
                        <TabsContent value="submissions">
                            <AssessmentSubmissionsTab type={assesssmentType} />
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
                    </div>
                </Tabs>
            </div>
        </>
    );
};
