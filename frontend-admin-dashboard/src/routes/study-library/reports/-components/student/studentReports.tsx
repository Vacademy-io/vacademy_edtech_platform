import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import TimelineReports from './timelineReports';
import ProgressReports from './progressReports';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearch } from '@tanstack/react-router';
import { Route } from '@/routes/study-library/reports';

export default function StudentReports() {
    const { t } = useTranslation('studyLibraryStudentReports');
    const search = useSearch({ from: Route.id });
    // The Tabs values below are lowercase ('timeline' / 'progress'); profile
    // navigation now sends lowercase too but old links may still use uppercase
    // 'TIMELINE' / 'PROGRESS'. Normalize so either form selects the right tab.
    const requestedTab = (search.studentReport?.learningTab || '').toLowerCase();
    const [learningData, setLearningData] = useState(
        requestedTab === 'progress' ? 'progress' : 'timeline'
    );

    return (
        <div className="w-full">
            <Tabs value={learningData} onValueChange={setLearningData} className="w-full">
                {/* Modern Tab Navigation with Institute Theme */}
                <div className="border-b border-neutral-200 bg-white px-6 py-4">
                    <TabsList className="h-11 bg-neutral-100 p-1 rounded-lg shadow-sm">
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
                    </TabsList>
                </div>
                
                {/* Tab Content */}
                <div className="bg-white">
                    <TabsContent value="timeline" className="mt-0 p-6 focus-visible:outline-none">
                        <TimelineReports />
                    </TabsContent>
                    
                    <TabsContent value="progress" className="mt-0 p-6 focus-visible:outline-none">
                        <ProgressReports />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
