import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQuery, useQueries, queryOptions } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowSquareOut, FlowArrow as WorkflowIcon, ArrowsClockwise } from '@phosphor-icons/react';
import {
    getActiveWorkflowsQuery,
    getWorkflowForEditing,
} from '@/services/workflow-service';
import type { Workflow, WorkflowBuilderDTO } from '@/types/workflow/workflow-types';

/**
 * Trigger event names that operate on AUDIENCE entities. A workflow with
 * trigger_event_name in this list AND (event_id === audienceId OR event_id === null)
 * is considered "linked" to this audience for the EVENT-DRIVEN path.
 *
 * Keep in sync with WorkflowTriggerEvent.java on the backend.
 */
const AUDIENCE_TRIGGER_EVENTS = new Set<string>([
    'AUDIENCE_LEAD_SUBMISSION',
]);

/**
 * Prebuilt query keys that target audience leads. A SCHEDULED workflow with
 * a QUERY node using one of these is considered "linked" to an audience if
 * its params.audienceId matches (or is empty → global across all audiences).
 *
 * Keep in sync with the prebuilt query catalog in QueryServiceImpl.java.
 */
const AUDIENCE_QUERY_KEYS = new Set<string>([
    'fetch_audience_responses_filtered',
    'getAudienceResponsesByDayDifference',
]);

interface LinkedWorkflowsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    audienceId: string;
    audienceName: string;
    instituteId: string;
}

interface LinkedWorkflow extends Workflow {
    /** True if this workflow targets this specific audience (not a global). */
    isSpecific: boolean;
    /** How this workflow was matched — for the badge label. */
    matchReason: 'event-driven' | 'scheduled-query';
}

/**
 * Translates a raw backend workflow status enum ('ACTIVE' | 'DRAFT' | 'INACTIVE')
 * into a display label. Falls back to the raw value for any status this dialog
 * doesn't know about, so an unrecognized value still renders something.
 */
function workflowStatusLabel(t: TFunction, status: string): string {
    switch (status?.toUpperCase()) {
        case 'ACTIVE':
            return t('workflowStatus.active');
        case 'DRAFT':
            return t('workflowStatus.draft');
        case 'INACTIVE':
            return t('workflowStatus.inactive');
        default:
            return status;
    }
}

/** Wraps getWorkflowForEditing as a queryOptions for use with useQueries. */
function workflowDtoQuery(workflowId: string) {
    return queryOptions({
        queryKey: ['WORKFLOW_FULL_DTO', workflowId],
        queryFn: () => getWorkflowForEditing(workflowId),
        // 5 min staleTime — workflow definitions don't change often.
        staleTime: 5 * 60 * 1000,
        enabled: !!workflowId,
    });
}

/**
 * Lists workflows that fire for this audience. Two ways a workflow can be "linked":
 *
 *   1. EVENT_DRIVEN — workflow_trigger.event_id === audienceId (specific)
 *                 OR workflow_trigger.event_id IS NULL    (global)
 *      Trigger name must be in AUDIENCE_TRIGGER_EVENTS.
 *
 *   2. SCHEDULED — has a QUERY node whose prebuiltKey is in AUDIENCE_QUERY_KEYS
 *      AND (params.audienceId === audienceId OR no audienceId param at all = global).
 *      Detected by fetching each scheduled workflow's full DTO.
 *
 * On the backend, specific event-driven triggers SUPPRESS global ones at fire
 * time (so admin sees what actually runs). Specifics shown first in the list.
 */
