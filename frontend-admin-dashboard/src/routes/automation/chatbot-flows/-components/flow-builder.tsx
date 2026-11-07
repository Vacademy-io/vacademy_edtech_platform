import { useCallback, useState } from 'react';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useChatbotFlowStore } from '../-stores/chatbot-flow-store';
import ChatbotCustomNode from './chatbot-custom-node';
import ChatbotCustomEdge from './chatbot-custom-edge';
import { NodePalette } from './node-palette';
import { NodeConfigPanel } from './node-config-panel';
import { FlowSettingsPanel } from './flow-settings-panel';
import { Gear } from '@phosphor-icons/react';
import { updateChatbotFlow, createChatbotFlow, activateChatbotFlow, deactivateChatbotFlow } from '../-services/chatbot-flow-api';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

const nodeTypes = { chatbotNode: ChatbotCustomNode };
const edgeTypes = { chatbotEdge: ChatbotCustomEdge };

function FlowBuilderInner() {
    const { t } = useTranslation('automationFlowBuilder');
    const {
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        flowId,
        flowName,
        flowStatus,
        channelType,
        isDirty,
        isSaving,
        setFlowName,
        setChannelType,
        toDTO,
        loadFlow,
        setIsSaving,
        selectNode,
        flowSettings,
    } = useChatbotFlowStore();

    const [showSettings, setShowSettings] = useState(false);
    // Both channels count — the badge answers "will anyone be told?", not "how many emails".
    const notifyRecipientCount =
        (flowSettings.notificationEmails || []).length +
        (flowSettings.notificationPhones || []).length;

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        try {
            const dto = toDTO();
            let saved;
            if (flowId) {
                saved = await updateChatbotFlow(flowId, dto);
            } else {
                saved = await createChatbotFlow(dto);
            }
            loadFlow(saved);
            toast.success(t('toast.saveSuccess'));
        } catch (err: unknown) {
            // Extract backend error message if available (axios error)
            const axiosErr = err as { response?: { data?: { message?: string } } };
            const backendMsg = axiosErr?.response?.data?.message;
            if (backendMsg?.includes('ACTIVE')) {
                toast.error(t('toast.activeSaveBlocked'));
            } else {
                toast.error(backendMsg || t('toast.saveFailed'));
            }
            console.error(err);
            throw err; // Re-throw so handleActivate's catch works
        } finally {
            setIsSaving(false);
        }
    }, [flowId, toDTO, loadFlow, setIsSaving, t]);

    const handleActivate = useCallback(async () => {
        if (!flowId) {
            toast.error(t('toast.saveFlowFirst'));
            return;
        }
        try {
            if (flowStatus === 'ACTIVE') {
                // Deactivate first, then save pending changes
                const result = await deactivateChatbotFlow(flowId);
                loadFlow(result);
                toast.success(t('toast.deactivated'));
                // Now save pending changes if dirty (flow is INACTIVE now, so PUT will work)
                if (isDirty) {
                    try { await handleSave(); } catch { /* save failed but deactivate succeeded */ }
                }
            } else {
                // Save first (flow is DRAFT/INACTIVE, PUT allowed), then activate
                if (isDirty) {
                    try { await handleSave(); } catch { return; }
                }
                const result = await activateChatbotFlow(flowId);
                loadFlow(result);
                toast.success(t('toast.activated'));
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('toast.validationFailed');
            toast.error(msg);
        }
    }, [flowId, flowStatus, isDirty, handleSave, loadFlow, t]);

    const onNodeClick = useCallback((_: React.MouseEvent, node: { id: string }) => {
        selectNode(node.id);
    }, [selectNode]);

    const onPaneClick = useCallback(() => {
        selectNode(null);
    }, [selectNode]);

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-white">
                <div className="flex items-center gap-3">
                    <input
                        type="text"
                        value={flowName}
                        onChange={(e) => setFlowName(e.target.value)}
                        className="text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none px-1"
                    />
                    <select
                        value={channelType}
                        onChange={(e) => setChannelType(e.target.value)}
                        className="text-xs border rounded px-2 py-1"
                    >
                        <option value="WHATSAPP_COMBOT">COMBOT</option>
                        <option value="WHATSAPP_META">{t('channelSelect.metaDirect')}</option>
                        <option value="WHATSAPP_WATI">WATI</option>
                        <option value="WHATSAPP">{t('channelSelect.allProviders')}</option>
                    </select>
                    <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            flowStatus === 'ACTIVE'
                                ? 'bg-green-100 text-green-700'
                                : flowStatus === 'INACTIVE'
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-gray-100 text-gray-600'
                        }`}
                    >
                        {flowStatus}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowSettings(true)}
                        className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                        title={t('settingsButton.title')}
                    >
                        <Gear size={14} /> {t('settingsButton.label')}
                        {notifyRecipientCount > 0 && (
                            <span className="ml-0.5 rounded-full bg-gray-100 px-1.5 text-caption text-gray-600">
                                {notifyRecipientCount}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isSaving ? t('saveButton.saving') : isDirty ? t('saveButton.dirty') : t('saveButton.default')}
                    </button>
                    <button
                        onClick={handleActivate}
                        className={`px-3 py-1.5 text-sm rounded-md ${
                            flowStatus === 'ACTIVE'
                                ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                                : 'bg-green-600 text-white hover:bg-green-700'
                        }`}
                    >
                        {flowStatus === 'ACTIVE' ? t('activateButton.deactivate') : t('activateButton.activate')}
                    </button>
                </div>
            </div>

            {/* 3-panel layout */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
                <NodePalette />

                <div className="flex-1 h-full">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeClick={onNodeClick}
                        onPaneClick={onPaneClick}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        defaultEdgeOptions={{ type: 'chatbotEdge', animated: true }}
                        fitView
                        deleteKeyCode="Delete"
                    >
                        <Background />
                        <Controls />
                        <MiniMap
                            nodeColor={(n) => n.data?.color || '#6b7280'}
                            maskColor="rgb(240, 240, 240, 0.7)"
                        />
                    </ReactFlow>
                </div>

                <NodeConfigPanel />
            </div>

            {showSettings && <FlowSettingsPanel onClose={() => setShowSettings(false)} />}
        </div>
    );
}

export function FlowBuilder() {
    return (
        <ReactFlowProvider>
            <FlowBuilderInner />
        </ReactFlowProvider>
    );
}
