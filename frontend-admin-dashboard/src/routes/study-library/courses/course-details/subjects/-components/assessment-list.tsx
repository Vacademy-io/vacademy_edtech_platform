import { useState } from 'react';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useAssessmentFoldersEnabled } from '@/services/assessment-folders';
import { ScheduleTestMainComponent } from '@/routes/assessment/assessment-list/-components/ScheduleTestMainComponent';
import { AssessmentFolderWorkspace } from '@/routes/assessment/assessment-list/-components/folders/AssessmentFolderWorkspace';

const Assessments = ({ packageSessionId }: { packageSessionId: string }) => {
    const foldersEnabled = useAssessmentFoldersEnabled();
    // Open folder lives in state, not the URL: the workspace's default would leave the course.
    const [folderKey, setFolderKey] = useState('all');

    // Wait for the setting, or the list would mount flat and then remount in the workspace.
    if (foldersEnabled === undefined) return <DashboardLoader />;

    if (!foldersEnabled) {
        return (
            <ScheduleTestMainComponent
                batchId={packageSessionId}
                isCourseOutline
                showBatchFilter={false}
            />
        );
    }

    return (
        <AssessmentFolderWorkspace
            key={packageSessionId}
            folderKey={folderKey}
            onSelectFolder={setFolderKey}
            batchId={packageSessionId}
            renderList={({ key, folderFilter, toolbar, hideList }) => (
                <ScheduleTestMainComponent
                    key={key}
                    batchId={packageSessionId}
                    isCourseOutline
                    showBatchFilter={false}
                    folderFilter={folderFilter}
                    toolbar={toolbar}
                    hideList={hideList}
                />
            )}
        />
    );
};

export default Assessments;
