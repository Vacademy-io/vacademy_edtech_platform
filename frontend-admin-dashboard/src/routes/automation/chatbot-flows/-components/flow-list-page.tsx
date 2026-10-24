import { useEffect, useState } from 'react';
import { FlowsEnhancedCounts } from './FlowsEnhancedCounts';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Copy, Trash, Play, Pause, ChartBar, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
    listChatbotFlows,
    deleteChatbotFlow,
    duplicateChatbotFlow,
    activateChatbotFlow,
    deactivateChatbotFlow,
    fetchChatbotFlowAiUsage,
} from '../-services/chatbot-flow-api';
import { ChatbotFlowDTO } from '@/types/chatbot-flow/chatbot-flow-types';
import { getInstituteId } from '@/constants/helper';
import { SessionViewer } from './session-viewer';
import { FlowAiUsagePanel } from './flow-ai-usage-panel';

export function FlowListPage() {
    const { t, i18n } = useTranslation('automationFlowListPage');
    const [flows, setFlows] = useState<ChatbotFlowDTO[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewingSessionsFlow, setViewingSessionsFlow] = useState<ChatbotFlowDTO | null>(null);
    const [tab, setTab] = useState<'flows' | 'usage'>('flows');
    /**
     * Null = not known yet (or the check failed). Only an explicit `false` means the
     * institute is out of AI credits and the engine has stopped calling the model —
     * an unknown state must not render as a scary banner.
     */
    const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
    const navigate = useNavigate();
    const instituteId = getInstituteId() || '';

    const loadFlows = async () => {
        try {
            setLoading(true);
            const data = await listChatbotFlows(instituteId);
            setFlows(data);
        } catch (err) {
            toast.error(t('toast.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFlows();
        // Funding state for the AI Reply steps. Best effort — if the credits service
        // can't be reached we say nothing rather than claiming the bot is broken.
        fetchChatbotFlowAiUsage()
            .then((usage) => setAiEnabled(usage.aiEnabled))
            .catch(() => setAiEnabled(null));
    }, []);

    const handleCreate = () => {
        navigate({ to: '/automation/chatbot-flows/new' as any });
    };

    const handleEdit = (flowId: string) => {
        navigate({ to: `/automation/chatbot-flows/${flowId}` });
    };

    const handleDuplicate = async (flowId: string) => {
        try {
            await duplicateChatbotFlow(flowId);
            toast.success(t('toast.duplicated'));
            loadFlows();
        } catch {
            toast.error(t('toast.duplicateFailed'));
        }
    };

    const handleDelete = async (flowId: string) => {
        if (!confirm(t('confirmArchive'))) return;
        try {
            await deleteChatbotFlow(flowId);
            toast.success(t('toast.archived'));
            loadFlows();
        } catch {
            toast.error(t('toast.archiveFailed'));
        }
    };

    const handleToggleStatus = async (flow: ChatbotFlowDTO) => {
        try {
            if (flow.status === 'ACTIVE') {
                await deactivateChatbotFlow(flow.id!);
                toast.success(t('toast.deactivated'));
            } else {
                await activateChatbotFlow(flow.id!);
                toast.success(t('toast.activated'));
            }
            loadFlows();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('toast.toggleFailed');
            toast.error(msg);
        }
    };

    const statusBadge = (status: string) => {
        const styles: Record<string, string> = {
            ACTIVE: 'bg-green-100 text-green-700',
            DRAFT: 'bg-gray-100 text-gray-600',
            INACTIVE: 'bg-yellow-100 text-yellow-700',
            ARCHIVED: 'bg-red-100 text-red-600',
        };
        return (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] || styles.DRAFT}`}>
                {status}
            </span>
        );
    };

    // If viewing sessions for a flow, render the session viewer
    if (viewingSessionsFlow) {
        return (
            <SessionViewer
                flowId={viewingSessionsFlow.id!}
                flowName={viewingSessionsFlow.name}
                onBack={() => setViewingSessionsFlow(null)}
            />
        );
    }

    return (
        <div className="p-4 sm:p-6 w-full max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">{t('title')}</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        {t('subtitle')}
                    </p>
                </div>
                <button
                    onClick={handleCreate}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                    <Plus size={18} />
                    {t('newFlow')}
                </button>
            </div>

            {aiEnabled === false && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <Warning size={18} className="mt-0.5 shrink-0 text-amber-600" />
                    <div className="text-sm text-amber-800">
                        <p className="font-medium">
                            {t('aiPaused.title')}
                        </p>
                        <p className="mt-0.5 text-amber-700">
                            {t('aiPaused.body')}{' '}
                            <button
                                onClick={() => setTab('usage')}
                                className="font-medium underline underline-offset-2"
                            >
                                {t('aiPaused.seeUsage')}
                            </button>
                        </p>
                    </div>
                </div>
            )}

            <div className="mb-4 flex gap-1 border-b">
                {(
                    [
                        ['flows', t('tabs.flows')],
                        ['usage', t('tabs.usage')],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                            tab === key
                                ? 'border-blue-600 font-medium text-blue-700'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {tab !== 'usage' && !loading && (
                <FlowsEnhancedCounts statuses={flows.map((f) => f.status ?? 'DRAFT')} />
            )}

            {tab === 'usage' ? (
                <FlowAiUsagePanel />
            ) : loading ? (
                <div className="text-center py-12 text-gray-400">{t('loading')}</div>
            ) : flows.length === 0 ? (
                <div className="text-center py-12">
                    <p className="text-gray-400 mb-4">{t('empty.message')}</p>
                    <button
                        onClick={handleCreate}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        {t('empty.cta')}
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {flows.map((flow) => (
                        <div
                            key={flow.id}
                            onClick={() => handleEdit(flow.id!)}
                            className="flex items-center justify-between p-4 bg-white rounded-lg border hover:border-blue-300 hover:shadow-sm cursor-pointer transition"
                        >
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-medium text-gray-800">{flow.name}</h3>
                                    {statusBadge(flow.status)}
                                    <span className="text-xs text-gray-400">{flow.channelType}</span>
                                </div>
                                {flow.description && (
                                    <p className="text-sm text-gray-500 mt-1">{flow.description}</p>
                                )}
                                <p className="text-xs text-gray-400 mt-1">
                                    {t('updated', {
                                        date: flow.updatedAt
                                            ? new Date(flow.updatedAt).toLocaleString(i18n.language)
                                            : t('notAvailable'),
                                    })}
                                </p>
                            </div>
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={() => handleToggleStatus(flow)}
                                    className="p-2 rounded hover:bg-gray-100"
                                    title={flow.status === 'ACTIVE' ? t('actions.deactivate') : t('actions.activate')}
                                >
                                    {flow.status === 'ACTIVE' ? (
                                        <Pause size={16} className="text-yellow-600" />
                                    ) : (
                                        <Play size={16} className="text-green-600" />
                                    )}
                                </button>
                                <button
                                    onClick={() => setViewingSessionsFlow(flow)}
                                    className="p-2 rounded hover:bg-gray-100"
                                    title={t('actions.sessionsAndAnalytics')}
                                >
                                    <ChartBar size={16} className="text-blue-500" />
                                </button>
                                <button
                                    onClick={() => handleDuplicate(flow.id!)}
                                    className="p-2 rounded hover:bg-gray-100"
                                    title={t('actions.duplicate')}
                                >
                                    <Copy size={16} className="text-gray-500" />
                                </button>
                                <button
                                    onClick={() => handleDelete(flow.id!)}
                                    className="p-2 rounded hover:bg-gray-100"
                                    title={t('actions.archive')}
                                >
                                    <Trash size={16} className="text-red-500" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
