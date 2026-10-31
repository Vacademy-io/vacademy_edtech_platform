import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import TimelineReports from './timelineReports';
import ProgressReports from './progressReports';
import BatchAiAnalysis from './batchAiAnalysis';
import LearnerProgressReports from './learnerProgressReports';
import { UsersThree } from '@phosphor-icons/react';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useLearnerProgressReportEnabled } from './useLearnerProgressReportEnabled';

interface BatchReportsProps {
    /**
     * Scopes all report tabs to a single batch and hides the
     * course/session/level pickers. Used by Course Details → Reports, where the
     * batch is already implied by the page.
     */
    packageSessionId?: string;
    /** Course id backing `packageSessionId`, used only to title the reports. */
    courseId?: string;
}

export default function BatchReports({ packageSessionId, courseId }: BatchReportsProps = {}) {
    const { t } = useTranslation('studyLibraryBatchReports');
    // Per-role Display Setting (Settings → Display → Course Page Settings).
    // Defaults to on, so existing institutes keep the tab without touching config.
    const showLearnerProgress = useLearnerProgressReportEnabled();

    return (
        <div className="w-full">
            <Tabs
                defaultValue={showLearnerProgress ? 'learners' : 'timeline'}
                className="w-full"
            >
                {/* Modern Tab Navigation with Institute Theme */}
                <div className="border-b border-neutral-200 bg-white px-6 py-4">
                    <TabsList className="h-11 bg-neutral-100 p-1 rounded-lg shadow-sm">
                        {showLearnerProgress && (
                            <TabsTrigger
                                value="learners"
                                className="flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-primary-50 hover:text-primary-600 data-[state=active]:bg-primary-500 data-[state=active]:text-white data-[state=active]:shadow-sm"
                            >
                                <UsersThree size={16} />
                                {t('progressTabLabel', {
                                    term: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
                                })}
                            </TabsTrigger>
                        )}
                        <TabsTrigger
                            value="timeline"
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-all duration-200 data-[state=active]:bg-primary-500 data-[state=active]:text-white data-[state=active]:shadow-sm hover:bg-primary-50 hover:text-primary-600"
                        >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {t('learningTimeline')}
                        </TabsTrigger>
                        <TabsTrigger 
                            value="progress" 
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-all duration-200 data-[state=active]:bg-primary-500 data-[state=active]:text-white data-[state=active]:shadow-sm hover:bg-primary-50 hover:text-primary-600"
                        >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            {t('learningProgress')}
                        </TabsTrigger>
                        <TabsTrigger
                            value="ai-analysis"
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-all duration-200 data-[state=active]:bg-primary-500 data-[state=active]:text-white data-[state=active]:shadow-sm hover:bg-primary-50 hover:text-primary-600"
                        >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                            </svg>
                            {t('aiAnalysis')}
                        </TabsTrigger>
                    </TabsList>
                </div>
                
                {/* Tab Content */}
                <div className="bg-white">
                    {showLearnerProgress && (
                        <TabsContent
                            value="learners"
                            className="mt-0 p-6 focus-visible:outline-none"
                        >
                            {/* No packageSessionId (Learning Reports page) → the
                                component shows its own multi-batch picker. */}
                            <LearnerProgressReports
                                packageSessionId={packageSessionId}
                                courseId={courseId}
                            />
                        </TabsContent>
                    )}

                    <TabsContent value="timeline" className="mt-0 p-6 focus-visible:outline-none">
                        <TimelineReports
                            fixedPackageSessionId={packageSessionId}
                            fixedCourseId={courseId}
                        />
                    </TabsContent>
                    
                    <TabsContent value="progress" className="mt-0 p-6 focus-visible:outline-none">
                        <ProgressReports
                            fixedPackageSessionId={packageSessionId}
                            fixedCourseId={courseId}
                        />
                    </TabsContent>

                    <TabsContent value="ai-analysis" className="mt-0 p-6 focus-visible:outline-none">
                        <BatchAiAnalysis fixedPackageSessionId={packageSessionId} />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
