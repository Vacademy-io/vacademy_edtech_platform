import { useTranslation } from 'react-i18next';
import { WORKFLOW_NODE_TYPES } from '@/types/workflow/workflow-types';
import { Lightning } from '@phosphor-icons/react';

interface Props {
    currentNodeType: string;
    onAddNode: (nodeType: string) => void;
}

const SUGGESTIONS: Record<string, string[]> = {
    TRIGGER: ['QUERY', 'HTTP_REQUEST'],
    QUERY: ['TRANSFORM', 'FILTER', 'LOOP', 'CONDITION'],
    TRANSFORM: ['SEND_EMAIL', 'SEND_WHATSAPP', 'CONDITION'],
    FILTER: ['SEND_EMAIL', 'SEND_WHATSAPP', 'AGGREGATE', 'LOOP'],
    AGGREGATE: ['CONDITION', 'SEND_EMAIL', 'UPDATE_RECORD'],
    CONDITION: ['SEND_EMAIL', 'SEND_WHATSAPP', 'UPDATE_RECORD', 'DELAY'],
    LOOP: ['SEND_EMAIL', 'SEND_WHATSAPP', 'HTTP_REQUEST'],
    DELAY: ['SEND_EMAIL', 'SEND_WHATSAPP', 'QUERY'],
    SEND_EMAIL: ['UPDATE_RECORD', 'DELAY', 'SCHEDULE_TASK'],
    SEND_WHATSAPP: ['UPDATE_RECORD', 'DELAY', 'SCHEDULE_TASK'],
    HTTP_REQUEST: ['CONDITION', 'TRANSFORM', 'UPDATE_RECORD'],
    MERGE: ['SEND_EMAIL', 'UPDATE_RECORD', 'CONDITION'],
    UPDATE_RECORD: ['SEND_EMAIL', 'SEND_WHATSAPP'],
    SCHEDULE_TASK: [],
    SEND_PUSH_NOTIFICATION: ['UPDATE_RECORD', 'DELAY'],
};

export function NodeSuggestions({ currentNodeType, onAddNode }: Props) {
    const { t } = useTranslation('workflowNodeSuggestions');
    const suggested = SUGGESTIONS[currentNodeType];
    if (!suggested || suggested.length === 0) return null;

    return (
        <div className="flex items-center gap-2 py-2 px-3 bg-muted/30 rounded-md border border-dashed">
            <Lightning size={14} className="text-amber-500 shrink-0" />
            <span className="text-[10px] text-muted-foreground shrink-0">{t('next')}</span>
            <div className="flex flex-wrap gap-1">
                {suggested.map((type) => {
                    const meta = WORKFLOW_NODE_TYPES.find((t) => t.type === type);
                    return (
                        <button
                            key={type}
                            onClick={() => onAddNode(type)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-white hover:bg-muted/50 transition-colors text-[10px]"
                        >
                            <span>{meta?.icon ?? '?'}</span>
                            <span>{meta?.label ?? type}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
