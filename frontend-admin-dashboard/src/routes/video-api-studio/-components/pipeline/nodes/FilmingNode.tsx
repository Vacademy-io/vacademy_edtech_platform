import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { Camera, CheckCircle, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Progress } from '@/components/ui/progress';
import { BaseNodeShell } from './BaseNodeShell';
import { buildActiveSubStatus } from '../-utils/stage-vocab';
import type { PipelineNodeData } from '../-utils/build-pipeline-graph';

/**
 * Phase 1 placeholder — single counter node showing X of N scenes wrapped.
 * Phase 2 replaces this with N individual `<SceneNode>` instances.
 */
function FilmingNodeInner({ data }: NodeProps<PipelineNodeData>) {
    const { t } = useTranslation('videoApiStudioStageVocab');
    const slot = data.state.filming;

    let completed = 0;
    let total = 0;
    if (slot.state === 'wrapped') {
        completed = slot.data.shotsCompleted;
        total = slot.data.shotsTotal;
    } else if (slot.state === 'in_production' && slot.partialData) {
        completed = slot.partialData.shotsCompleted ?? 0;
        total = slot.partialData.shotsTotal ?? 0;
    }
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (slot.state === 'cut') {
        return (
            <BaseNodeShell kind="filming" state={slot.state}>
                <p className="text-xs text-red-700">{slot.error}</p>
            </BaseNodeShell>
        );
    }

    if (slot.state === 'scheduled') {
        return (
            <BaseNodeShell kind="filming" state={slot.state}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Camera className="size-3.5 text-muted-foreground/60" />
                    Cameras not yet rolling
                </div>
            </BaseNodeShell>
        );
    }

    return (
        <BaseNodeShell
            kind="filming"
            state={slot.state}
            headerMeta={total > 0 ? `${completed} / ${total}` : undefined}
        >
            <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                    {slot.state === 'wrapped' ? (
                        <>
                            <CheckCircle className="size-3.5 text-green-600" />
                            <span className="text-foreground">All scenes wrapped</span>
                        </>
                    ) : (
                        <>
                            <Loader2 className="size-3.5 animate-spin text-blue-600" />
                            <span className="text-muted-foreground">
                                {buildActiveSubStatus(t).filming}
                            </span>
                        </>
                    )}
                </div>
                {total > 0 && (
                    <div className="space-y-1">
                        <Progress value={pct} className="h-1" />
                        <div className="flex items-center justify-between text-2xs text-muted-foreground">
                            <span>Scene {Math.min(completed + 1, total)} on set</span>
                            <span className="tabular-nums">{pct}%</span>
                        </div>
                    </div>
                )}
            </div>
        </BaseNodeShell>
    );
}

export const FilmingNode = memo(FilmingNodeInner);
