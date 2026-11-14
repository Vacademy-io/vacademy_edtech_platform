import { useSuspenseQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
    getWorkflowDiagramQuery,
    getWorkflowsByStatusQuery,
    WORKFLOW_STATUSES,
    WORKFLOWS_WITH_SCHEDULES_QUERY_KEY,
    deleteWorkflow as deactivateWorkflow,
    triggerWorkflowNow,
} from '@/services/workflow-service';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { WorkflowDiagramSimple } from './workflow-diagram-simple';
import { ExecutionHistoryTab } from './execution-history-tab';
import { ExecutionFlowViewer } from './execution-flow-viewer';
import { WorkflowConfigTab } from './workflow-config-tab';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { Button } from '@/components/ui/button';
import { ArrowLeft, PencilSimple, Pause, Eye, Play, Warning } from '@phosphor-icons/react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import { WorkflowStatusBadge } from '@/routes/workflow/-components/workflow-status-badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Calendar, Clock, Lightning } from '@phosphor-icons/react';
import { AutomationDiagram } from '@/types/workflow/workflow-types';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface WorkflowDetailsPageProps {
    workflowId: string;
}
export function WorkflowDetailsPage({ workflowId }: WorkflowDetailsPageProps) {
    const { t } = useTranslation('workflowDetailsPage');
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { setNavHeading } = useNavHeadingStore();
    // ?tab=... deep-links a tab (e.g. /workflow/<id>?tab=configuration, also
    // reachable via the /workflow/<id>/configuration redirect route).
    const { tab: tabFromUrl } = useSearch({ from: '/workflow/$workflowId/' });
    const [activeTab, setActiveTabState] = useState<string>(tabFromUrl ?? 'diagram');
    const setActiveTab = (tab: string) => {
        setActiveTabState(tab);
        // Keep the URL shareable for whichever tab is open.
        navigate({
            to: '/workflow/$workflowId',
            params: { workflowId },
            search:
                tab === 'diagram' ? {} : { tab: tab as 'configuration' | 'executions' | 'debug' },
            replace: true,
        });
    };
    // Follow browser back/forward between tab URLs.
    useEffect(() => {
        if (tabFromUrl && tabFromUrl !== activeTab) {
            setActiveTabState(tabFromUrl);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tabFromUrl]);
    const [debugExecutionId, setDebugExecutionId] = useState<string | null>(null);
    const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
    const [isDeactivating, setIsDeactivating] = useState(false);
    const [showRunConfirm, setShowRunConfirm] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    // Every status, not just ACTIVE — otherwise opening a DRAFT or INACTIVE workflow renders
    // "Workflow not found" even though the workflow exists and the diagram loads fine.
    const { data: workflows } = useSuspenseQuery(
        getWorkflowsByStatusQuery(instituteDetails?.id || '', WORKFLOW_STATUSES)
    );
    const {
        data: diagram,
        isLoading: isDiagramLoading,
        error: diagramError,
    } = useQuery(getWorkflowDiagramQuery(workflowId));

    // Find the current workflow
    const workflow = workflows?.find((w) => w.id === workflowId);

    const formatWorkflowType = (type: string) => {
        return type
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    };

    const formatDate = (dateString: string) => {
        try {
            const date = new Date(dateString);
            return formatDistanceToNow(date, { addSuffix: true });
        } catch (error) {
            return t('unknownDate');
        }
    };

    useEffect(() => {
        setNavHeading(
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate({ to: '/workflow/list' })}
                    className="flex items-center gap-2"
                >
                    <ArrowLeft size={20} />
                    {t('backToWorkflows')}
                </Button>
            </div>
        );
    }, [setNavHeading, navigate, t]);

    if (!workflow) {
        return (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
                <div className="text-center">
                    <p className="text-lg font-medium text-neutral-600">{t('notFound.title')}</p>
                    <p className="mt-2 text-sm text-neutral-500">{t('notFound.description')}</p>
                </div>
                <Button onClick={() => navigate({ to: '/workflow/list' })}>
                    {t('backToWorkflows')}
                </Button>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6">
            {/* Workflow Header */}
            <div className="mb-8 rounded-lg border border-neutral-200 bg-white p-6">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-3xl font-bold text-neutral-800">{workflow.name}</h1>
                            <WorkflowStatusBadge status={workflow.status} />
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                disabled={isDeactivating}
                                onClick={() => navigate({ to: `/workflow/${workflowId}/edit` })}
                            >
                                <PencilSimple size={14} />
                                {t('actions.edit')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                disabled={
                                    isRunning ||
                                    isDeactivating ||
                                    workflow.status.toUpperCase() === 'INACTIVE'
                                }
                                onClick={() => {
                                    setActionResult(null);
                                    setShowRunConfirm(true);
                                }}
                            >
                                <Play size={14} weight="fill" />
                                {isRunning ? t('actions.running') : t('actions.runNow')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                disabled={
                                    isDeactivating ||
                                    isRunning ||
                                    workflow.status.toUpperCase() === 'INACTIVE'
                                }
                                onClick={() => {
                                    setActionResult(null);
                                    setShowDeactivateConfirm(true);
                                }}
                            >
                                <Pause size={14} />
                                {isDeactivating
                                    ? t('actions.deactivating')
                                    : t('actions.deactivate')}
                            </Button>
                        </div>

                        {/* Action feedback */}
                        {actionResult && (
                            <div
                                role={actionResult.ok ? 'status' : 'alert'}
                                className={`mt-3 rounded-lg border p-3 text-xs ${
                                    actionResult.ok
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                        : 'border-red-200 bg-red-50 text-red-800'
                                }`}
                            >
                                {actionResult.message}
                                <button
                                    type="button"
                                    className="ms-3 underline opacity-70 hover:opacity-100"
                                    onClick={() => setActionResult(null)}
                                >
                                    {t('actions.dismiss')}
                                </button>
                            </div>
                        )}
                        <p className="mt-2 text-neutral-600">{workflow.description}</p>

                        <div className="mt-4 flex flex-wrap items-center gap-6">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-neutral-500">{t('type')}</span>
                                <Badge variant="outline" className="font-medium text-neutral-700">
                                    {formatWorkflowType(workflow.workflow_type)}
                                </Badge>
                            </div>
                            <TriggerHeadline diagram={diagram} />
                            <div className="flex items-center gap-2 text-sm text-neutral-500">
                                <Calendar size={16} weight="duotone" />
                                <span>
                                    {t('created', { time: formatDate(workflow.created_at) })}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-neutral-500">
                                <Clock size={16} weight="duotone" />
                                <span>
                                    {t('updated', { time: formatDate(workflow.updated_at) })}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Run-now confirmation modal */}
            <AlertDialog open={showRunConfirm} onOpenChange={setShowRunConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <Warning size={20} className="text-emerald-600" weight="fill" />
                            {t('runConfirm.title')}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm text-neutral-600">
                                <p>
                                    {t('runConfirm.bodyPrefix')}{' '}
                                    <span className="font-semibold text-neutral-800">
                                        {workflow.name}
                                    </span>{' '}
                                    {t('runConfirm.bodyMiddle')}{' '}
                                    <span className="font-semibold text-neutral-800">
                                        {t('runConfirm.productionMode')}
                                    </span>
                                    .
                                </p>
                                <ul className="list-disc space-y-1 ps-4 text-neutral-500">
                                    <li>{t('runConfirm.warnEmails')}</li>
                                    <li>{t('runConfirm.warnUndo')}</li>
                                    <li>{t('runConfirm.warnIntentional')}</li>
                                </ul>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isRunning}>
                            {t('actions.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isRunning}
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                            onClick={async () => {
                                setIsRunning(true);
                                try {
                                    const result = await triggerWorkflowNow(workflowId);
                                    setActionResult({
                                        ok: true,
                                        message: t('runConfirm.triggeredSuccess', {
                                            status:
                                                (result?.status as string) ??
                                                t('runConfirm.completedStatus'),
                                        }),
                                    });
                                } catch (err) {
                                    const msg =
                                        err instanceof Error ? err.message : t('unknownError');
                                    setActionResult({
                                        ok: false,
                                        message: t('runConfirm.triggerFailed', { message: msg }),
                                    });
                                } finally {
                                    setIsRunning(false);
                                    setShowRunConfirm(false);
                                }
                            }}
                        >
                            {isRunning ? t('actions.triggering') : t('actions.yesRunNow')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Deactivation preserves the workflow and execution history. */}
            <AlertDialog
                open={showDeactivateConfirm}
                onOpenChange={(open) => {
                    if (!isDeactivating) setShowDeactivateConfirm(open);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <Warning size={20} className="text-red-600" weight="fill" />
                            {t('deactivateConfirm.title')}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm text-neutral-600">
                                <p>
                                    <span className="font-semibold text-neutral-800">
                                        {workflow.name}
                                    </span>{' '}
                                    {t('deactivateConfirm.body')}
                                </p>
                                <ul className="list-disc space-y-1 ps-4 text-neutral-500">
                                    <li>{t('deactivateConfirm.warnNoNewExecutions')}</li>
                                    <li>{t('deactivateConfirm.warnHistoryPreserved')}</li>
                                    <li>{t('deactivateConfirm.warnInProgress')}</li>
                                </ul>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeactivating}>
                            {t('actions.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isDeactivating}
                            className="bg-red-600 text-white hover:bg-red-700"
                            onClick={async (event) => {
                                event.preventDefault();
                                setIsDeactivating(true);
                                try {
                                    await deactivateWorkflow(workflowId);
                                    await Promise.all([
                                        queryClient.invalidateQueries({
                                            queryKey: [WORKFLOWS_WITH_SCHEDULES_QUERY_KEY],
                                            refetchType: 'all',
                                        }),
                                        queryClient.invalidateQueries({
                                            queryKey: ['GET_WORKFLOW_DIAGRAM', workflowId],
                                        }),
                                        queryClient.invalidateQueries({
                                            queryKey: ['WORKFLOW_RAW', workflowId],
                                        }),
                                        queryClient.invalidateQueries({
                                            queryKey: ['WORKFLOW_EDIT', workflowId],
                                        }),
                                    ]);
                                    setActionResult({
                                        ok: true,
                                        message: t('deactivateConfirm.success'),
                                    });
                                } catch {
                                    setActionResult({
                                        ok: false,
                                        message: t('deactivateConfirm.failed'),
                                    });
                                } finally {
                                    setIsDeactivating(false);
                                    setShowDeactivateConfirm(false);
                                }
                            }}
                        >
                            {isDeactivating
                                ? t('actions.deactivating')
                                : t('actions.yesDeactivate')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Tabs: Diagram / Executions / Debug */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-4">
                    <TabsTrigger value="diagram">{t('tabs.diagram')}</TabsTrigger>
                    <TabsTrigger value="configuration">{t('tabs.configuration')}</TabsTrigger>
                    <TabsTrigger value="executions">{t('tabs.executions')}</TabsTrigger>
                    <TabsTrigger value="debug">{t('tabs.debug')}</TabsTrigger>
                </TabsList>

                <TabsContent value="diagram">
                    {isDiagramLoading ? (
                        <div className="flex items-center justify-center py-12 text-sm text-gray-400">
                            {t('diagram.loading')}
                        </div>
                    ) : diagramError ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-12">
                            <p className="text-sm text-red-500">{t('diagram.loadFailed')}</p>
                            <p className="text-xs text-gray-400">
                                {diagramError instanceof Error
                                    ? diagramError.message
                                    : t('unknownError')}
                            </p>
                        </div>
                    ) : diagram ? (
                        <WorkflowDiagramSimple
                            diagram={diagram}
                            instituteId={instituteDetails?.id}
                        />
                    ) : (
                        <div className="flex items-center justify-center py-12 text-sm text-gray-400">
                            {t('diagram.noData')}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="configuration">
                    <WorkflowConfigTab workflowId={workflowId} />
                </TabsContent>

                <TabsContent value="executions">
                    <ExecutionHistoryTab
                        workflowId={workflowId}
                        instituteId={instituteDetails?.id || ''}
                        onViewOnDiagram={(executionId) => {
                            setDebugExecutionId(executionId);
                            setActiveTab('debug');
                        }}
                    />
                </TabsContent>

                <TabsContent value="debug">
                    {debugExecutionId ? (
                        <div>
                            <div className="mb-4 flex items-center justify-between">
                                <p className="text-sm text-gray-500">
                                    {t('debug.debugging')}{' '}
                                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                                        {debugExecutionId.slice(0, 8)}...
                                    </code>
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setDebugExecutionId(null)}
                                >
                                    {t('debug.selectDifferent')}
                                </Button>
                            </div>
                            <ExecutionFlowViewer
                                workflowId={workflowId}
                                executionId={debugExecutionId}
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-4 py-16">
                            <div className="rounded-full bg-gray-100 p-4">
                                <Eye size={32} className="text-gray-400" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-medium text-gray-600">
                                    {t('debug.noSelection')}
                                </p>
                                <p className="mt-1 max-w-sm text-xs text-gray-400">
                                    {t('debug.hint')}
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setActiveTab('executions')}
                            >
                                {t('debug.goToExecutions')}
                            </Button>
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}

/**
 * "Event Driven" alone never told anyone what a workflow listens for. The diagram endpoint
 * already resolves the trigger's event and the entities it is scoped to, and this page
 * already loads it — so the headline can answer "what starts this, and for whom?" without
 * making the admin open a node dialog or a second request.
 */
function TriggerHeadline({ diagram }: { diagram?: AutomationDiagram }) {
    const { t } = useTranslation('workflowDetailsPage');
    const triggerNode = diagram?.nodes?.find((n) => n.type === 'TRIGGER');
    const details = triggerNode?.details as Record<string, unknown> | undefined;
    if (!details) return null;

    const firesOn = details['Fires on'] ?? details['Runs on a schedule'];
    const scopeKey = Object.keys(details).find((k) => k.startsWith('Scope'));
    const scope = scopeKey ? details[scopeKey] : undefined;
    const scopeText = Array.isArray(scope) ? scope.join(', ') : scope ? String(scope) : undefined;

    if (!firesOn) return null;
    return (
        <div className="flex items-center gap-2 text-sm">
            <Lightning size={16} weight="duotone" className="text-amber-500" />
            <span className="text-neutral-500">{t('trigger.firesOn')}</span>
            <span className="font-medium text-neutral-700">{String(firesOn)}</span>
            {scopeText && (
                <>
                    <span className="text-neutral-400">{t('trigger.for')}</span>
                    <span className="font-medium text-neutral-700" title={scopeText}>
                        {scopeText}
                    </span>
                </>
            )}
        </div>
    );
}
