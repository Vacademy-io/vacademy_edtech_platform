import { ReactNode } from 'react';
import { Handle, Position } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Warning, XCircle, CircleNotch, Clock } from '@phosphor-icons/react';
import { buildNodeLabels, type PipelineNodeId } from '../-utils/stage-vocab';
import type { NodeState } from '../-utils/derive-pipeline-state';
import { NODE_SIZES } from '../-utils/build-pipeline-graph';

interface BaseNodeShellProps {
    kind: PipelineNodeId;
    state: NodeState;
    /** Optional override for the header label (defaults to buildNodeLabels(t)[kind]). */
    label?: string;
    /** Right-aligned chip in the header (e.g. "8 scenes" / "12.4s" / "wrapped 2m"). */
    headerMeta?: ReactNode;
    /** The unique-per-kind body content. */
    children: ReactNode;
    /** Slightly larger node (used by Final Cut). */
    emphasized?: boolean;
    /**
     * Defaults to `true`. When set, the node renders a "clickable" affordance
     * (cursor + hover lift). The actual click handling is wired by
     * `<PipelineFlow>` through React Flow's `onNodeClick` — DOM-level
     * `onClick` on a custom node component is unreliable inside React Flow's
     * own event-handling wrapper. This prop only affects the visual cue.
     */
    clickable?: boolean;
}

/**
 * State-driven visuals mirror `workflow/$workflowId/-components/execution-flow-node.tsx`
 * so the new pipeline view feels native to the rest of the admin dashboard's
 * flow visualizations.
 */
const STATE_VISUAL: Record<
    NodeState,
    { ring: string; bg: string; icon: ReactNode; label: string; iconColor: string }
> = {
    scheduled: {
        ring: 'border border-gray-200',
        bg: 'bg-white',
        icon: <Clock className="size-3.5" />,
        iconColor: 'text-gray-400',
        label: 'Scheduled',
    },
    in_production: {
        ring: 'ring-2 ring-blue-500 animate-pulse',
        bg: 'bg-blue-50/50',
        icon: <CircleNotch className="size-3.5 animate-spin" />,
        iconColor: 'text-blue-600',
        label: 'In production',
    },
    wrapped: {
        ring: 'ring-2 ring-green-500',
        bg: 'bg-green-50/40',
        icon: <CheckCircle className="size-3.5" />,
        iconColor: 'text-green-600',
        label: 'Wrapped',
    },
    reshoot: {
        ring: 'ring-2 ring-amber-500',
        bg: 'bg-amber-50/50',
        icon: <Warning className="size-3.5" />,
        iconColor: 'text-amber-600',
        label: 'Reshoot',
    },
    cut: {
        ring: 'ring-2 ring-red-500',
        bg: 'bg-red-50/50',
        icon: <XCircle className="size-3.5" />,
        iconColor: 'text-red-600',
        label: 'Cut',
    },
};

/**
 * Render the standard node frame: handles on every side (so the same node
 * works in both LR and TB dagre layouts), state-driven ring + bg, header
 * with kind label + status icon, and a body slot for per-kind content.
 *
 * The DOM width is pinned to `NODE_SIZES[kind].width` — the same value
 * we feed dagre — so the rendered node never overflows what the layout
 * engine reserved for it. Body content gets `overflow-hidden` to prevent
 * audio players / long text from bleeding into siblings.
 */
export function BaseNodeShell({
    kind,
    state,
    label,
    headerMeta,
    children,
    emphasized,
    clickable = true,
}: BaseNodeShellProps) {
    const { t } = useTranslation('videoApiStudioStageVocab');
    const visual = STATE_VISUAL[state];
    const title = label ?? buildNodeLabels(t)[kind];

    return (
        <div
            aria-label={clickable ? `${title} — click for details` : title}
            style={{ width: NODE_SIZES[kind].width }}
            className={`group relative flex flex-col overflow-hidden rounded-xl shadow-sm transition-all ${
                visual.ring
            } ${visual.bg} ${emphasized ? 'shadow-md' : ''} ${
                clickable
                    ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md'
                    : 'cursor-default'
            }`}
        >
            {/* Handles on all four sides — dagre `applyDagreLayout` writes the
                right `sourcePosition`/`targetPosition` per orientation, so React
                Flow picks the correct pair automatically. */}
            <Handle
                type="target"
                position={Position.Left}
                className="!size-1 !border-0 !bg-transparent"
            />
            <Handle
                type="target"
                position={Position.Top}
                className="!size-1 !border-0 !bg-transparent"
            />
            <Handle
                type="source"
                position={Position.Right}
                className="!size-1 !border-0 !bg-transparent"
            />
            <Handle
                type="source"
                position={Position.Bottom}
                className="!size-1 !border-0 !bg-transparent"
            />

            {/* Header */}
            <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-3 py-2">
                <span className={visual.iconColor}>{visual.icon}</span>
                <span className="truncate text-sm font-semibold text-foreground">{title}</span>
                <span className="ml-auto shrink-0 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                    {headerMeta ?? visual.label}
                </span>
            </div>

            {/* Body — `min-w-0` lets flex children shrink, `overflow-hidden` clips
                native widgets (e.g. <audio>) that would otherwise force the node
                wider than `NODE_SIZES[kind].width`. */}
            <div className="min-w-0 flex-1 overflow-hidden px-3 py-2.5 text-xs text-foreground">
                {children}
            </div>
        </div>
    );
}
