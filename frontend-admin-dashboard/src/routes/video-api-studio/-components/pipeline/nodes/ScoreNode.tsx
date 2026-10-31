import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { CircleNotch as Loader2, MusicNote as Music } from '@phosphor-icons/react';
import { BaseNodeShell } from './BaseNodeShell';
import { buildActiveSubStatus } from '../-utils/stage-vocab';
import type { PipelineNodeData } from '../-utils/build-pipeline-graph';

function ScoreNodeInner({ data }: NodeProps<PipelineNodeData>) {
    const { t } = useTranslation('videoApiStudioStageVocab');
    const slot = data.state.score;
    if (!slot) return null;

    if (slot.state === 'scheduled') {
        return (
            <BaseNodeShell kind="score" state={slot.state}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Music className="size-3.5 text-muted-foreground/60" />
                    Composer on the call sheet
                </div>
            </BaseNodeShell>
        );
    }

    if (slot.state === 'cut' || slot.state === 'reshoot') {
        return (
            <BaseNodeShell kind="score" state={slot.state}>
                <p className="text-2xs text-red-700">{slot.error}</p>
            </BaseNodeShell>
        );
    }

    if (slot.state === 'in_production') {
        const completed = slot.partialData?.segmentsCompleted ?? 0;
        const total = slot.partialData?.segmentsTotal ?? 0;
        return (
            <BaseNodeShell
                kind="score"
                state={slot.state}
                headerMeta={total > 0 ? `${completed} / ${total}` : undefined}
            >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-blue-600" />
                    {total > 0
                        ? `Composing chunk ${Math.min(completed + 1, total)} of ${total}`
                        : buildActiveSubStatus(t).score}
                </div>
            </BaseNodeShell>
        );
    }

    if (slot.state !== 'wrapped') return null;

    // Compact "Score ready" affordance. The actual <audio> control lives in
    // the detail sheet so it can't overflow the node.
    const audioUrl = slot.data.audioUrl;
    return (
        <BaseNodeShell kind="score" state={slot.state}>
            <div className="space-y-1.5">
                <div className="flex items-center gap-2 rounded-md border bg-white px-2 py-1.5">
                    <Music className="size-3.5 shrink-0 text-blue-600" />
                    <span className="truncate text-2xs font-medium text-foreground">
                        {audioUrl ? 'Score recorded' : 'Score wrapped'}
                    </span>
                    {audioUrl && (
                        <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
                            ▶ Open
                        </span>
                    )}
                </div>
                <p className="truncate text-2xs text-muted-foreground">
                    {slot.data.segmentsTotal
                        ? `${slot.data.segmentsTotal} chunks merged`
                        : 'Background music sealed'}
                </p>
            </div>
        </BaseNodeShell>
    );
}

export const ScoreNode = memo(ScoreNodeInner);
