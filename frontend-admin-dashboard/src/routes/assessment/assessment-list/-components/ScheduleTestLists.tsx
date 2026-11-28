import { TabsContent } from '@/components/ui/tabs';
import { EmptyScheduleTest } from '@/svgs';
import { MyPagination } from '@/components/design-system/pagination';
import { ScheduleTestListsProps } from '@/types/assessments/schedule-test-list';
import ScheduleTestDetails from './ScheduleTestDetails';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { unresolvedSubjectIds, useSubjectNamesByIds } from '@/services/subject-names';
import { useTranslation } from 'react-i18next';
import { filterBySource } from '../-utils.ts/assessment-source';
import { useAssessmentFolderLinks } from '@/services/assessment-folders';
import { useAssessmentFolderUi } from './folders/assessment-folder-context';
import { DraggableAssessment } from './folders/DraggableAssessment';

const ScheduleTestLists: React.FC<ScheduleTestListsProps> = ({
    tab,
    pageNo,
    handlePageChange,
    selectedTab,
    handleRefetchData,
    sourceFilter = [],
}) => {
    const { t } = useTranslation('assessmentScheduleTestMainComponent');
    // Resolved once for the whole page rather than per card: the institute list is
    // deduplicated by subject name, so most stored subject ids are not in it and each
    // card would otherwise fire its own lookup for a single id.
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const subjectNamesById = useSubjectNamesByIds(
        unresolvedSubjectIds(
            instituteDetails?.subjects,
            tab.data.content.map((item) => item.subject_id)
        )
    );
    // Source (Dashboard / API) narrows the page the server returned: the list
    // endpoint has no source parameter yet. Pagination stays on the server's
    // pages so the other pages are still reachable when this one filters to empty.
    const visibleContent = filterBySource(tab.data.content, sourceFilter);
    // Folder of each card on this page (chip + drag source); only while folders are on.
    const folderUi = useAssessmentFolderUi();
    const { data: folderLinks } = useAssessmentFolderLinks(
        selectedTab === tab.value ? visibleContent.map((item) => item.assessment_id) : [],
        folderUi.enabled
    );
    const folderIdOf = (assessmentId: string) =>
        folderLinks?.find((link) => link.assessment_id === assessmentId)?.folder_id ?? null;
    return (
        <TabsContent key={tab.value} value={tab.value}>
            {tab.data.content.length === 0 ? (
                <div className="flex h-screen flex-col items-center justify-center">
                    <EmptyScheduleTest />
                    <span className="text-neutral-600">{tab.message}</span>
                </div>
            ) : (
                <div className="flex flex-col gap-4 pt-2">
                    {visibleContent.length === 0 && (
                        <div className="rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50/50 py-8 text-center text-sm text-neutral-500">
                            {t('filters.source.emptyOnPage')}
                        </div>
                    )}
                    {visibleContent.map((item, index) => {
                        const card = (
                            <ScheduleTestDetails
                                key={item.assessment_id ?? index}
                                scheduleTestContent={item}
                                selectedTab={selectedTab}
                                handleRefetchData={handleRefetchData}
                                subjectNamesById={subjectNamesById}
                                // Only in the flat "All tests" view; in folder views the scope already names it.
                                folderName={
                                    folderUi.showFolderChip
                                        ? folderUi.foldersById[folderIdOf(item.assessment_id) ?? '']
                                              ?.name
                                        : undefined
                                }
                            />
                        );
                        if (!folderUi.dragEnabled) return card;
                        return (
                            <DraggableAssessment
                                key={item.assessment_id ?? index}
                                assessmentId={item.assessment_id}
                                name={item.name}
                                folderId={folderIdOf(item.assessment_id)}
                            >
                                {card}
                            </DraggableAssessment>
                        );
                    })}
                    <MyPagination
                        currentPage={pageNo}
                        totalPages={Math.ceil(tab.data.total_pages)}
                        onPageChange={handlePageChange}
                    />
                </div>
            )}
        </TabsContent>
    );
};

export default ScheduleTestLists;
