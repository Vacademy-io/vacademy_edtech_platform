import { TabsContent } from '@/components/ui/tabs';
import { EmptyScheduleTest } from '@/svgs';
import { MyPagination } from '@/components/design-system/pagination';
import { ScheduleTestListsProps } from '@/types/assessments/schedule-test-list';
import ScheduleTestDetails from './ScheduleTestDetails';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { unresolvedSubjectIds, useSubjectNamesByIds } from '@/services/subject-names';

const ScheduleTestLists: React.FC<ScheduleTestListsProps> = ({
    tab,
    pageNo,
    handlePageChange,
    selectedTab,
    handleRefetchData,
}) => {
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
    return (
        <TabsContent key={tab.value} value={tab.value}>
            {tab.data.content.length === 0 ? (
                <div className="flex h-screen flex-col items-center justify-center">
                    <EmptyScheduleTest />
                    <span className="text-neutral-600">{tab.message}</span>
                </div>
            ) : (
                <>
                    {tab.data.content.map((item, index) => (
                        <ScheduleTestDetails
                            key={index}
                            scheduleTestContent={item}
                            selectedTab={selectedTab}
                            handleRefetchData={handleRefetchData}
                            subjectNamesById={subjectNamesById}
                        />
                    ))}
                    <MyPagination
                        currentPage={pageNo}
                        totalPages={Math.ceil(tab.data.total_pages)}
                        onPageChange={handlePageChange}
                    />
                </>
            )}
        </TabsContent>
    );
};

export default ScheduleTestLists;
