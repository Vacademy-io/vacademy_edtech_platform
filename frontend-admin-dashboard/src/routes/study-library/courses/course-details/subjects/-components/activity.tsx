import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useListPlanningLogs } from '@/routes/planning/-services/listPlanningLogs';
import PlanningLogsTimeline from '@/routes/planning/-components/PlanningLogsTimeline';
import CreateActivityDialog from '@/routes/planning/-components/CreateActivityDialog';
import ViewPlanningDialog from '@/routes/planning/-components/ViewPlanningDialog';
import type { PlanningLog } from '@/routes/planning/-types/types';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useDeletePlanningLog } from '@/routes/planning/-services/updatePlanningLog';
import { MyButton } from '@/components/design-system/button';
import { useNavigate } from '@tanstack/react-router';

interface ActivityProps {
    packageSessionId: string;
}

export default function Activity({ packageSessionId }: ActivityProps) {
    const { t } = useTranslation('studyLibraryActivity');
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [viewDialogOpen, setViewDialogOpen] = useState(false);
    const [selectedLog, setSelectedLog] = useState<PlanningLog | null>(null);
    const [pageNo, setPageNo] = useState(0);
    const deleteMutation = useDeletePlanningLog();
    const navigate = useNavigate();
    const pageSize = 10;
    const { data, isLoading, refetch } = useListPlanningLogs({
        pageNo,
        pageSize,
        filters: {
            entity_ids: [packageSessionId],
            log_types: ['diary_log'],
            interval_types: ['daily'],
            statuses: ['ACTIVE'],
        },
    });

    const handleView = (log: PlanningLog) => {
        setSelectedLog(log);
        setViewDialogOpen(true);
    };

    const handleDelete = (log: PlanningLog) => {
        deleteMutation.mutate(log.id, {
            onSuccess: () => {
                refetch();
            },
        });
    };

    const handleSuccess = () => {
        refetch();
    };

    const handlePageChange = (newPage: number) => {
        setPageNo(newPage);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{t('activityLogs')}</h3>
                <div className="flex items-center space-x-2">
                    <MyButton scale="small" onClick={() => setCreateDialogOpen(true)} size="sm">
                        <Plus className="h-4 w-4" />
                        {t('create')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() =>
                            navigate({
                                to: '/planning/activity-logs',
                                search: { packageSessionId },
                            })
                        }
                        size="sm"
                    >
                        {t('viewAll')}
                    </MyButton>
                </div>
            </div>

            {isLoading ? (
                <div className="py-8 text-center">
                    <p className="text-muted-foreground">{t('loadingActivityLogs')}</p>
                </div>
            ) : (
                <PlanningLogsTimeline
                    data={data?.content || []}
                    totalPages={data?.totalPages || 0}
                    currentPage={pageNo}
                    onPageChange={handlePageChange}
                    searchQuery=""
                    logType="diary_log"
                    onView={handleView}
                    onCreateClick={() => setCreateDialogOpen(true)}
                />
            )}

            <CreateActivityDialog
                packageSessionId={packageSessionId}
                open={createDialogOpen}
                onOpenChange={setCreateDialogOpen}
                onSuccess={handleSuccess}
            />

            <ViewPlanningDialog
                log={selectedLog}
                open={viewDialogOpen}
                onOpenChange={setViewDialogOpen}
                onSuccess={handleSuccess}
            />
        </div>
    );
}