export function LinkedWorkflowsDialog({
    open,
    onOpenChange,
    audienceId,
    audienceName,
    instituteId,
}: LinkedWorkflowsDialogProps) {
    const navigate = useNavigate();
    const { t } = useTranslation('audienceManagerLinkedWorkflowsDialog');

    // Force a fresh fetch every time the dialog opens. Without this, React
    // Query would return cached data from the menu's count-badge query and
    // the user would see no network call in DevTools (confusing during
    // troubleshooting). Cache is still used for instant render — refetch
    // happens in the background.
    const {
        data: allWorkflows = [],
        isLoading,
        isError,
        refetch,
        isFetching,
    } = useQuery({
        ...getActiveWorkflowsQuery(instituteId),
        refetchOnMount: 'always',
        enabled: open && !!instituteId,
    });

    // For every SCHEDULED workflow, fetch its full DTO so we can inspect the
    // QUERY node's params. Triggered only when the dialog is open AND we have
    // the workflow list AND there's at least one scheduled workflow to inspect.
    // Cached for 5 min so re-opening the dialog is instant.
    const scheduledIds = useMemo(
        () =>
            open
                ? allWorkflows
                      .filter((w) => w.workflow_type === 'SCHEDULED')
                      .map((w) => w.id)
                : [],
        [open, allWorkflows],
    );

    const scheduledDtoQueries = useQueries({
        queries: scheduledIds.map((id) => workflowDtoQuery(id)),
    });

    const scheduledDtosById = useMemo(() => {
        const map = new Map<string, WorkflowBuilderDTO>();
        scheduledDtoQueries.forEach((q, i) => {
            if (q.data && scheduledIds[i]) map.set(scheduledIds[i]!, q.data);
        });
        return map;
    }, [scheduledDtoQueries, scheduledIds]);

    const scheduledDtosLoading = scheduledDtoQueries.some((q) => q.isLoading);

    const linked = useMemo<LinkedWorkflow[]>(() => {
        const matches: LinkedWorkflow[] = [];

        for (const w of allWorkflows) {
            // ─── Event-driven match ───
            const trigger = w.trigger;
            if (
                trigger
                && trigger.trigger_event_name
                && AUDIENCE_TRIGGER_EVENTS.has(trigger.trigger_event_name)
                && (trigger.event_id === audienceId || trigger.event_id === null)
            ) {
                matches.push({
                    ...w,
                    isSpecific: trigger.event_id === audienceId,
                    matchReason: 'event-driven',
                });
                continue;
            }

            // ─── Scheduled match ───
            if (w.workflow_type === 'SCHEDULED') {
                const dto = scheduledDtosById.get(w.id);
                if (!dto) continue; // still loading — appears on re-render
                let specificMatch = false;
                let globalMatch = false;
                for (const n of dto.nodes ?? []) {
                    if (n.node_type !== 'QUERY') continue;
                    const cfg = (n.config ?? {}) as Record<string, unknown>;
                    const prebuiltKey = cfg.prebuiltKey as string | undefined;
                    if (!prebuiltKey || !AUDIENCE_QUERY_KEYS.has(prebuiltKey)) continue;
                    const params = (cfg.params ?? {}) as Record<string, unknown>;
                    const paramAudienceId = params.audienceId as string | undefined;
                    if (!paramAudienceId) {
                        // No audienceId filter → fires across ALL audiences
                        globalMatch = true;
                    } else {
                        // CSV may contain multiple audience IDs (multi-select wizard)
                        const ids = String(paramAudienceId).split(',').map((s) => s.trim());
                        if (ids.includes(audienceId)) specificMatch = true;
                    }
                }
                if (specificMatch || globalMatch) {
                    matches.push({
                        ...w,
                        isSpecific: specificMatch,
                        matchReason: 'scheduled-query',
                    });
                }
            }
        }

        return matches.sort((a, b) => {
            if (a.isSpecific && !b.isSpecific) return -1;
            if (!a.isSpecific && b.isSpecific) return 1;
            return (a.name ?? '').localeCompare(b.name ?? '');
        });
    }, [allWorkflows, scheduledDtosById, audienceId]);

    const showLoadingState = isLoading || (scheduledIds.length > 0 && scheduledDtosLoading);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <WorkflowIcon size={20} className="text-primary-500" />
                        {t('dialog.titlePrefix')} <span className="font-semibold">&ldquo;{audienceName}&rdquo;</span>
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.description')}
                    </DialogDescription>
                </DialogHeader>

                {/* Manual refresh — shows that data is fetched fresh and lets user re-query */}
                <div className="flex items-center justify-between -mt-1">
                    <p className="text-2xs text-gray-400">
                        {isFetching
                            ? t('status.refreshing')
                            : t('status.foundCount', { count: linked.length })}
                    </p>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-2xs text-gray-500"
                        onClick={() => refetch()}
                        disabled={isFetching}
                    >
                        <ArrowsClockwise size={11} className={isFetching ? 'animate-spin' : ''} />
                        {t('actions.refresh')}
                    </Button>
                </div>

                <div className="space-y-2 max-h-96 overflow-y-auto py-2">
                    {showLoadingState && (
                        <p className="text-sm text-gray-500 text-center py-8">{t('status.loading')}</p>
                    )}
                    {isError && (
                        <p className="text-sm text-red-500 text-center py-8">
                            {t('status.error')}
                        </p>
                    )}
                    {!showLoadingState && !isError && linked.length === 0 && (
                        <div className="text-center py-8 space-y-2">
                            <WorkflowIcon size={40} className="text-gray-300 mx-auto" />
                            <p className="text-sm text-gray-500">{t('empty.title')}</p>
                            <p className="text-xs text-gray-400">
                                {t('empty.hint')}
                            </p>
                        </div>
                    )}
                    {!showLoadingState && !isError && linked.map((w) => (
                        <div
                            key={w.id}
                            className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3 hover:border-primary-300 hover:bg-primary-50/30 transition-colors"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-sm text-gray-800 truncate">{w.name}</span>
                                    {w.isSpecific ? (
                                        <Badge variant="outline" className="bg-primary-50 text-primary-700 border-primary-200 text-2xs font-medium">
                                            {t('badge.specific')}
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200 text-2xs font-medium">
                                            {t('badge.global')}
                                        </Badge>
                                    )}
                                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-2xs font-medium">
                                        {w.matchReason === 'event-driven' ? t('badge.matchReason.eventDriven') : t('badge.matchReason.scheduled')}
                                    </Badge>
                                    <Badge
                                        variant="outline"
                                        className={
                                            w.status === 'ACTIVE'
                                                ? 'bg-green-50 text-green-700 border-green-200 text-2xs'
                                                : 'bg-gray-50 text-gray-600 border-gray-200 text-2xs'
                                        }
                                    >
                                        {workflowStatusLabel(t, w.status)}
                                    </Badge>
                                </div>
                                {w.description && (
                                    <p className="mt-1 text-xs text-gray-500 line-clamp-2">{w.description}</p>
                                )}
                                {w.trigger?.trigger_event_name && (
                                    <p className="mt-1 text-2xs text-gray-400 font-mono">
                                        {t('workflow.triggerLabel', { name: w.trigger.trigger_event_name })}
                                    </p>
                                )}
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0 gap-1.5 text-primary-600 hover:bg-primary-50"
                                onClick={() => {
                                    onOpenChange(false);
                                    navigate({ to: `/workflow/${w.id}` as any } as any);
                                }}
                            >
                                {t('actions.open')}
                                <ArrowSquareOut size={12} />
                            </Button>
                        </div>
                    ))}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('actions.close')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
