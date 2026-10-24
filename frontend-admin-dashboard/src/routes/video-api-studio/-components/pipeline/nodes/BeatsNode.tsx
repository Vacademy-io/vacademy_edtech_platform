import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { ListNumbers, CircleNotch } from '@phosphor-icons/react';
import { BaseNodeShell } from './BaseNodeShell';
import { buildActiveSubStatus } from '../-utils/stage-vocab';
import type { PipelineNodeData } from '../-utils/build-pipeline-graph';

/**
 * BeatPlanner node — small, optional, sits between Pitch/Research and
 * Screenplay. Present only when the v2 pipeline emits `beats_planning` /
 * `beats_done` sub-stage events. Renders a "scheduled / in_production /
 * wrapped" state with a beat-count summary once available.
 */

function BeatsNodeInner({ data }: NodeProps<PipelineNodeData>) {
    const { t } = useTranslation('videoApiStudioStageVocab');
    const slot = data.state.beats;
    if (!slot) return null;

    if (slot.state === 'scheduled') {
        return (
            <BaseNodeShell kind="beats" state={slot.state}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ListNumbers className="size-3.5 text-muted-foreground/60" />
                    Beat plan queued
                </div>
            </BaseNodeShell>
        );
    }

    if (slot.state === 'cut' || slot.state === 'reshoot') {
        return (
            <BaseNodeShell kind="beats" state={slot.state}>
                <p className="text-2xs text-red-700">{slot.error}</p>
            </BaseNodeShell>
        );
    }

    if (slot.state === 'in_production') {
        return (
            <BaseNodeShell kind="beats" state={slot.state}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CircleNotch className="size-3.5 animate-spin text-blue-600" />
                    {buildActiveSubStatus(t).beats}
                </div>
            </BaseNodeShell>
        );
    }

    if (slot.state !== 'wrapped') return null;
    const count = slot.data.count ?? 0;
    const headerMeta = count > 0 ? `${count} beat${count === 1 ? '' : 's'}` : undefined;
    return (
        <BaseNodeShell kind="beats" state={slot.state} headerMeta={headerMeta}>
            <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                <ListNumbers className="size-3 shrink-0 text-muted-foreground/70" />
                <span className="truncate">
                    {count > 0
                        ? 'Beat plan locked'
                        : 'Beat plan filed'}
                </span>
            </div>
        </BaseNodeShell>
    );
}

export const BeatsNode = memo(BeatsNodeInner);
