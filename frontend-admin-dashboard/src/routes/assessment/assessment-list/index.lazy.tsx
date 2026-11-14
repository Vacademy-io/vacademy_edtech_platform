import { useEffect } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useAssessmentFoldersEnabled } from '@/services/assessment-folders';
import { ScheduleTestMainComponent } from './-components/ScheduleTestMainComponent';
import { AssessmentFolderWorkspace } from './-components/folders/AssessmentFolderWorkspace';
import { usePendingFolderPrompt } from '@/components/common/assessment-folders/pending-folder-prompt';

export const Route = createLazyFileRoute('/assessment/assessment-list/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { folderId } = Route.useSearch();
    const foldersEnabled = useAssessmentFoldersEnabled();

    // Folders off: drop the wizard's "pick a folder" request instead of keeping it for later.
    useEffect(() => {
        if (foldersEnabled === false) usePendingFolderPrompt.getState().setPending(null);
    }, [foldersEnabled]);

    // Wait for the setting, or the list would mount flat and then remount in the workspace.
    if (foldersEnabled === undefined) {
        return (
            <LayoutContainer>
                <DashboardLoader />
            </LayoutContainer>
        );
    }

    return (
        <LayoutContainer>
            {foldersEnabled ? (
                <AssessmentFolderWorkspace
                    folderKey={folderId || 'all'}
                    renderList={({ key, folderFilter, toolbar, hideList }) => (
                        <ScheduleTestMainComponent
                            key={key}
                            folderFilter={folderFilter}
                            toolbar={toolbar}
                            hideList={hideList}
                        />
                    )}
                />
            ) : (
                <ScheduleTestMainComponent />
            )}
        </LayoutContainer>
    );
}
