import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Badge } from '@/components/ui/badge';
import { WORKFLOW_NODE_TYPES } from '@/types/workflow/workflow-types';
import { Warning } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface WorkflowNodeData {
    name: string;
    nodeType: string;
    config: Record<string, unknown>;
    isStartNode?: boolean;
    isEndNode?: boolean;
}

/**
 * Check if a node has its minimum required config filled. `t` is optional so callers that
 * cannot yet thread a translator (e.g. a component outside this i18n batch) keep compiling
 * against a plain-English fallback — every caller within this batch always passes `t`.
 */
export function getNodeIssues(
    nodeType: string,
    config: Record<string, unknown>,
    t?: TFunction
): string[] {
    const issues: string[] = [];
    const has = (key: string) => {
        const v = config[key];
        return v !== undefined && v !== null && v !== '';
    };
    const tr = (key: string, fallback: string) => (t ? t(key) : fallback);

    switch (nodeType) {
        case 'TRIGGER':
            if (!has('triggerEvent')) issues.push(tr('issues.selectTriggerEvent', 'Select a trigger event'));
            break;
        case 'QUERY':
            if (!has('prebuiltKey')) issues.push(tr('issues.selectQuery', 'Select a query'));
            break;
        case 'SEND_EMAIL':
            if (!has('on')) issues.push(tr('issues.selectRecipientsSource', 'Select a data source for recipients'));
            break;
        case 'SEND_WHATSAPP':
            if (!has('templateName')) issues.push(tr('issues.selectWhatsappTemplate', 'Select a WhatsApp template'));
            if (!has('on')) issues.push(tr('issues.setRecipientsExpression', 'Set recipients expression'));
            break;
        case 'HTTP_REQUEST':
            if (!has('url')) issues.push(tr('issues.enterUrl', 'Enter a URL'));
            break;
        case 'FILTER':
            if (!has('source')) issues.push(tr('issues.setSourceExpression', 'Set source expression'));
            if (!has('condition')) issues.push(tr('issues.setFilterCondition', 'Set filter condition'));
            break;
        case 'AGGREGATE':
            if (!has('source')) issues.push(tr('issues.setSourceExpression', 'Set source expression'));
            break;
        case 'CONDITION':
            if (!has('condition')) issues.push(tr('issues.setConditionExpression', 'Set condition expression'));
            break;
        case 'LOOP':
            if (!has('source')) issues.push(tr('issues.setSourceExpression', 'Set source expression'));
            break;
        case 'DELAY':
            if (!has('delayValue') && !has('delay')) issues.push(tr('issues.setDelayValue', 'Set delay value'));
            break;
        case 'UPDATE_RECORD':
            if (!has('table')) issues.push(tr('issues.selectTable', 'Select a table'));
            break;
        case 'SEND_PUSH_NOTIFICATION':
            if (!has('title')) issues.push(tr('issues.enterNotificationTitle', 'Enter notification title'));
            if (!has('body')) issues.push(tr('issues.enterNotificationBody', 'Enter notification body'));
            break;
        case 'SCHEDULE_TASK':
            if (!has('delayDuration')) issues.push(tr('issues.setDelayDuration', 'Set delay duration'));
            break;
        case 'SET_LEAD_STATUS':
            if (!has('statusKey')) issues.push(tr('issues.selectLeadStatus', 'Select a lead status'));
            break;
        // MERGE, ACTION, TRANSFORM, ROUTER — no strict required fields
        default:
            break;
    }
    return issues;
}

