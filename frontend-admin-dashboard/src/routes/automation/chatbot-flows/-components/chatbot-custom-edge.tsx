import { memo, useState, useCallback } from 'react';
import { EdgeProps, getBezierPath, EdgeLabelRenderer } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { useChatbotFlowStore } from '../-stores/chatbot-flow-store';

function ChatbotCustomEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    label,
    data,
    style = {},
    markerEnd,
}: EdgeProps) {
    const { t } = useTranslation('automationChatbotCustomEdge');
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState((label as string) || '');
    // Use targeted store action instead of reading entire edges array (O(1) vs O(n))
    const updateEdgeLabel = useChatbotFlowStore((s) => s.updateEdgeLabel);

    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    const handleDoubleClick = useCallback(() => {
        setEditValue((label as string) || '');
        setIsEditing(true);
    }, [label]);

    const handleSave = useCallback(() => {
        setIsEditing(false);
        updateEdgeLabel(id, editValue, {
            ...(data?.conditionConfig || {}),
            branchId: data?.conditionConfig?.branchId || editValue,
            label: editValue,
        });
    }, [id, editValue, data, updateEdgeLabel]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') setIsEditing(false);
        },
        [handleSave]
    );

    return (
        <>
            <path
                id={id}
                style={{ ...style, strokeWidth: 2, stroke: '#94a3b8' }}
                className="react-flow__edge-path"
                d={edgePath}
                markerEnd={markerEnd}
            />

            <EdgeLabelRenderer>
                <div
                    style={{
                        position: 'absolute',
                        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                        pointerEvents: 'all',
                    }}
                    onDoubleClick={handleDoubleClick}
                >
                    {isEditing ? (
                        <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleSave}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="px-2 py-0.5 text-xs border border-blue-400 rounded bg-white shadow-md outline-none w-28"
                            placeholder={t('labelInput.placeholder')}
                        />
                    ) : label ? (
                        <div className="px-2 py-0.5 text-xs bg-white border border-gray-200 rounded shadow-sm cursor-pointer hover:border-blue-300 text-gray-700 max-w-32 truncate">
                            {label as string}
                        </div>
                    ) : (
                        <div
                            className="w-4 h-4 rounded-full bg-gray-200 hover:bg-blue-200 cursor-pointer border border-gray-300 hover:border-blue-400 transition-colors"
                            title={t('labelInput.addTitle')}
                        />
                    )}
                </div>
            </EdgeLabelRenderer>
        </>
    );
}

export default memo(ChatbotCustomEdge);
