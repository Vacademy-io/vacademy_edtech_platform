import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getWorkflowForEditing } from '@/services/workflow-service';
import { useWorkflowBuilderStore } from '@/routes/workflow/create/-stores/workflow-builder-store';
import { WorkflowBuilder } from '@/routes/workflow/create/-components/workflow-builder';
import { WorkflowBuilderDTO } from '@/types/workflow/workflow-types';

interface Props {
    workflowId: string;
}

export function WorkflowEditor({ workflowId }: Props) {
    const { t } = useTranslation('workflowEditor');
    const { data, isLoading, error } = useQuery({
        queryKey: ['WORKFLOW_EDIT', workflowId],
        queryFn: () => getWorkflowForEditing(workflowId) as Promise<WorkflowBuilderDTO>,
        staleTime: 0, // Always fetch fresh for editing
    });

    const {
        setNodes,
        setEdges,
        setWorkflowName,
        setWorkflowDescription,
        setWorkflowType,
        setSetupComplete,
    } = useWorkflowBuilderStore();

    // Mark this as an EDIT (Save/Test Run update in place via PUT instead of cloning via POST), and
    // CRITICALLY clear it on unmount so navigating to the create page can't accidentally PUT-update
    // this workflow. Keyed on workflowId so it sets immediately on mount, before data loads.
    useEffect(() => {
        useWorkflowBuilderStore.getState().setEditingWorkflowId(workflowId);
        return () => {
            useWorkflowBuilderStore.getState().setEditingWorkflowId(null);
            useWorkflowBuilderStore.getState().setEditingWorkflowStatus(null);
        };
    }, [workflowId]);

    // Load workflow data into the builder store once fetched
    useEffect(() => {
        if (!data) return;

        // Remember the persisted status so Test Run doesn't downgrade a live workflow to DRAFT.
        useWorkflowBuilderStore.getState().setEditingWorkflowStatus(data.status ?? null);

        setWorkflowName(data.name ?? '');
        setWorkflowDescription(data.description ?? '');
        setWorkflowType((data.workflow_type as 'SCHEDULED' | 'EVENT_DRIVEN') ?? 'SCHEDULED');

        // Load trigger/schedule config if present
        if (data.trigger) {
            useWorkflowBuilderStore.getState().setTriggerConfig({
                eventName: data.trigger.trigger_event_name ?? '',
                description: data.trigger.description ?? '',
                eventAppliedType: data.trigger.event_applied_type ?? '',
                eventId: data.trigger.event_id ?? undefined,
                eventIds: data.trigger.event_ids ?? undefined,
            });
        }
        if (data.schedule) {
            useWorkflowBuilderStore.getState().setScheduleConfig({
                scheduleType: (data.schedule.schedule_type as 'CRON' | 'INTERVAL') ?? 'CRON',
                cronExpression: data.schedule.cron_expression ?? '',
                intervalMinutes: data.schedule.interval_minutes ?? 60,
                timezone: data.schedule.timezone ?? 'Asia/Kolkata',
                startDate: data.schedule.start_date ?? '',
                endDate: data.schedule.end_date ?? '',
            });
        }

        // Skip setup step — go directly to canvas when editing
        setSetupComplete(true);

        // Convert WorkflowBuilderNodes to ReactFlow nodes
        const rfNodes = (data.nodes ?? []).map((n) => ({
            id: n.id,
            type: 'workflowNode' as const,
            position: { x: n.position_x ?? 0, y: n.position_y ?? 0 },
            data: {
                name: n.name,
                nodeType: n.node_type,
                config: n.config ?? {},
                isStartNode: n.is_start_node ?? false,
                isEndNode: n.is_end_node ?? false,
            },
        }));

        const rfEdges = (data.edges ?? []).map((e) => ({
            id: e.id,
            source: e.source_node_id,
            target: e.target_node_id,
            label: e.label ?? '',
            type: 'smoothstep' as const,
            animated: true,
        }));

        setNodes(rfNodes);
        setEdges(rfEdges);
    }, [data]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen text-muted-foreground">
                {t('loadingWorkflow')}
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-screen text-red-500">
                {t('failedToLoad', { message: error.message })}
            </div>
        );
    }

    return <WorkflowBuilder />;
}