const nodeColorMap: Record<string, { border: string; bg: string; badge: string }> = {
    TRIGGER: {
        border: 'border-green-400',
        bg: 'bg-green-50',
        badge: 'bg-green-100 text-green-800',
    },
    QUERY: {
        border: 'border-cyan-400',
        bg: 'bg-cyan-50',
        badge: 'bg-cyan-100 text-cyan-800',
    },
    TRANSFORM: {
        border: 'border-amber-400',
        bg: 'bg-amber-50',
        badge: 'bg-amber-100 text-amber-800',
    },
    ACTION: {
        border: 'border-blue-400',
        bg: 'bg-blue-50',
        badge: 'bg-blue-100 text-blue-800',
    },
    SEND_EMAIL: {
        border: 'border-purple-400',
        bg: 'bg-purple-50',
        badge: 'bg-purple-100 text-purple-800',
    },
    SEND_WHATSAPP: {
        border: 'border-emerald-400',
        bg: 'bg-emerald-50',
        badge: 'bg-emerald-100 text-emerald-800',
    },
    HTTP_REQUEST: {
        border: 'border-orange-400',
        bg: 'bg-orange-50',
        badge: 'bg-orange-100 text-orange-800',
    },
    COMBOT: {
        border: 'border-indigo-400',
        bg: 'bg-indigo-50',
        badge: 'bg-indigo-100 text-indigo-800',
    },
    DELAY: {
        border: 'border-slate-400',
        bg: 'bg-slate-50',
        badge: 'bg-slate-100 text-slate-800',
    },
    FILTER: {
        border: 'border-teal-400',
        bg: 'bg-teal-50',
        badge: 'bg-teal-100 text-teal-800',
    },
    AGGREGATE: {
        border: 'border-rose-400',
        bg: 'bg-rose-50',
        badge: 'bg-rose-100 text-rose-800',
    },
    CONDITION: {
        border: 'border-yellow-400',
        bg: 'bg-yellow-50',
        badge: 'bg-yellow-100 text-yellow-800',
    },
    LOOP: {
        border: 'border-violet-400',
        bg: 'bg-violet-50',
        badge: 'bg-violet-100 text-violet-800',
    },
    MERGE: {
        border: 'border-pink-400',
        bg: 'bg-pink-50',
        badge: 'bg-pink-100 text-pink-800',
    },
    SCHEDULE_TASK: {
        border: 'border-sky-400',
        bg: 'bg-sky-50',
        badge: 'bg-sky-100 text-sky-800',
    },
    UPDATE_RECORD: {
        border: 'border-lime-400',
        bg: 'bg-lime-50',
        badge: 'bg-lime-100 text-lime-800',
    },
    SEND_PUSH_NOTIFICATION: {
        border: 'border-fuchsia-400',
        bg: 'bg-fuchsia-50',
        badge: 'bg-fuchsia-100 text-fuchsia-800',
    },
    SET_LEAD_STATUS: {
        border: 'border-purple-400',
        bg: 'bg-purple-50',
        badge: 'bg-purple-100 text-purple-800',
    },
    ROUTER: {
        border: 'border-yellow-400',
        bg: 'bg-yellow-50',
        badge: 'bg-yellow-100 text-yellow-800',
    },
};

function WorkflowCustomNodeInner({ data, selected }: NodeProps<WorkflowNodeData>) {
    const { t } = useTranslation('workflowCustomNode');
    const nodeMeta = WORKFLOW_NODE_TYPES.find((n) => n.type === data.nodeType);
    const colors = nodeColorMap[data.nodeType] ?? {
        border: 'border-gray-400',
        bg: 'bg-gray-50',
        badge: 'bg-gray-100 text-gray-800',
    };

    const issues = getNodeIssues(data.nodeType, data.config ?? {}, t);
    const isIncomplete = issues.length > 0;

    return (
        <div
            className={`rounded-lg border-2 ${isIncomplete ? 'border-orange-400' : colors.border} ${colors.bg} min-w-[200px] px-4 py-3 shadow-sm transition-shadow ${
                selected ? 'ring-2 ring-blue-500 shadow-md' : ''
            }`}
        >
            <Handle
                type="target"
                position={Position.Top}
                className="!bg-gray-400 !w-3 !h-3"
            />

            <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{nodeMeta?.icon ?? '?'}</span>
                <span className="font-semibold text-sm truncate max-w-[140px]">
                    {data.name}
                </span>
                {isIncomplete && (
                    <Warning size={16} weight="fill" className="text-orange-500 shrink-0" />
                )}
            </div>

            <div className="flex items-center gap-1.5">
                <Badge className={`${colors.badge} text-[10px] px-1.5 py-0`}>
                    {nodeMeta?.label ?? data.nodeType}
                </Badge>
                {isIncomplete && (
                    <span className="text-[9px] text-orange-500">
                        {t('issueCount', { count: issues.length })}
                    </span>
                )}
            </div>

            {data.isStartNode && (
                <div className="mt-1 text-[10px] text-green-600 font-medium">
                    {t('start')}
                </div>
            )}

            <Handle
                type="source"
                position={Position.Bottom}
                className="!bg-gray-400 !w-3 !h-3"
            />
        </div>
    );
}

export const WorkflowCustomNode = memo(WorkflowCustomNodeInner);
