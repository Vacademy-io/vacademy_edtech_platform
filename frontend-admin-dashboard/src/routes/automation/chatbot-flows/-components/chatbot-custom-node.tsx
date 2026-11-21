import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { useChatbotFlowStore } from '../-stores/chatbot-flow-store';
import { CRM_LEAD_CHECK_BRANCHES } from '@/types/chatbot-flow/chatbot-flow-types';
import { useLeadStatuses } from '@/hooks/use-lead-statuses';

interface ChatbotNodeData {
    nodeType: string;
    name: string;
    config: Record<string, unknown>;
    color: string;
    icon: string;
}

interface Branch {
    id: string;
    label: string;
    isDefault?: boolean;
}

function ChatbotCustomNode({ id, data, selected }: NodeProps<ChatbotNodeData>) {
    const { t } = useTranslation('automationChatbotCustomNode');
    const selectNode = useChatbotFlowStore((s) => s.selectNode);
    const removeNode = useChatbotFlowStore((s) => s.removeNode);

    const isCondition = data.nodeType === 'CONDITION';
    const isCrmLeadCheck = data.nodeType === 'CRM_LEAD_CHECK';
    // Branching nodes get one labelled output handle per branch; the handle id is the branchId.
    const hasBranchOutputs = isCondition || isCrmLeadCheck;
    const crmBranchLabels: Record<string, string> = {
        NEW: t('branch.newLead'),
        EXISTING: t('branch.existingLead'),
    };
    const branches: Branch[] = isCondition
        ? (data.config.branches as Branch[]) || []
        : isCrmLeadCheck
          ? CRM_LEAD_CHECK_BRANCHES.map((b) => ({
                id: b.id,
                label: crmBranchLabels[b.id] ?? b.label,
            }))
          : [];

    // Shared, cached query — only SAVE_TO_CRM cards need the status catalog for their summary.
    const { statuses } = useLeadStatuses({ skip: data.nodeType !== 'SAVE_TO_CRM' });
    const saveStatusKey =
        data.nodeType === 'SAVE_TO_CRM' ? (data.config.statusKey as string | null) : null;
    const saveStatusLabel = saveStatusKey
        ? statuses.find((s) => s.status_key === saveStatusKey)?.label ?? saveStatusKey
        : null;

    return (
        <div
            onClick={() => selectNode(id)}
            className={`rounded-lg border-2 bg-white shadow-md min-w-[200px] cursor-pointer transition-all ${
                selected ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200'
            }`}
            style={{ borderLeftColor: data.color, borderLeftWidth: '4px' }}
        >
            {/* Header */}
            <div
                className="flex items-center justify-between px-3 py-2 rounded-t-lg"
                style={{ backgroundColor: `${data.color}15` }}
            >
                <div className="flex items-center gap-2">
                    <span className="text-lg">{data.icon}</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        {data.nodeType.replaceAll('_', ' ')}
                    </span>
                </div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        removeNode(id);
                    }}
                    className="text-gray-400 hover:text-red-500 text-xs"
                >
                    ✕
                </button>
            </div>

            {/* Body */}
            <div className="px-3 py-2">
                <p className="text-sm font-medium text-gray-800 truncate">{data.name}</p>
                {data.nodeType === 'SEND_MESSAGE' && (
                    <p className="text-xs text-gray-500 mt-1 truncate">
                        💬 {(data.config.messageType as string) === 'text'
                            ? ((data.config.text as string) || t('fallback.textMessage')).substring(0, 40)
                            : (data.config.messageType as string)}
                    </p>
                )}
                {data.nodeType === 'SEND_TEMPLATE' && !!data.config.templateName && (
                    <p className="text-xs text-gray-500 mt-1 truncate">
                        📄 {data.config.templateName as string}
                    </p>
                )}
                {data.nodeType === 'DELAY' && (
                    <p className="text-xs text-gray-500 mt-1">
                        ⏱️ {data.config.delayValue as number} {(data.config.delayUnit as string)?.toLowerCase()}
                    </p>
                )}
                {data.nodeType === 'TRIGGER' && (
                    <p className="text-xs text-gray-500 mt-1">
                        ⚡ {((data.config.keywords as string[]) || []).join(', ') || t('fallback.anyMessage')}
                    </p>
                )}
                {data.nodeType === 'AI_RESPONSE' && (
                    <p className="text-xs text-gray-500 mt-1">
                        🤖 {(data.config.modelId as string)?.split('/').pop() || t('fallback.ai')}
                    </p>
                )}
                {data.nodeType === 'ASK_FIELD' && (
                    <p className="mt-1 truncate text-xs text-gray-500">
                        📝 {(data.config.fieldName as string) || t('fallback.noField')}
                    </p>
                )}
                {data.nodeType === 'SAVE_TO_CRM' && (
                    <p className="mt-1 truncate text-xs text-gray-500">
                        💾{' '}
                        {saveStatusLabel
                            ? t('saveToCrm.setsStatus', { status: saveStatusLabel })
                            : t('saveToCrm.keepsStatus')}
                    </p>
                )}
            </div>

            {/* CONDITION / CRM_LEAD_CHECK: Branch output handles with labels */}
            {hasBranchOutputs && branches.length > 0 && (
                <div className="flex justify-around px-2 pb-2 pt-1 border-t border-gray-100">
                    {branches.map((branch, i) => (
                        <div key={branch.id} className="flex flex-col items-center relative" style={{ minWidth: 50 }}>
                            <span className="text-[9px] text-gray-500 mb-1 truncate max-w-[60px]">
                                {branch.label || (branch.isDefault ? t('branch.default') : t('branch.numbered', { number: i + 1 }))}
                            </span>
                            <Handle
                                type="source"
                                position={Position.Bottom}
                                id={branch.id}
                                className="!w-2.5 !h-2.5 !relative !transform-none !inset-auto"
                                style={{
                                    background: branch.isDefault ? '#9ca3af' : data.color,
                                    position: 'relative',
                                }}
                            />
                        </div>
                    ))}
                </div>
            )}

            {/* Handles — input (top) */}
            {data.nodeType !== 'TRIGGER' && (
                <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-3 !h-3" />
            )}

            {/* Single output handle for non-branching nodes */}
            {!hasBranchOutputs && (
                <Handle type="source" position={Position.Bottom} className="!w-3 !h-3" style={{ background: data.color }} />
            )}
        </div>
    );
}

export default memo(ChatbotCustomNode);
