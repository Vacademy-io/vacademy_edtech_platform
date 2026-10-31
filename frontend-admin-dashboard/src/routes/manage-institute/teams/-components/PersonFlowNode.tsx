import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { PencilSimple, Trash, User } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { type OrgChartNode } from '../-services/org-team-services';
import { type InstituteUser } from '../-services/institute-users-service';

export interface PersonNodeData {
    node: OrgChartNode;
    user: InstituteUser | undefined;
    onEdit: (node: OrgChartNode) => void;
    onRemove: (node: OrgChartNode) => void;
}

/**
 * One person on the org-chart canvas. The top handle is the "I report to
 * someone" socket (target); the bottom handle is the "someone reports to
 * me" socket (source). Drawing a connection from a bottom handle into a
 * top handle is the gesture that sets reports-to.
 *
 * Width/height are mirrored in {@link ./org-chart-layout.ts} so dagre
 * positions don't drift.
 */
function PersonFlowNode({ data, selected }: NodeProps<PersonNodeData>) {
    const { t } = useTranslation('manageInstitutePersonFlowNode');
    const { node, user, onEdit, onRemove } = data;
    const name = user?.full_name || t('fallbackName', { id: node.user_id.slice(0, 6) });

    return (
        <div
            className={cn(
                'group flex w-60 flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm transition-colors',
                selected
                    ? 'border-primary-500 ring-2 ring-primary-200'
                    : 'border-neutral-200 hover:border-primary-200 hover:shadow-md'
            )}
        >
            {/* Top: target handle ("I report to …"). */}
            <Handle
                type="target"
                position={Position.Top}
                className="!size-2 !border-2 !border-white !bg-primary-500"
                isConnectable
            />

            <div className="h-1 bg-primary-500" />
            <div className="flex items-start gap-2.5 px-3 py-2.5">
                <Avatar name={name} />
                <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-body font-semibold text-neutral-900">{name}</div>
                    {node.role_label && (
                        <div className="mt-0.5 truncate text-caption italic text-neutral-700">
                            {node.role_label}
                        </div>
                    )}
                    {user?.email && (
                        <div className="mt-0.5 truncate text-caption text-neutral-500">
                            {user.email}
                        </div>
                    )}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit(node);
                        }}
                        className="rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-primary-50 hover:text-primary-600 group-hover:opacity-100"
                        title={t('editPositionLabel')}
                        aria-label={t('editPositionLabel')}
                    >
                        <PencilSimple size={14} />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemove(node);
                        }}
                        className="rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-danger-50 hover:text-danger-600 group-hover:opacity-100"
                        title={t('removeFromTeam')}
                        aria-label={t('removeFromTeam')}
                    >
                        <Trash size={14} />
                    </button>
                </div>
            </div>

            {/* Bottom: source handle ("someone reports to me"). Drag this
                onto another card's top handle to set that person's manager. */}
            <Handle
                type="source"
                position={Position.Bottom}
                className="!size-2 !border-2 !border-white !bg-primary-500"
                isConnectable
            />
        </div>
    );
}

function Avatar({ name }: { name: string }) {
    const initial = (name || '?').trim().slice(0, 1).toUpperCase();
    return (
        <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-h4 font-semibold text-primary-700"
            aria-hidden="true"
        >
            {initial || <User size={16} />}
        </div>
    );
}

export default memo(PersonFlowNode);
